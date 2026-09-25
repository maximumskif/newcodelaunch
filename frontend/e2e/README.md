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
  `requestAirdrop` in each Solana spec's own `test.beforeAll` — see
  `e2e/setup/solanaValidator.ts` — since unlike anvil it doesn't pre-fund
  anything). Metaplex Token Metadata is cloned the same way, for the Token
  Launchpad's Solana side (`solana-token.spec.ts`). The two Metaplex programs this
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
code path at `e2e/setup/pinata_stub.py` instead of a real Pinata account for
pinning; `PINATA_GATEWAY_URL` does the same for reading a pin back. The stub
keeps pinned content in memory for the run and serves it back byte-for-byte
at `/ipfs/<hash>`, so a real read-what-you-pinned round trip — like the NFT
Generator's metadata-preview feature (`GenerateStep.tsx`'s "Preview
metadata", backed by `get_item_metadata`'s real `requests.get` call) —
actually completes, rather than 502ing on a hash nothing can resolve. This
was found by writing `nft-generator.spec.ts`: the preview step failed with a
real `MetadataFetchError` on the first run, because `PINATA_GATEWAY` had no
override at all before this, unlike `PINATA_BASE_URL`. The one thing still
faked is global IPFS availability itself — nothing outside this one process
can resolve these hashes, which nothing in this app's own tests or UI checks
for anyway.

## Why a local Etherscan stub (that really verifies)

Source verification (`backend/app/services/explorer_verification.py`) talks
to Etherscan's V2 API, which needs a real key and can't see a local anvil
chain anyway. `e2e/setup/etherscan_stub.py` stands in for it — but it
doesn't hand back a canned "Pass". It does what an explorer does: compiles
the submitted standard-JSON input with the requested solc version and
compares the runtime bytecode, metadata hash included, byte-for-byte with
what's actually deployed at that address on anvil (`eth_getCode`). So a
"Source verified" in `token-deploy.spec.ts`/`nft-evm-deploy.spec.ts` means
the source, settings, compiler version and contract name this app submits
genuinely reproduce the deployed contract. (Checked on its own too: a
one-character source change fails with a bytecode mismatch; an address with
no code is reported as such.) Like Etherscan, its first status poll answers
"Pending in queue", so the frontend's polling is exercised. What it can't
prove: real Etherscan's availability and per-chain API coverage.

## Why a local OpenAI stub

