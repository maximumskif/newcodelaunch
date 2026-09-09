# NewCodeLaunch

Build and launch tokens, NFT collections, and Solana Candy Machine drops through guided, wallet-connected workflows.

The paragraphs below describe what's actually implemented and verified, not a roadmap dressed up as a feature list — see `docs/REBUILD_PROGRESS.md` for the living status (every phase, every fix, dated), `docs/FEATURE_REGISTRY.md` for a per-action real/capped/optional-config/unavailable breakdown of every visible button in the app, and `docs/REBUILD_AUDIT.md` for how this project's predecessor was assessed before this rebuild started.

**Verification status, read before trusting any of this in production**: the EVM token/contract deploy flow, the Solana Candy Machine flow (launch + public mint), and the NFT Generator's own upload UI all now have real end-to-end browser coverage (`frontend/e2e/`) — a real backend, a real Solidity compile / real Metaplex program calls, a real local chain (`anvil` / `solana-test-validator`), a real wallet signature, driven through an actual Chromium browser in CI on every push. These passes caught and fixed several real bugs that had survived every prior layer of testing: compiled bytecode missing its required `"0x"` prefix (every real EVM deployment was reverting on-chain), a stale-closure bug that left a successful deployment stuck showing "recording…" forever in the UI, a Solana commitment-level mismatch (`"confirmed"` vs. solana-py's default `"finalized"`) that could make the backend fail to find a transaction the frontend had already confirmed, a config-key typo that made Redis-backed rate limiting silently a no-op, a missing Pinata gateway override that 502'd the NFT metadata-preview feature for any already-published item, a `ZeroDivisionError` in the AI Trait Identifier's composition analysis that had been live and crashable (on any 1px-wide upload) since Phase 3, and — via a real `@axe-core/playwright` scan of every page, closing an accessibility review this project had explicitly left open pending "a real browser" — a systemic color-contrast failure: the `ink-faint` text token (a 38%-white alpha blend) measured 3.47–3.57:1 against every dark background it was used on, short of WCAG AA's 4.5:1 minimum, on the marketing homepage and 5 of 6 authenticated routes. Fixed by raising it to 50%; all pages now measure violation-free. See `docs/REBUILD_PROGRESS.md`'s "Testing & CI"/"Reliability"/"NFT Generator"/"Accessibility" entries for the full writeups. The Candy Machine launch flow's blockhash-expiry issue (`docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`) is code, but not yet devnet-click-through-verified — a fast local validator can't reproduce the real network latency between wallet approvals the fix is actually for, so that's still the next thing to confirm before trusting it in production.

## What works today

