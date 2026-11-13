#!/usr/bin/env bash
# Prove a backup restores: load it into a throwaway Postgres and compare the
# key tables' row counts with the ones deploy/backup.sh recorded. Production
# is never touched (read-only counts, for comparison).
#
#   bash deploy/restore-check.sh                # newest local backup
#   bash deploy/restore-check.sh <backup dir>   # a specific one
#   bash deploy/restore-check.sh --remote       # newest copy in BACKUP_REMOTE,
#                                               # downloaded first (proves the
#                                               # off-server copy is usable)
#
# Exits non-zero if the restore fails, a count differs, or uploads.tgz is
# unreadable.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env "$@"; }
setting() { grep -E "^$1=" deploy/.env | tail -n1 | cut -d= -f2- || true; }

BACKUP_DIR="${BACKUP_DIR:-$(setting BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/newcodelaunch}"
REMOTE="${BACKUP_REMOTE:-$(setting BACKUP_REMOTE)}"
SCRATCH="launchpad-restore-check"
WORK=""

cleanup() {
  docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
  # An if, not `[ ] &&`: a false test as the trap's last command would
  # become the script's exit status.
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

if [ "${1:-}" = "--remote" ]; then
  [ -n "$REMOTE" ] || { echo "BACKUP_REMOTE isn't set in deploy/.env" >&2; exit 1; }
  LATEST="$(rclone lsf --dirs-only "$REMOTE" | grep -E 'Z/$' | sort | tail -n1)"
  [ -n "$LATEST" ] || { echo "no backups found in $REMOTE" >&2; exit 1; }
  WORK="$(mktemp -d)"
  echo "downloading $REMOTE/$LATEST"
  rclone copy "$REMOTE/$LATEST" "$WORK"
  SRC="$WORK"
elif [ -n "${1:-}" ]; then
  SRC="$1"
else
  SRC="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*Z' | sort | tail -n1)"
  [ -n "$SRC" ] || { echo "no backups in $BACKUP_DIR" >&2; exit 1; }
fi
for f in db.dump uploads.tgz counts.txt; do
  [ -s "$SRC/$f" ] || { echo "missing or empty: $SRC/$f" >&2; exit 1; }
done
echo "checking $SRC"

# Same major version as production; no network, no published ports.
docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
docker run -d --name "$SCRATCH" --network none \
  -e POSTGRES_PASSWORD=scratch -e POSTGRES_DB=restored postgres:16-alpine >/dev/null
# The image's first start runs a temporary server on the Unix socket only,
# then restarts. Only the final server listens on TCP, so connecting over
# 127.0.0.1 (the container's own loopback, present even with no network)
# can't catch the temporary one.
spsql() { docker exec -i -e PGPASSWORD=scratch "$SCRATCH" psql -h 127.0.0.1 -U postgres -d restored "$@"; }
for _ in $(seq 1 60); do
  spsql -tAc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
spsql -tAc 'SELECT 1' >/dev/null

docker exec -i -e PGPASSWORD=scratch "$SCRATCH" pg_restore -h 127.0.0.1 -U postgres -d restored --no-owner --no-privileges --exit-on-error < "$SRC/db.dump"

FAIL=0
printf '%-24s %10s %10s %10s\n' table backup restored live
# Every command in this loop reads from /dev/null: docker exec -i and compose
# exec -T forward stdin and would otherwise swallow the rest of counts.txt.
while read -r table expected; do
  restored="$(spsql -tAc "SELECT count(*) FROM $table" < /dev/null)"
  live="$(compose exec -T postgres psql -U launchpad -d launchpad -tAc "SELECT count(*) FROM $table" < /dev/null 2>/dev/null || echo '?')"
  printf '%-24s %10s %10s %10s\n' "$table" "$expected" "$restored" "$live"
  [ "$restored" = "$expected" ] || FAIL=1
done < "$SRC/counts.txt"

FILES="$(tar -tzf "$SRC/uploads.tgz" | grep -vc '/$' || true)"
echo "uploads.tgz: $FILES files, readable"

if [ "$FAIL" -ne 0 ]; then
  echo "FAIL: restored row counts differ from the backup's" >&2
  exit 1
fi
echo "OK: the backup restores with the recorded row counts"
echo "(\"live\" can be higher than \"backup\" if the site took writes since it ran.)"
