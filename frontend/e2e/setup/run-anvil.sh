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

# The hardfork is pinned to what Sepolia and mainnet run, not anvil's
# default. Foundry v1.9.0 made Amsterdam the default, which reprices contract
# creation about 6.6x (a 2.5 KB contract: 604k gas on Osaka, 3.99M on
# Amsterdam), so Uniswap's Router02 no longer fits in a 30M-gas block and
# gas figures stop matching the real networks. Move this when Sepolia does.
exec anvil --chain-id 11155111 --port 8545 --hardfork osaka --silent
