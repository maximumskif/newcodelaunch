#!/usr/bin/env bash
# Started by Playwright's webServer config, not meant to be run standalone.
# The real Node/Umi sidecar, pointed at the local solana-test-validator
# instance run-solana-validator.sh starts — every transaction it builds is
# real, signed for real by the e2e fixture's real keypair, and actually
# lands on that local validator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/../../../services/candy-machine"
cd "$SIDECAR_DIR"

if [ ! -d "node_modules" ]; then
  echo "services/candy-machine/node_modules is missing. Set it up first:" >&2
  echo "  cd services/candy-machine && npm install" >&2
  exit 1
fi

export PORT="4000"
export CORS_ORIGINS="http://localhost:5173"
export CANDY_MACHINE_SHARED_SECRET="e2e-test-shared-secret"
export SOLANA_DEVNET_RPC_URL="http://127.0.0.1:8899"

exec npm run dev
