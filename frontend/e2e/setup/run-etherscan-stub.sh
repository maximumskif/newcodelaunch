#!/usr/bin/env bash
# Started by Playwright's webServer config, not meant to be run standalone.
# Reuses the backend's own venv — Flask, requests, and py-solc-x (the stub
# really compiles what it's sent) are all dependencies there already.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../../../backend"

if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  echo "backend/.venv is missing or incomplete. Set it up first:" >&2
  echo "  cd backend && uv venv --python 3.11 .venv && uv pip install -r requirements.txt" >&2
  exit 1
fi

exec "$BACKEND_DIR/.venv/bin/python" "$SCRIPT_DIR/etherscan_stub.py"
