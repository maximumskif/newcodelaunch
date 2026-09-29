#!/usr/bin/env bash
# Pull main, rebuild, restart, and wait until the site answers over HTTPS.
# Run on the server from anywhere: bash /opt/newcodelaunch/deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

git pull --ff-only
compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --env-file deploy/.env "$@"; }
compose up -d --build --remove-orphans

DOMAIN="$(grep '^DOMAIN=' deploy/.env | cut -d= -f2)"
for _ in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/api/health/ready" >/dev/null 2>&1; then
    echo "up: https://$DOMAIN"
    compose ps
    exit 0
  fi
  sleep 5
done
echo "not ready after 5 minutes — check: docker compose logs backend caddy" >&2
compose ps
exit 1
