#!/usr/bin/env bash
# Started by Playwright's webServer config, not meant to be run standalone.
# Runs the real Flask backend against a throwaway SQLite DB (migrated fresh
# every run via `flask db upgrade` — not db.create_all(), so this also
# exercises the real migration path, not a shortcut around it) and a
# SEPOLIA_RPC_URL pointed at the local anvil instance run-anvil.sh starts,
# so every compile/estimate/status call in the deploy flow hits a real
# chain, just not a public one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../../../backend"
cd "$BACKEND_DIR"

if [ ! -x ".venv/bin/flask" ]; then
  echo "backend/.venv is missing or incomplete. Set it up first:" >&2
  echo "  cd backend && uv venv --python 3.11 .venv && uv pip install -r requirements.txt" >&2
  exit 1
fi

rm -f e2e_test.db

export SECRET_KEY="e2e-test-secret-not-for-real-use"
export JWT_SECRET_KEY="e2e-test-jwt-secret-not-for-real-use"
export DATABASE_URL="sqlite:///$(pwd)/e2e_test.db"
export SEPOLIA_RPC_URL="http://127.0.0.1:8545"
export CORS_ORIGINS="http://localhost:5173"
export CANDY_MACHINE_SHARED_SECRET="e2e-test-shared-secret"
export FLASK_APP="wsgi.py"

.venv/bin/flask db upgrade
exec .venv/bin/flask run