- **Wallet-signature authentication** — EVM (wagmi/viem) and Solana (`@solana/wallet-adapter`), nonce + signature verified server-side, JWT issued on success. No password login, no server-side key custody.
- **Marketing homepage & authenticated app shell** — a real homepage (not a placeholder), collapsible sidebar, network selector, and a `Project` model backing a multi-step creation wizard with save/resume, plus a dashboard listing real projects/drafts/deployments.
- **Token Launchpad & Smart Contracts Hub** — real, compiled Solidity templates (ERC-20 basic/advanced, ERC-721 basic) via `py-solc-x`, live gas estimation, deployment signed and broadcast by the user's own connected wallet (the backend only compiles and estimates), deployment history persisted in Postgres, live network status for Ethereum, Polygon, BSC, and Solana. Testnet-first by default (Sepolia/Amoy/BSC Testnet/Devnet), with an explicit mainnet confirmation gate.
- **NFT Collection Generator** — layer/trait upload (single or bulk, with rename/reweight/delete and layer reordering afterward — no more starting over on a mistake), rarity-weighted generation with real PIL image compositing (not placeholder images, capped at 200 items/call), a real rarity-distribution view of what a generation run actually produced, publish-to-IPFS via Pinata, an inline AI-assisted rarity suggestion (optional GPT-4o vision call, real CV analysis runs regardless) during trait upload, and a standalone bulk AI trait analyzer for previewing a whole batch's rarity/diversity spread before uploading anything.
- **Solana Candy Machine — creator flow & public mint storefront** — launch a real Core Candy Machine drop from a published NFT collection (capped at 20 items) via the `services/candy-machine` sidecar, then share a public link any visitor can mint from with their own wallet. Testnet-first (Solana Devnet default), same mainnet-confirmation pattern as the EVM side.
- **Market Intelligence & DeFi Scanner** — real CoinGecko token prices and DeFiLlama protocol TVL, no API key required for either (an optional CoinGecko key raises its rate limit). No fabricated fallback data if either call fails.
- **Template Marketplace** — a read-only gallery over the same real contract templates the Token Launchpad/Contracts Hub deploy from.
- **Automated tests & CI** — pytest (backend, 95+ tests, including a real Redis service container backing the rate-limit storage tests) and Vitest (frontend, 50+ tests), plus real Playwright end-to-end tests for the EVM deploy flow (against a local `anvil` chain), the Solana Candy Machine flow (against a local `solana-test-validator`, real Metaplex programs cloned onto it), the NFT Generator's own multi-step upload UI including real edit/delete/reorder round trips, and a real `@axe-core/playwright` WCAG 2 A/AA scan of every page — see `frontend/e2e/`. Four GitHub Actions jobs (backend, frontend, e2e, Candy Machine sidecar) on every push/PR to `main`.

## Known gaps

- The AI Trait Identifier (real third-party OpenAI calls) doesn't have end-to-end browser coverage — see `frontend/e2e/README.md`'s "What isn't covered yet" for why.
- The accessibility scan checks WCAG 2 A/AA automatically (color contrast, ARIA, labels, etc.) — it can't check things that need a human judgment call, like whether focus order or screen-reader announcement order actually make sense. Nothing currently does.
- Candy Machine's blockhash-expiry risk was fixed 2026-09-06 (staged two-step launch flow — see `docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`), but not yet devnet-click-through-verified — that checklist is still open.
- NFT generation is synchronous and capped at 200 items/call; a background job queue is the natural next step if that cap needs to rise.
- `backend/Dockerfile` and `frontend/Dockerfile` are now wired into `docker-compose.yml` (see "Running the whole stack in Docker instead" above) but still aren't build-verified — no Docker in the sandbox that wrote them. Rate limiting itself defaults to in-memory storage (fine for a single dev process) — set `RATE_LIMIT_STORAGE_URI` to a `redis://` URL before running more than one backend worker; `docker compose up -d redis` starts one, and both the wiring and the cross-process sharing it exists for are covered by a real Redis instance in CI (`backend/tests/test_ratelimit_storage.py`), not mocked.
- No project switcher in the app shell yet (deliberately deferred pending real multi-project usage).
- A dependency bump (`oxlint` 1.78→1.82) surfaced 7 `set-state-in-effect` lint warnings across pre-existing code (`NFTGeneratorPage.tsx`, `MintBuyPage.tsx`, `ProjectsDashboard.tsx`, `MintLaunchPage.tsx`, `LayerCard.tsx`) — a real, if minor, React anti-pattern the older linter version couldn't see. Not fixed yet; nothing is failing, just warning. `Pillow`'s `Image.getdata()` (used twice in `ai_traits.py`) is deprecated as of Pillow 12 and goes away entirely in Pillow 14 (due 2027-10-15) — still works today, flagged here so it isn't forgotten.
- Some real dependency upgrades were deliberately held back rather than applied blindly: `flask-limiter`, `openai`, `web3`/`eth-account`/`solana`/`solders`, and `flask-cors` all have major-version updates available, but each is central enough to real chain/API behavior in this app that bumping needs its own dedicated pass with a full re-test, not a batch update. See `docs/REBUILD_PROGRESS.md`'s "Dependency updates" entry for the specifics, including one deliberately-pinned-behind dependency (`httpx`) that would have silently reintroduced a real crash if bumped along with everything else.

