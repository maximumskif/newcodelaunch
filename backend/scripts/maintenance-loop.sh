#!/bin/sh
# Runs this app's scheduled maintenance commands forever, every
# MAINTENANCE_INTERVAL_SECONDS (default 300), or once with --once.
#
#   flask reap-stale-generation-jobs  fails NFT generation jobs whose worker
#                                     died mid-run (see app/commands.py)
#   flask prune-nonces                deletes spent/expired sign-in nonces
#
# Both existed for months with nothing running them (README "Known gaps").
# This is what docker-compose.yml's `scheduler` service runs. Why a sleep
# loop rather than cron: it reuses the backend image unchanged (cron would
# mean an apt-get step the backend Dockerfile deliberately avoids), inherits
# the container's environment as-is (cron jobs famously don't — DATABASE_URL
# and friends would silently be missing), and logs to stdout like every
# other service here, not to cron's mail spool. The trade-off — drift, and
# no "at 03:00" scheduling — doesn't matter for two idempotent cleanup jobs.
# A host with its own scheduler (a platform cron, a Kubernetes CronJob) can
# run `sh scripts/maintenance-loop.sh --once` on its schedule instead.
#
# One interval for both: the reaper wants minutes (a stuck job blocks its
# collection until reaped, NFT_GENERATION_JOB_STALE_SECONDS=600 by default);
# prune-nonces only needs daily, but it's a single indexed DELETE, so
# running it as often costs nothing and keeps this one knob. Both are safe
# to run concurrently from more than one scheduler, just redundant.
#
# A failing command is logged and retried next round, never fatal: exiting
# would turn a transient database blip into a restart loop at best, and at
# worst (no restart policy) silently stop all maintenance.

set -u

interval="${MAINTENANCE_INTERVAL_SECONDS:-300}"
case "$interval" in
  '' | *[!0-9]*)
    echo "maintenance: MAINTENANCE_INTERVAL_SECONDS must be a whole number of seconds, got '$interval'" >&2
    exit 2
    ;;
esac

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) maintenance: $*"
}

failed=0

run() {
  log "running flask $1"
  if flask "$1"; then
    log "flask $1 ok"
  else
    log "flask $1 FAILED (exit $?)"
    failed=1
  fi
}

run_all() {
  failed=0
  run reap-stale-generation-jobs
  run prune-nonces
}

# --once exits non-zero if either command failed, so an external scheduler
# can alert on it; the loop below never exits on a failure.
if [ "${1:-}" = "--once" ]; then
  run_all
  exit "$failed"
fi

# As PID 1 in a container, sh ignores SIGTERM unless trapped, so `docker
# stop` would wait out its 10s grace period and SIGKILL. `sleep & wait`
# (not a bare `sleep`) is what lets the trap fire mid-interval.
trap 'log "stopping"; exit 0' TERM INT

log "every ${interval}s"
while :; do
  run_all
  [ "$failed" -eq 0 ] || log "retrying failed command(s) in ${interval}s"
  sleep "$interval" &
  wait $!
done
