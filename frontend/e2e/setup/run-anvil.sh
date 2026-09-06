#!/usr/bin/env bash
# Started by Playwright's webServer config (see playwright.config.ts), not
# meant to be run standalone. A fresh, empty, throwaway chain on every test
# run — chain-id matches Sepolia's (11155111) exactly, so nothing in the
# frontend/backend's real Sepolia config needs to change, just the RPC URL
# both point at (see run-backend.sh's SEPOLIA_RPC_URL and
# wagmiConfig.ts's VITE_SEPOLIA_RPC_URL).
set -euo pipefail

if ! command -v anvil >/dev/null 2>&1; then
  echo "anvil not found on PATH — install Foundry: https://getfoundry.sh (curl -L https://foundry.paradigm.xyz | bash && foundryup)" >&2
  exit 1
fi

exec anvil --chain-id 11155111 --port 8545 --silent
