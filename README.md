# NewCodeLaunch

Build and launch tokens, NFT collections, and Solana Candy Machine drops through guided, wallet-connected workflows.

The paragraphs below describe what's actually implemented and verified, not a roadmap dressed up as a feature list — see `docs/REBUILD_PROGRESS.md` for the living status (every phase, every fix, dated), `docs/FEATURE_REGISTRY.md` for a per-action real/capped/optional-config/unavailable breakdown of every visible button in the app, and `docs/REBUILD_AUDIT.md` for how this project's predecessor was assessed before this rebuild started.

**Verification status, read before trusting any of this in production**: most of the flows below are backend-contract-verified and, for token deploy and the market/DeFi integrations, verified against real local execution and live third-party APIs. The two Solana money-moving flows (Candy Machine launch, public mint) have additionally been verified against real devnet transactions — but *no* flow in this app has ever been driven through an actual browser wallet extension end to end (no working headless browser has been available in the sandboxes this was built in). Backend/frontend logic is solid; a real click-through pass before wider release is still worth doing. See `docs/REBUILD_PROGRESS.md`'s "First real local execution" and "Full endpoint sweep" entries for exactly what has and hasn't been exercised. The Candy Machine launch flow's blockhash-expiry issue (`docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`) is now code, but not yet devnet-click-through-verified — that's the next thing to confirm before trusting it in production.

## What works today

- **Wallet-signature authentication** — EVM (wagmi/viem) and Solana (`@solana/wallet-adapter`), nonce + signature verified server-side, JWT issued on success. No password login, no server-side key custody.
- **Marketing homepage & authenticated app shell** — a real homepage (not a placeholder), collapsible sidebar, network selector, and a `Project` model backing a multi-step creation wizard with save/resume, plus a dashboard listing real projects/drafts/deployments.
- **Token Launchpad & Smart Contracts Hub** — real, compiled Solidity templates (ERC-20 basic/advanced, ERC-721 basic) via `py-solc-x`, live gas estimation, deployment signed and broadcast by the user's own connected wallet (the backend only compiles and estimates), deployment history persisted in Postgres, live network status for Ethereum, Polygon, BSC, and Solana. Testnet-first by default (Sepolia/Amoy/BSC Testnet/Devnet), with an explicit mainnet confirmation gate.
- **NFT Collection Generator** — layer/trait upload, rarity-weighted generation with real PIL image compositing (not placeholder images, capped at 200 items/call), publish-to-IPFS via Pinata, and an inline AI-assisted rarity suggestion (optional GPT-4o vision call, real CV analysis runs regardless) during trait upload.
- **Solana Candy Machine — creator flow & public mint storefront** — launch a real Core Candy Machine drop from a published NFT collection (capped at 20 items) via the `services/candy-machine` sidecar, then share a public link any visitor can mint from with their own wallet. Testnet-first (Solana Devnet default), same mainnet-confirmation pattern as the EVM side.
- **Market Intelligence & DeFi Scanner** — real CoinGecko token prices and DeFiLlama protocol TVL, no API key required for either (an optional CoinGecko key raises its rate limit). No fabricated fallback data if either call fails.
- **Template Marketplace** — a read-only gallery over the same real contract templates the Token Launchpad/Contracts Hub deploy from.
- **Automated tests & CI** — pytest (backend) and Vitest (frontend), 70+ backend tests and 29+ frontend tests, three GitHub Actions jobs (backend, frontend, Candy Machine sidecar) on every push/PR to `main`.

## Known gaps

- No true end-to-end browser test exists for any wallet-signing flow (see the verification-status note above).
- Candy Machine's blockhash-expiry risk was fixed 2026-09-06 (staged two-step launch flow — see `docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md`), but not yet devnet-click-through-verified — that checklist is still open.
- NFT generation is synchronous and capped at 200 items/call; a background job queue is the natural next step if that cap needs to rise.
- `backend/Dockerfile` and `frontend/Dockerfile` exist but aren't build-verified (no Docker in the sandbox that wrote them) and aren't wired into `docker-compose.yml` yet. Rate limiting defaults to in-memory storage — set `RATE_LIMIT_STORAGE_URI` to a `redis://` URL before running more than one backend worker (the `redis` client is already a dependency).
- No project switcher in the app shell yet (deliberately deferred pending real multi-project usage).

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

Requires Python 3.11 (newer stock Pythons can lack prebuilt wheels for `numpy`/`Pillow`/`psycopg2-binary`; `uv python install 3.11` sidesteps this without needing sudo or a compiler), Node 24 (matching CI's pinned version), and Postgres (or use the provided `docker-compose.yml` for Postgres + the candy-machine sidecar).

```bash
# Postgres + candy-machine sidecar
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
