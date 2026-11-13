#!/usr/bin/env bash
# Back up the production stack: the Postgres database and the uploads volume
# (trait images and generated NFTs). Run on the server, from anywhere:
#
#   bash /opt/newcodelaunch/deploy/backup.sh
#
# deploy/bootstrap.sh installs a systemd timer that runs this daily.
#
# Each run writes <BACKUP_DIR>/<UTC timestamp>/ with:
#   db.dump       pg_dump custom format (restore with pg_restore)
#   uploads.tgz   the contents of /data/uploads
#   counts.txt    row counts of the key tables in db.dump, for
#                 deploy/restore-check.sh
#
# Settings, read from deploy/.env (all optional):
#   BACKUP_DIR        local folder, default /var/backups/newcodelaunch
#   BACKUP_KEEP_DAYS  local copies older than this are deleted, default 14
#   BACKUP_REMOTE     an rclone destination such as b2:my-bucket/newcodelaunch.
#                     Set up the remote once with `rclone config`. Without it
#                     the backup stays on this server, which doesn't protect
#                     against losing the server, and the script says so.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env "$@"; }
setting() { grep -E "^$1=" deploy/.env | tail -n1 | cut -d= -f2- || true; }

BACKUP_DIR="${BACKUP_DIR:-$(setting BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/newcodelaunch}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(setting BACKUP_KEEP_DAYS)}"
KEEP_DAYS="${KEEP_DAYS:-14}"
REMOTE="${BACKUP_REMOTE:-$(setting BACKUP_REMOTE)}"

# Tables whose row counts prove a restore is complete. Keep in step with
# deploy/restore-check.sh, which reads them back from counts.txt.
TABLES="users projects contract_deployments"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
umask 077
mkdir -p "$OUT.partial"

echo "dumping database"
compose exec -T postgres pg_dump -U launchpad -d launchpad -Fc > "$OUT.partial/db.dump"

# Count rows from the dump file itself (COPY text format: one line per row,
# embedded newlines escaped), so counts.txt describes exactly what's in
# db.dump, not the live database a moment later.
dump_rows() {
  compose exec -T postgres pg_restore -f - --data-only --table="$1" < "$OUT.partial/db.dump" \
    | awk '/^COPY /{on=1; next} on && $0=="\\."{on=0; next} on{n++} END{print n+0}'
}
for t in $TABLES; do echo "$t $(dump_rows "$t")"; done > "$OUT.partial/counts.txt"

echo "archiving uploads"
compose exec -T backend sh -c 'mkdir -p /data/uploads && tar -C /data/uploads -czf - .' > "$OUT.partial/uploads.tgz"
tar -tzf "$OUT.partial/uploads.tgz" > /dev/null

mv "$OUT.partial" "$OUT"
echo "wrote $OUT ($(du -sh "$OUT" | cut -f1))"
cat "$OUT/counts.txt"

# Keep the newest copy even if it's older than KEEP_DAYS (a stopped timer
# shouldn't end with nothing on disk).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*Z' -mtime +"$KEEP_DAYS" ! -path "$OUT" -exec rm -rf {} +
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +120 -exec rm -rf {} +

if [ -n "$REMOTE" ]; then
  echo "copying to $REMOTE"
  rclone copy "$OUT" "$REMOTE/$STAMP"
  echo "copied to $REMOTE/$STAMP"
else
  echo "WARNING: BACKUP_REMOTE isn't set in deploy/.env, so this backup is only on this server." >&2
fi
