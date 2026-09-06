#!/usr/bin/env bash
# Started by Playwright's webServer config, not meant to be run standalone.
# Runs the real Flask backend against a throwaway SQLite DB (migrated fresh
# every run via `flask db upgrade` — not db.create_all(), so this also
# exercises the real migration path, not a shortcut around it), with
# SEPOLIA_RPC_URL/SOLANA_DEVNET_RPC_URL pointed at the local anvil/
# solana-test-validator instances run-anvil.sh/run-solana-validator.sh
# start, and PINATA_BASE_URL pointed at the local stub run-pinata-stub.sh
# starts — every compile/estimate/status/publish call in either deploy flow
# hits something real, just not a public network or a real Pinata account.
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
export SOLANA_DEVNET_RPC_URL="http://127.0.0.1:8899"
export CORS_ORIGINS="http://localhost:5173"
export CANDY_MACHINE_SHARED_SECRET="e2e-test-shared-secret"
export CANDY_MACHINE_SERVICE_URL="http://localhost:4000"
# Real credential shape (a JWT the stub never actually checks) so
# ipfs.py's _auth_headers() doesn't short-circuit with IPFSNotConfiguredError
# before the request ever reaches PINATA_BASE_URL.
export PINATA_JWT="e2e-fake-jwt-not-for-real-use"
export PINATA_BASE_URL="http://127.0.0.1:5555"
export FLASK_APP="wsgi.py"

.venv/bin/flask db upgrade
exec .venv/bin/flask run