## Architecture

Monorepo:

- `backend/` — Flask JSON API. Application-factory pattern (`app/__init__.py`), blueprints per feature (`auth`, `blockchain`, `contracts`, `nft`, `projects`, `market`, `defi`, `mint`), a service layer for external calls and blockchain/compile logic, SQLAlchemy models, Postgres via `Flask-Migrate`.
- `frontend/` — Vite + React + TypeScript + Tailwind v4 single-page app.
- `services/candy-machine/` — Node/TypeScript/Express sidecar for the Metaplex Umi SDK (no mature Python tooling exists for Solana Candy Machine operations).

No Jinja templates, no server-rendered pages — the backend is a pure JSON API.

## Security principles

- The backend never receives, logs, or stores a private key or seed phrase. Contract deployment is compile/estimate-only server-side; the user's connected wallet signs and broadcasts.
- No hardcoded API keys or secrets in source. `SECRET_KEY` and third-party API keys are read from the environment with no insecure fallback default.
- See each package's `.env.example` for required/optional environment variables.

## Setup

Requires Python 3.11 (newer stock Pythons can lack prebuilt wheels for `numpy`/`Pillow`/`psycopg2-binary`; `uv python install 3.11` sidesteps this without needing sudo or a compiler), Node 24 (matching CI's pinned version), and Postgres (or use the provided `docker-compose.yml` for Postgres + the candy-machine sidecar). Redis is optional in dev — only add it once you're running the backend with more than one worker.

```bash
# Postgres + candy-machine sidecar (add `redis` too if running >1 backend worker)
docker compose up -d postgres candy-machine

# Backend — pin to Python 3.11 specifically (see the note above); `uv` gets
# you a real 3.11 without needing sudo or a compiler even if your system
# Python is newer:
#   curl -LsSf https://astral.sh/uv/install.sh | sh
#   uv python install 3.11
cd backend
cp .env.example .env   # fill in SECRET_KEY and JWT_SECRET_KEY at minimum — both are required, no fallback
uv venv --python 3.11 .venv && source .venv/bin/activate
uv pip install -r requirements.txt
flask db upgrade
flask run

# Frontend
cd frontend
cp .env.example .env
npm install
npm run dev
```

This has been execution-verified end-to-end against a real local backend, frontend, and Candy Machine sidecar (see `docs/REBUILD_PROGRESS.md`'s "First real local execution" entry, 2026-08-18) — but only in one sandboxed environment. If something in these steps doesn't work from a clean clone elsewhere, that's a real gap, not an assumption to paper over.

To run the real end-to-end test suite (see `frontend/e2e/README.md`), also install [Foundry](https://getfoundry.sh) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`) and Playwright's browser (`npx playwright install --with-deps chromium` — the `--with-deps` half needs `sudo`), then `npm run test:e2e` from `frontend/`.

### Running the whole stack in Docker instead

`docker-compose.yml` now wires up all four services (Postgres, the candy-machine sidecar, the backend, and the frontend behind nginx), not just the two without a Python/Node toolchain dependency:

```bash
cp backend/.env.example backend/.env   # fill in SECRET_KEY and JWT_SECRET_KEY at minimum
cp services/candy-machine/.env.example services/candy-machine/.env
docker compose up --build
# then open http://localhost:8080
```

This wiring is **not build-verified** — the sandbox that wrote it has no Docker available at all (see the comments at the top of `docker-compose.yml` and in each `Dockerfile`). It's been reviewed carefully (backend's image needs no compiler or system packages at all, since `psycopg2-binary` bundles its own `libpq`; the frontend image accepts `VITE_API_BASE_URL` etc. as build args so a real deploy isn't silently stuck pointing at `localhost`), but a real `docker compose up --build` on a machine with Docker is the next thing to confirm before trusting it — running the backend/frontend directly on the host (the steps above) remains the execution-verified path.
