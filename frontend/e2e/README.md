# End-to-end tests

Real end-to-end coverage over the actual stack this app is: a real Flask
backend, a real `py-solc-x` Solidity compile, a real local Ethereum chain, a
real local Solana validator with the real Metaplex Core/Core Candy Machine
programs cloned onto it, a real signature the backend independently
verifies — everything except the wallet browser extensions themselves
(real keys/signers substituted in via script injection, not stubbed API
responses) and the third-party Pinata pinning call (a local stub, see
below). See `docs/REBUILD_PROGRESS.md`'s "Testing & CI" entries for why
this exists: no wallet-signing flow in this app had ever been driven
through a real browser before this.

## Why fake injected wallets instead of real MetaMask/Phantom

Automating an actual browser extension (e.g. with Synpress) means packaging
an unpacked extension, unlocking it with a seed phrase, and clicking through
its own popup UI on every signature — flaky in CI, and it doesn't verify
anything a real key can't already prove. `fixtures/injectedEvmWallet.ts` and
`fixtures/injectedSolanaWallet.ts` implement just enough of
[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) and Phantom's injected
interface, respectively, for wagmi's `injected()` connector and
`@solana/wallet-adapter-wallets`' `PhantomWalletAdapter` to detect and drive
them — backed by real `viem`/`tweetnacl` signing over well-known throwaway
keys. The frontend code can't tell either apart from a real wallet; the
backend gets a real signature to verify cryptographically either way.

## Why local chains instead of real testnets

Real Sepolia/Devnet would mean either a funded key sitting in CI secrets (a
real key to protect, for a test suite) or depending on a public faucet's
uptime and rate limits (flaky by design, not a wallet's fault).

- **EVM**: `anvil` (part of [Foundry](https://getfoundry.sh)) starts empty
  every run, pre-funds its default accounts with 10000 ETH each, and runs
  with `--chain-id 11155111` — Sepolia's real chain id — so nothing in the
  app's actual Sepolia configuration needs to change, just which RPC URL
  it's pointed at.
- **Solana**: `solana-test-validator` starts empty too (funded via a real
  `requestAirdrop` in the Candy Machine spec's own `test.beforeAll`, since
  unlike anvil it doesn't pre-fund anything). The two Metaplex programs this
  app actually calls (Core, Core Candy Machine) — plus a third, the Core
  Candy Guard program, that `create()` wires in under the hood without this
  app's own code ever naming it — aren't native programs, so
  `--clone-upgradeable-program` fetches their real deployed bytecode from
  devnet once at startup (the one point this needs network access) and
  installs it locally; every instruction after that executes against the
  real, unmodified program logic, entirely offline for the rest of the run.
  See `e2e/setup/run-solana-validator.sh`'s own comments for exactly why
  plain `--clone` doesn't work for these programs and how the third one was
  found — both were real, non-obvious gotchas the first time this was set up.

## Why a local Pinata stub

There's no local-open-source equivalent of "pin something to global IPFS"
the way anvil/solana-test-validator are for a real chain. `PINATA_BASE_URL`
(an override in `backend/app/services/ipfs.py`, mirroring the
`SEPOLIA_RPC_URL`/`SOLANA_DEVNET_RPC_URL` pattern) points the real `ipfs.py`
code path at `e2e/setup/pinata_stub.py` — a ~40-line Flask app returning a
fake but stable `IpfsHash` — instead of a real Pinata account. Everything
upstream of that one call (the request, the auth, the DB record) is real;
only the "does this hash actually resolve on IPFS" question is left
unanswered, which nothing in this app's own tests or UI ever checks anyway.

## One-time setup

```bash
# Foundry (anvil) — portable install, no sudo needed
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Solana CLI (solana-test-validator) — also portable, no sudo needed
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Playwright's browser + the OS shared libraries it needs to launch —
# the second half needs sudo
cd frontend
npm install
npx playwright install --with-deps chromium

# The candy-machine sidecar's own dependencies
cd ../services/candy-machine
npm install
```

The backend also needs its own `.venv` set up first if it isn't already
(see the root `README.md`'s Setup section) — `run-backend.sh` checks for
this and tells you what to run if it's missing.

## Running

```bash
cd frontend
npm run test:e2e
```

This one command starts anvil, solana-test-validator, the Pinata stub,
migrates a throwaway SQLite DB and runs the real Flask backend against it,
starts the real candy-machine sidecar and the real Vite dev server, runs
the tests, then tears everything down. No manual multi-terminal setup — see
`playwright.config.ts`'s `webServer` array and the scripts under `e2e/setup/`.

## What's covered so far

- `token-deploy.spec.ts` — connect wallet → sign in (real nonce + real
  `personal_sign` + real backend verification) → fill an ERC-20 template →
  estimate (real compile + real gas estimate against anvil) → deploy (real
  sign + broadcast + on-chain confirmation) → confirm the backend recorded
  the address it actually saw on-chain. This is the exact flow
  `useDeployTemplate.ts`'s own code comment flagged as never smoke-tested
  before this.
- `candy-machine.spec.ts` — sign in with Solana (real nonce + real
  ed25519 `signMessage` + real backend verification) → seed a collection/
  layer/trait/generated-item/publish via direct API calls (no wallet
  signing involved in any of that) → launch a real Candy Machine through
  the actual UI (real sidecar-built transactions, real signatures, real
  on-chain confirmation, real backend re-verification before recording) →
  mint from the public storefront the launch just linked to (a different,
  unauthenticated visitor flow). This is the exact flow this project's own
  docs had only ever verified via `curl`-level checks or a single manual
  devnet pass before this.

## What isn't covered yet

- The Candy Machine's own devnet click-through checklist
  (`docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`) is separate from this
  suite — that's a manual, real-devnet verification step for the
  blockhash-expiry fix specifically, not something a local validator run
  substitutes for (the fix needs to be proven against real network latency
  between wallet approvals, which a fast local validator can't reproduce).
- The NFT Generator's own multi-step upload UI (layer/trait
  creation, image upload) isn't driven through the browser here — it's
  seeded via direct API calls instead, since none of it involves wallet
  signing or on-chain activity and it already has component-level test
  coverage (`LayerCard.test.tsx` etc.).
- AI Trait Identifier (optional OpenAI-backed rarity suggestions) — hits a
  real paid third-party API this suite has no reason to depend on.
