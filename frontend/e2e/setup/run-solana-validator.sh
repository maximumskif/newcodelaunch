#!/usr/bin/env bash
# Started by Playwright's webServer config, not meant to be run standalone.
# A fresh, empty, throwaway local validator on every run (--reset) — real
# Solana consensus/runtime, just not a shared public cluster. The two
# Metaplex programs this app actually calls (Core, Core Candy Machine)
# aren't native programs, so they don't exist on a bare fresh validator —
# cloning fetches their real deployed bytecode from devnet once at startup
# (the one point this needs network access) and installs it locally; every
# instruction after that executes against the real, unmodified program
# logic, entirely offline for the rest of the run.
#
# --clone-upgradeable-program, not plain --clone: every program below is
# owned by BPFLoaderUpgradeable, whose actual executable bytecode lives
# in a separate ProgramData account (a PDA derived from the program id) —
# plain --clone only copies the thin program account itself, not that data
# account. The result LOOKS cloned (getAccountInfo shows executable: true)
# but any real transaction invoking it fails on-chain with "Program is not
# deployed" / "Unsupported program id". Confirmed by reproducing the exact
# failure from a plain Node script with no browser involved at all before
# finding this — see docs/REBUILD_PROGRESS.md's "Testing & CI" entry.
#
# Three programs, not two: Core, Core Candy Machine, AND the Core Candy
# Guard program (CMAGAKJ...) the Candy Machine CPIs into for its
# solPayment/startDate guards — mpl-core-candy-machine's create() wires a
# candy machine to a guard account under the hood even though this app's
# own code (services/candy-machine) never references the guard program id
# directly, so it's easy to miss when listing "the programs this app uses."
# Found the same way as the ProgramData issue above: reproduced "Attempt to
# load a program that does not exist" from a plain Node script, decoded the
# failing transaction's account keys, and found this third program id
# referenced but never cloned.
#
# Plus a fourth, Metaplex Token Metadata (metaqbx...), for the Token
# Launchpad's Solana side (services/candy-machine/src/routes/token.ts) —
# where an SPL token's name/symbol/logo live. The SPL Token and Associated
# Token Account programs it also uses are built into every validator, so
# they need no cloning.
set -euo pipefail

if ! command -v solana-test-validator >/dev/null 2>&1; then
  echo "solana-test-validator not found on PATH — install the Solana CLI:" >&2
  echo "  sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\"" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER_DIR="$SCRIPT_DIR/../.generated/solana-ledger"
mkdir -p "$LEDGER_DIR"

exec solana-test-validator \
  --ledger "$LEDGER_DIR" \
  --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
  --clone-upgradeable-program CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J \
  --clone-upgradeable-program CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb \
  --clone 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy \
  --clone 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy \
  --url https://api.devnet.solana.com \
  --reset \
  --quiet