Same reasoning as Pinata, applied to the AI Trait Identifier's optional
vision pass (`backend/app/services/ai_traits.py`'s `_analyze_with_ai_vision`,
gated on `OPENAI_API_KEY`): `OPENAI_BASE_URL` points the real `openai` v1
client at `e2e/setup/openai_stub.py`'s `/v1/chat/completions` instead of a
real, paid OpenAI account. Unlike Pinata's stub, which really stores and
serves back byte-for-byte what it's given, there's no local equivalent of
"really classify this image" — the stub's response content is a fixed,
deterministic payload. What's real on both sides of that: a real network
round trip, real client-library request construction (including a real
`Authorization` header the stub doesn't bother checking, same as Pinata's
unchecked JWT), and real JSON parsing of the response back in
`ai_traits.py`. `run-backend.sh` sets a fake, obviously-not-real
`OPENAI_API_KEY` for exactly this reason — with the stub in place there's no
more reason to run any test with the AI-vision pass disabled, and this used
to be a real footgun: a "no key configured" test was once silently making a
real OpenAI network call (with real retry backoff) because a developer's own
`backend/.env` had a real key sitting in it, which looked like a slow-CV-code
flake until profiled. The no-key code path itself (`if openai_api_key:`
false) is still covered at the unit level
(`backend/tests/test_ai_traits_service.py`), so nothing is lost by no longer
exercising it here too.

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
  the address it actually saw on-chain → verify its source (see "Why a
  local Etherscan stub" above), scoped to this deploy's own result. This
  is the exact flow
  `useDeployTemplate.ts`'s own code comment flagged as never smoke-tested
  before this.
- `erc20-advanced-owner.spec.ts` — deploy an `erc20_advanced` token
  through the UI, then check its behaviour on-chain with fresh funded
  anvil accounts: holders can't transfer before "Enable trading"; after
  it, wallet-to-wallet transfers are untaxed, a sell to a pair registered
  in the panel pays the 5% sell tax and a buy from it the 3% buy tax,
  each split 60/40 to the fee wallets; new limits set in the panel reject
  an oversized transfer and an over-full wallet while the pair stays
  uncapped; renouncing leaves `owner()` at the zero address. Reads after
  each UI action are polled — anvil can briefly answer `eth_call` from the
  previous block right after a receipt.
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
- `account-linking.spec.ts` — both fixture wallets in one browser, like a
  user with MetaMask and Phantom: the Solana wallet signs in and gets a
  project → sign out → the EVM wallet signs in (can't see it) → links the
  Solana wallet from the account menu with a real ed25519 signature → the
  Solana account merges in and its project appears → signing in with the
  Solana wallet now opens the same account. Unlinks at the end so the shared
  fixture wallets stay separate accounts for the other specs.
- `candy-machine-big-drop.spec.ts` — a 150-item drop (well past the old
  20-item cap, and more than one transaction holds): seeded through the
  API, launched through the actual page — the creation transaction carries
  the first items, the rest load via the fake Phantom's
  `signAllTransactions` in one batch — then the storefront shows all 150
  available, a mint succeeds, and the dashboard reads 1 / 150.
- `candy-machine-phases.spec.ts` — launch a two-item drop through the
  actual form with an allowlist phase (the fixture wallet + one other, open
  now; public phase tomorrow). Recording itself proves the on-chain guard
  groups are right — the backend reads them back and checks prices, dates,
  payment destination, and the merkle root. Then: a wallet not on the list
  gets a 403 from the mint API; the listed wallet sees the allowlist phase
  on the storefront and mints at the allowlist price through a real
  merkle-proof `route` + mint; the dashboard shows the allowlist phase and a
  revenue range Then the same live drop is edited through the dashboard's
  "Edit phases" dialog (allowlist removed, public opened now at a new
  price — one creator-signed guard update, saved only after the backend
  reads it back from the chain), and the storefront mints at the new price.
  The drop also launches with a limit of 1 per wallet: after the allowlist
  mint the storefront shows the limit reached and the mint API refuses the
  wallet (403); the edit raises it to 2, and the final public mint succeeds
  — the counter is shared across phases.
- `solana-token.spec.ts` — sign in with Solana → create a Token project
  on Solana through the project wizard (lands on the Launchpad's Solana tab
  with the project's context bar) → fill the Solana form through the actual UI, including a real logo file
  upload → launch (real Pillow logo check, logo + metadata JSON pinned
  through the Pinata stub, real sidecar-built Token Metadata transaction,
  real signature, real on-chain confirmation, real backend re-verification)
  → then read the chain directly, independent of anything the app reports:
  the mint's decimals/supply, mint and freeze authority both revoked, the
  creator holding the full supply, and a real Token Metadata account
  carrying the token's name — and the project dashboard shows the project
  linked to that mint. A second test launches a token keeping both
  authorities and uses its Manage panel: mint 500 more, revoke freeze, fix
  the supply — reading the mint account on the validator after each —
  then rename it and add a description, and lock its metadata (the new name
  read from the Token Metadata account; immutability read back on-chain).
- `nft-evm-deploy.spec.ts` — seed a published two-item collection via the
  API → deploy it as an ERC-721 through the actual `/nft/deploy-evm` page
  (metadata folder pinned through the Pinata stub's directory support, real
  compile, real signature, anvil receipt re-verified by the backend) → read
  the contract back on-chain (name, symbol, owner, supply, price, base URI)
  → switch public minting on through the page (a real owner transaction) →
  a second anvil account mints both tokens, paying the real price → each
  `tokenURI` resolves through the stub gateway to the right item's
  metadata (token 1 → first item, token 2 → second).
  Then the owner's Manage panel: withdraw (the contract's 0.02 ETH of mint
  proceeds lands in the creator's wallet, contract balance 0), set a new
  price, and pause minting — each a real owner transaction, each checked
  on anvil directly.
- `nft-generator.spec.ts` — sign in with EVM (auth only; nothing here is
  chain-specific) → create a collection, add a layer, and upload a real
  trait image, all through the actual multi-step upload UI (not seeded via
  API — this is the one flow whose only prior coverage was component-level,
  e.g. `LayerCard.test.tsx`, never a full click-through) → generate →
  publish to IPFS (real Pinata-shaped pin through the local stub) → open the
  metadata preview and confirm it shows the real pinned content read back
  through the stub's gateway, not a stale pre-publish placeholder. A second
  test covers real edit/delete of a trait, a layer, and a collection through
  the same UI (rename, reweight, and the actual DELETE/cascade round trips —
  not just that the button exists). A third covers the bulk AI trait
  analyzer independent of any collection, including a real AI-vision round
  trip (against the local OpenAI stub, see above) on every image in the
  batch. A fourth covers the AI Trait Identifier's other entry point —
  `LayerCard.tsx`'s inline "AI" suggest button during a single trait's
  upload — through the actual upload UI, not just the API in isolation. A
  fifth adds a trait rule through the real editor on a seeded 3 × 3
  collection, sees the possible count drop from 9 to 8, generates all 8,
  and checks none pairs the two excluded traits.
- `accessibility.spec.ts` — a real `@axe-core/playwright` scan (WCAG 2 A/AA)
  of the marketing homepage and every authenticated app-shell route, in the
  same real Chromium instance every other spec here uses. Closes a gap this
  project's own accessibility review had explicitly left open pending "a
  real browser" (`docs/REBUILD_PROGRESS.md`) — this suite already had one
  the whole time, for wallet-signing reasons unrelated to accessibility,
  it just hadn't been pointed at axe yet. Found and fixed a real, systemic
  color-contrast failure (see the root `README.md`'s verification-status
  note) — not a hypothetical the review had flagged as merely unverified.

## What isn't covered yet

- The Candy Machine's own devnet click-through checklist
  (`docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`) is separate from this
  suite — that's a manual, real-devnet verification step for the
  blockhash-expiry fix specifically, not something a local validator run
  substitutes for (the fix needs to be proven against real network latency
  between wallet approvals, which a fast local validator can't reproduce).
- ~~AI Trait Identifier (optional OpenAI-backed rarity suggestions) — hits a
  real paid third-party API this suite has no reason to depend on.~~ Closed:
  now covered via a local OpenAI stub, same pattern as Pinata — see "Why a
  local OpenAI stub" above and the two AI-vision assertions under "What's
  covered so far". What's still genuinely unverified by this suite: the real
  OpenAI model's actual judgment quality (style/mood/rarity classification
  of real artwork) — the stub proves the integration is real, not that
  `gpt-4o-mini`'s opinions are good ones. That's a product/prompt-quality
  question, not something browser automation can check.

## Real-network smoke test (Solana devnet)

The Playwright suite runs everything against a local validator. `e2e/devnet/`
runs the same Solana flows against a **real** cluster, through the real
backend API with a real keypair — everything the browser does, minus the
browser: sign-in, SPL token launch, a Candy Machine with an allowlist phase
and a per-wallet mint limit (allowlist mint, outsider and over-limit
refusals), editing the live drop, a public mint, and the dashboard. The
backend's own on-chain checks run against the real cluster, which is the
point — they're the parts most sensitive to real-network timing. IPFS stays
the local stub (on-chain operations store metadata URIs, never fetch them).

```bash
cd frontend
bash e2e/devnet/run-stack.sh &            # backend :5100, sidecar :4100, Pinata stub
node e2e/devnet/smoke.mjs --keypair ~/devnet-wallet.json
```

The wallet needs about 0.15 SOL of **devnet** SOL (a run spends ~0.04); fund
it at https://faucet.solana.com. Each check prints PASS/FAIL, every
transaction prints an explorer link, and the run stops at the first failure.
Against a local validator instead: `SOLANA_RPC_URL=http://127.0.0.1:8899
bash e2e/devnet/run-stack.sh` and `--rpc http://127.0.0.1:8899 --airdrop`.
