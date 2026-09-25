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
export PINATA_GATEWAY_URL="http://127.0.0.1:5555/ipfs/"
export FLASK_APP="wsgi.py"
# config.py calls load_dotenv() unconditionally, which — given `cd
# "$BACKEND_DIR"` above — loads whatever's in backend/.env, including a
# real OPENAI_API_KEY if the developer running this suite has one set up
# for normal local dev (exactly what the root README's setup steps tell
# everyone to do). A real key here once caused a real bug: a "no key
# configured" test was silently making a real OpenAI network call, with
# real retry backoff, which looked like a slow-CV-code flake until it was
# actually profiled. Explicitly set to a fake, obviously-not-real value
# here, paired with OPENAI_BASE_URL pointed at the local stub
# (run-openai-stub.sh, see frontend/e2e/README.md) — same fix as
# PINATA_BASE_URL/PINATA_GATEWAY_URL below: this suite's behavior no
# longer depends on what happens to be sitting in a real .env on whichever
# machine runs it, AND the AI-vision pass itself (previously never
# exercised in e2e at all, key or no key) now gets real request/response
# coverage on every run, for free, with no real account or network access.
# Source verification goes to the local verifying stub (run-etherscan-stub.sh)
# — never real Etherscan, whatever key a developer's backend/.env holds.
export ETHERSCAN_API_KEY="e2e-fake-etherscan-key"
export ETHERSCAN_API_URL="http://127.0.0.1:5557/v2/api"
export OPENAI_API_KEY="sk-e2e-test-not-for-real-use"
export OPENAI_BASE_URL="http://127.0.0.1:5556/v1"

# Every spec signs in the same anvil wallet from the same IP — a dozen-plus
# /auth/nonce calls a minute on a full run, past the real 10/minute
# per-wallet limit. That made whichever EVM spec ran 11th (token-deploy,
# alphabetically) fail its sign-in with a 429 whenever the suite ran fast
# enough; CI's retry usually landed in a fresh window and hid it. The
# limits are covered by pytest instead (see RATELIMIT_ENABLED in
# backend/app/config.py).
export RATE_LIMIT_ENABLED="false"
# The Uniswap V2 the e2e suite deploys onto anvil itself (e2e/setup/localUniswap.ts —
# fixed addresses, from a dedicated deployer key at nonces 0-2).
export DEX_OVERRIDES='{"sepolia": {"name": "Uniswap V2 (local)", "router": "0x494fb8c2Bd7f47cC945fd1054895bAcBf6DeaE4f", "factory": "0x303C579059DB0c79a1da9aD632858E5B755b340b", "wrapped_native": "0xdcF212126CDEB374aFDFb7ba5C35aA9108b353d4"}}'

.venv/bin/flask db upgrade
exec .venv/bin/flask run
