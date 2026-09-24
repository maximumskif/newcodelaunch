#!/usr/bin/env bash
# Starts the real backend, Candy Machine sidecar, and local Pinata stub
# pointed at a real Solana cluster (devnet by default), for smoke.mjs.
# Separate ports from the Playwright suite (backend :5100, sidecar :4100)
# so both can exist on one machine. Ctrl-C stops everything.
#
#   SOLANA_RPC_URL=https://api.devnet.solana.com bash e2e/devnet/run-stack.sh
#
# IPFS stays the local stub on purpose: on-chain operations only store
# metadata URIs, they never fetch them, so real pinning adds nothing to
# what this checks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/../../.."
RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
SECRET="devnet-smoke-shared-secret"
WORK="$(mktemp -d)"
trap 'kill 0' EXIT

bash "$SCRIPT_DIR/../setup/run-pinata-stub.sh" > "$WORK/pinata.log" 2>&1 &

(
  cd "$ROOT/services/candy-machine"
  CANDY_MACHINE_SHARED_SECRET="$SECRET" SOLANA_DEVNET_RPC_URL="$RPC_URL" PORT=4100 npx tsx src/index.ts
) > "$WORK/sidecar.log" 2>&1 &

(
  cd "$ROOT/backend"
  export SECRET_KEY="devnet-smoke-secret" JWT_SECRET_KEY="devnet-smoke-jwt-secret"
  export DATABASE_URL="sqlite:///$WORK/smoke.db" FLASK_APP="wsgi.py"
  export SOLANA_DEVNET_RPC_URL="$RPC_URL"
  export CANDY_MACHINE_SHARED_SECRET="$SECRET" CANDY_MACHINE_SERVICE_URL="http://localhost:4100"
  export PINATA_JWT="devnet-smoke-fake-jwt" PINATA_BASE_URL="http://127.0.0.1:5555"
  export PINATA_GATEWAY_URL="http://127.0.0.1:5555/ipfs/"
  export OPENAI_API_KEY="" ETHERSCAN_API_KEY=""
  .venv/bin/flask db upgrade
  exec .venv/bin/flask run --port 5100
) > "$WORK/backend.log" 2>&1 &

echo "stack starting against $RPC_URL — logs in $WORK"
wait
