# Feature Registry

Every visible action in the app, classified honestly. This is the answer to
"if I click this, what actually happens?" — written for whoever picks this
project up next, and as a check against the app quietly drifting into
claiming something works when it doesn't.

**Status legend**
- **Real** — fully functional, backed by a real implementation and (where relevant) real external data. No fabricated numbers, fake authors, simulated transactions, or `random.uniform()` placeholders anywhere in this app — that's a hard rule carried through the whole rebuild, not just a label here.
- **Real (capped)** — real, but with a known, documented limit (e.g. batch size) rather than full scale.
- **Real (optional config)** — real when its API key/credential is set; fails with a clear error instead of faking a result when it isn't.
- **Unavailable** — not built. Shown with a "Soon" badge or a disabled tile, never a dead link or a button that does nothing.

Last updated 2026-08-15, alongside the Phase 7 accessibility pass. See `docs/REBUILD_PROGRESS.md` for the living build checklist this doc summarizes the user-facing side of.

## Marketing site (`/`)

| Action | Status | Notes |
|---|---|---|
| Hero CTAs → Token Launchpad / Contracts Hub | Real | Real routes, not anchors to nowhere. |
| "Start here" tiles: Token, NFT, Contracts Hub | Real | Link out to the real pages. |
| "Start here" tile: Mint Site | Unavailable | Disabled, non-clickable tile — not a dead link. |
| "How it works" steps | Real | Describes only what's actually implemented (no testnet-gate/dashboard step invented). |
| Security & transparency claims | Real | All 4 points independently true today (no server-side key custody, client-side signing only, real inspectable contract source, live network status). |
| Nav "Products" dropdown | Real | Auto-derived from `lib/products.ts` — every entry with a `path` is a real page; entries without one show a "Soon" badge (currently just Candy Machine). |
| Wallet connect (EVM) | Real | wagmi + MetaMask/injected connector, nonce + signature → JWT. |
| Wallet connect (Solana) | Real | `@solana/wallet-adapter` (Phantom), nonce + signature → JWT. |

## Dashboard (`/dashboard`) & New Project wizard (`/projects/new`)

| Action | Status | Notes |
|---|---|---|
| List projects | Real | `GET /api/projects`, real persisted records. |
| New Project → pick type → name it → create draft | Real | Creates a real `Project` row, hands off into the real Token/NFT/Contracts page. |
| Resume a draft | Real | Restores template/parameters/network (tokens/contracts) or the linked collection (NFT) from `draft_data`. |
| Archive / Unarchive / Delete | Real | `PATCH`/`DELETE /api/projects/:id`. |

## Token Launchpad (`/tokens`) & Smart Contracts Hub (`/contracts`)

| Action | Status | Notes |
|---|---|---|
| Live chain status grid (Contracts Hub only) | Real | Live RPC calls per network — actually reachable or not, not a static "connected" badge. |
| Template selection | Real | 3 real, complete Solidity templates (`erc20_basic`, `erc20_advanced`, `erc721_basic`) — not the legacy app's 7 dead stub templates. |
| Estimate cost | Real | Live gas estimate against the compiled bytecode via the selected network's RPC. |
| Mainnet confirmation checkbox | Real | Required before Deploy is enabled on any mainnet network; re-arms on every network switch. This is a frontend-only gate by architecture, not a backend one — the backend never holds signing authority to gate (see `docs/REBUILD_PROGRESS.md`'s Phase 4 note). |
| Deploy | Real | Backend compiles via `py-solc-x`; your connected wallet signs and broadcasts client-side — no private key ever reaches the server. |
| Deployment history | Real | Persisted in Postgres, independently re-verified against the chain (`get_transaction_status`) before being recorded. |

## NFT Collection Generator (`/nft`)

| Action | Status | Notes |
|---|---|---|
| Create collection / add layer / upload trait | Real | Persisted, real file storage. |
| AI-assisted rarity suggestion ("AI Suggest") | Real (optional config) | Real CV analysis (color/composition/technical) always runs; the AI-vision fields only appear if `OPENAI_API_KEY` is set — never faked when it's absent. |
| Generate collection | Real (capped) | Real rarity-weighted PIL compositing, deduped against actual trait combinations — capped at 200 items/call, no progress UI yet (documented gap, not urgent at this cap). |
| Preview metadata | Real | Published items fetch the literal JSON already pinned to IPFS; unpublished items show an honest preview with `image`/`created_at` left `null` rather than guessed. |
| Download metadata JSON | Real | Real browser download of exactly what's previewed. |
| Publish to IPFS | Real (optional config) | Real Pinata upload; returns a clear 503 if `PINATA_JWT`/keys aren't configured, never a fake hash. |

## Market Intelligence (`/market`)

| Action | Status | Notes |
|---|---|---|
| Token price/market table | Real (optional config) | Real CoinGecko `/coins/markets` data, refreshed every 60s. Works unauthenticated too, just at CoinGecko's lower public rate limit if `COINGECKO_API_KEY` isn't set. |

## DeFi Protocol Scanner (`/defi`)

| Action | Status | Notes |
|---|---|---|
| Protocol TVL table | Real | Real DeFiLlama `/protocols` data, no API key needed. |

## Template Marketplace (`/marketplace`)

| Action | Status | Notes |
|---|---|---|
| Browse templates | Real | Same 3 real templates the Token Launchpad/Contracts Hub deploy from — real name/description/features/gas estimate, no fabricated authors/ratings/download counts. |
| "Use this template" | Real | Routes into Token Launchpad or Contracts Hub with that template pre-selected. |

## Not yet built

| Feature | Status | Notes |
|---|---|---|
| Candy Machine / mint-site (Solana) | Unavailable | `services/candy-machine/` sidecar scaffold + internal-auth contract exist, but no real Metaplex Umi minting is wired up yet. Shown as "Soon" in nav/sidebar, `/mint` is an honest placeholder route, not a dead link. |
