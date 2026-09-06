# End-to-end tests

Real end-to-end coverage over the actual stack this app is: a real Flask
backend, a real `py-solc-x` Solidity compile, a real local Ethereum chain,
a real signature the backend independently verifies — everything except
the wallet browser extension itself, which is a real key/signer substituted
in via script injection, not a stubbed API response. See
`docs/REBUILD_PROGRESS.md`'s "Testing & CI" entry for why this exists: no
wallet-signing flow in this app had ever been driven through a real browser
before this.

## Why a fake injected wallet instead of a real MetaMask/Phantom

Automating an actual browser extension (e.g. with Synpress) means packaging
an unpacked extension, unlocking it with a seed phrase, and clicking through
its own popup UI on every signature — flaky in CI, and it doesn't verify
anything a real key can't already prove. `fixtures/injectedEvmWallet.ts`
implements just enough of [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)
for wagmi's `injected()` connector to detect and drive it, backed by a real
`viem` `WalletClient` over Anvil's well-known default private key. The
frontend code can't tell it apart from a real wallet; the backend gets a
real signature to verify cryptographically.

## Why a local `anvil` chain instead of a real testnet

Real Sepolia would mean either a funded key sitting in CI secrets (a real
key to protect, for a test suite) or depending on a public faucet's uptime
and rate limits (flaky by design, not a wallet's fault). `anvil` (part of
[Foundry](https://getfoundry.sh)) starts empty every run, pre-funds its
default accounts with 10000 ETH each, and is started with
`--chain-id 11155111` — Sepolia's real chain id — so nothing in the app's
actual Sepolia configuration needs to change, just which RPC URL it's
pointed at for the duration of the test run.

## One-time setup

```bash
# Foundry (anvil) — portable install, no sudo needed
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Playwright's browser + the OS shared libraries it needs to launch —
# the second half needs sudo
cd frontend
npm install
npx playwright install --with-deps chromium
```

The backend also needs its own `.venv` set up first if it isn't already
(see the root `README.md`'s Setup section) — `run-backend.sh` checks for
this and tells you what to run if it's missing.

## Running

```bash
cd frontend
npm run test:e2e
```

This one command starts anvil, migrates a throwaway SQLite DB and runs the
real Flask backend against it, starts the real Vite dev server, runs the
tests, then tears everything down. No manual multi-terminal setup — see
`playwright.config.ts`'s `webServer` array and `setup/run-anvil.sh` /
`setup/run-backend.sh`.

## What's covered so far

- `token-deploy.spec.ts` — connect wallet → sign in (real nonce + real
  `personal_sign` + real backend verification) → fill an ERC-20 template →
  estimate (real compile + real gas estimate against anvil) → deploy (real
  sign + broadcast + on-chain confirmation) → confirm the backend recorded
  the address it actually saw on-chain. This is the exact flow
  `useDeployTemplate.ts`'s own code comment flagged as never smoke-tested
  before this.

## What isn't covered yet

- Solana flows (Candy Machine launch, public mint) — needs the equivalent
  local-chain setup with `solana-test-validator` and a fake Phantom-like
  `window.solana` provider. A deliberate second pass, not started here.
- The Candy Machine's own devnet click-through checklist
  (`docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`) is separate from this
  suite — that's a manual, real-devnet verification step, not something
  this local-anvil approach can substitute for (Anvil has no Solana
  equivalent for that program's specific on-chain behavior).
- NFT generation, IPFS publish — these hit real third-party services
  (Pinata, optionally OpenAI) that a local-chain approach doesn't help
  with; would need their own fixture/mock strategy if added.
