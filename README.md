# NewCodeLaunch

Build and launch tokens, NFT collections, and Web3 projects through guided no-code workflows.

This is an early-stage rebuild. The paragraphs below describe what's actually implemented and verified, not a roadmap dressed up as a feature list — see `docs/REBUILD_PROGRESS.md` for the living status, `docs/FEATURE_REGISTRY.md` for a per-action real/capped/optional-config/unavailable breakdown of every visible button in the app, and `docs/REBUILD_AUDIT.md` for how this project's predecessor was assessed before this rebuild started.

## What works today

- **Wallet-signature authentication** — EVM (wagmi/viem) and Solana (`@solana/wallet-adapter`), nonce + signature verified server-side, JWT issued on success. No password login, no server-side key custody.
- **Token Launchpad** — real, compiled Solidity templates (ERC-20 basic/advanced, ERC-721 basic) via `py-solc-x`, live gas estimation, deployment signed and broadcast by the user's own connected wallet (the backend only compiles and estimates), deployment history persisted in Postgres.
- **Smart Contracts Hub** — the same compile/estimate/deploy flow across all templates, plus live network status for Ethereum, Polygon, BSC, and Solana.
- **NFT Collection Generator** — layer/trait upload, rarity-weighted generation with real PIL image compositing (not placeholder images), publish-to-IPFS via Pinata, and an inline AI-assisted rarity suggestion (optional GPT-4o vision call) during trait upload.

## Not built yet

- Marketing homepage (current homepage is a placeholder)
- Authenticated app shell (sidebar, project switcher, dashboard) and a persisted project/draft system
- DeFi Protocol Scanner, Market Intelligence, Template Marketplace
- Candy Machine mint-site (the Node/Umi sidecar in `services/candy-machine` is scaffolded but not wired to a route)
- Automated tests and CI for the current stack
- Testnet-first defaults — the app currently points at mainnet RPCs by default; explicit testnet-vs-mainnet UI and a mainnet confirmation gate are not implemented yet

## Architecture

Monorepo:

- `backend/` — Flask JSON API. Application-factory pattern (`app/__init__.py`), blueprints per feature (`auth`, `blockchain`, `contracts`, `nft`), a service layer for external calls and blockchain/compile logic, SQLAlchemy models, Postgres via `Flask-Migrate`.
- `frontend/` — Vite + React + TypeScript + Tailwind v4 single-page app.
- `services/candy-machine/` — Node/TypeScript/Express sidecar for the Metaplex Umi SDK (no mature Python tooling exists for Solana Candy Machine operations).

No Jinja templates, no server-rendered pages — the backend is a pure JSON API.

## Security principles

- The backend never receives, logs, or stores a private key or seed phrase. Contract deployment is compile/estimate-only server-side; the user's connected wallet signs and broadcasts.
- No hardcoded API keys or secrets in source. `SECRET_KEY` and third-party API keys are read from the environment with no insecure fallback default.
- See each package's `.env.example` for required/optional environment variables.

## Setup

Requires Python 3.11+, Node 20+, and Postgres (or use the provided `docker-compose.yml` for Postgres + the candy-machine sidecar).

```bash
# Postgres + candy-machine sidecar
docker compose up -d postgres candy-machine

# Backend
cd backend
cp .env.example .env   # fill in SECRET_KEY at minimum
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
flask db upgrade
flask run

# Frontend
cd frontend
cp .env.example .env
npm install
npm run dev
```

This setup has not been execution-verified end-to-end in every development environment — if something in these steps doesn't work from a clean clone, that's a real gap, not an assumption to paper over.
