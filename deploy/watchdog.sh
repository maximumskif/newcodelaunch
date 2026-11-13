#!/usr/bin/env bash
# Health and error watchdog for the production stack. deploy/bootstrap.sh
# runs it every minute from a systemd timer; it can also be run by hand:
#
#   bash /opt/newcodelaunch/deploy/watchdog.sh
#
# Each run checks:
#   - /api/health/ready over HTTPS. Two failures in a row (so within about two
#     minutes) raise a DOWN alert, and the first success after that a
#     recovery one.
#   - The backend's request log since the last run: any 5xx response or
#     ERROR/CRITICAL line raises an alert with the count and the first few
#     lines. At most one error alert per WATCHDOG_COOLDOWN_MINUTES (default
#     15); errors in between are counted into the next one.
#   - The scheduler: no log lines for 15 minutes means its loop has stopped.
#
# Alerts always go to the system journal (journalctl -t newcodelaunch-watchdog)
# and stderr. With ALERT_TELEGRAM_CHAT in deploy/.env (a chat id, or a
# channel's @username the bot can post in) and TELEGRAM_BOT_TOKEN in
# backend/.env, they also go to Telegram.
#
# This runs on the server it watches, so it can't report that server being
# off or unreachable. Pair it with an external uptime check on
# https://$DOMAIN/api/health/ready (docs/OPERATIONS.md, "What to monitor").
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env "$@"; }
setting() { grep -E "^$1=" "${2:-deploy/.env}" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

DOMAIN="$(setting DOMAIN)"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/newcodelaunch-watchdog}"
COOLDOWN_MINUTES="${WATCHDOG_COOLDOWN_MINUTES:-15}"
CHAT="${ALERT_TELEGRAM_CHAT:-$(setting ALERT_TELEGRAM_CHAT)}"
TOKEN="${TELEGRAM_BOT_TOKEN:-$(setting TELEGRAM_BOT_TOKEN backend/.env)}"
mkdir -p "$STATE_DIR"

state() { cat "$STATE_DIR/$1" 2>/dev/null || echo "${2:-}"; }
save() { echo "$2" > "$STATE_DIR/$1"; }

alert() {
  local text="[$DOMAIN] $1"
  echo "ALERT: $text" >&2
  logger -t newcodelaunch-watchdog -- "$text" 2>/dev/null || true
  if [ -n "$CHAT" ] && [ -n "$TOKEN" ]; then
    curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" \
      --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$text" \
      || echo "watchdog: couldn't send the Telegram alert" >&2
  fi
}

NOW="$(date -u +%s)"
LAST_RUN="$(state last_run "$((NOW - 60))")"
save last_run "$NOW"

# 1. Readiness. Caddy's own local CA serves a domain of localhost (CI).
CURL_TLS=()
[ "$DOMAIN" = "localhost" ] && CURL_TLS=(-k)
if body="$(curl -fsS -m 10 "${CURL_TLS[@]}" "https://$DOMAIN/api/health/ready" 2>&1)"; then
  if [ "$(state down 0)" = "1" ]; then
    alert "RECOVERED: /api/health/ready answers 200 again."
  fi
  save failures 0
  save down 0
else
  failures=$(( $(state failures 0) + 1 ))
  save failures "$failures"
  if [ "$failures" -ge 2 ] && [ "$(state down 0)" != "1" ]; then
    # The ready endpoint's own body says which dependency failed.
    detail="$(curl -sS -m 10 "${CURL_TLS[@]}" "https://$DOMAIN/api/health/ready" 2>&1 | head -c 300 || true)"
    alert "DOWN: /api/health/ready failed $failures checks in a row. ${detail:-$body}"
    save down 1
  fi
fi

# 2. Backend errors since the last run (one JSON line per request;
#    app/logging_config.py writes `"status": 503` and `"level": "ERROR"`).
errors="$(compose logs --no-log-prefix --since "$LAST_RUN" backend 2>/dev/null \
  | grep -E '"status": 5[0-9]{2}|"level": "(ERROR|CRITICAL)"' || true)"
count=$(( $(state pending_errors 0) + $(printf '%s' "$errors" | grep -c . || true) ))
if [ "$count" -gt 0 ]; then
  last_alert="$(state last_error_alert 0)"
  if [ $((NOW - last_alert)) -ge $((COOLDOWN_MINUTES * 60)) ]; then
    sample="$( { state pending_sample; printf '%s\n' "$errors"; } | grep . | head -n 3 | cut -c1-300 || true)"
    alert "ERRORS: $count server errors in the backend log since the last alert. First lines:
$sample"
    save last_error_alert "$NOW"
    save pending_errors 0
    rm -f "$STATE_DIR/pending_sample"
  else
    save pending_errors "$count"
    [ -s "$STATE_DIR/pending_sample" ] || printf '%s\n' "$errors" | grep . | head -n 3 > "$STATE_DIR/pending_sample" || true
  fi
fi

# 3. The scheduler logs a round every MAINTENANCE_INTERVAL_SECONDS (300 by
#    default); fifteen quiet minutes means the loop has stopped.
if [ -z "$(compose logs --no-log-prefix --since 15m scheduler 2>/dev/null | head -n1)" ]; then
  if [ "$(state scheduler_quiet 0)" != "1" ]; then
    alert "SCHEDULER: no log lines for 15 minutes; its maintenance loop may have stopped."
    save scheduler_quiet 1
  fi
else
  save scheduler_quiet 0
fi
