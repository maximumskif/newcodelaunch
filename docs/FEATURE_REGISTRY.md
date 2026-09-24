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

Last updated 2026-09-15 (NFT Generator's "Generate collection" row corrected for the 2026-09-13 background-job move — was still describing the old synchronous 200-item/no-progress-UI behavior). See `docs/REBUILD_PROGRESS.md` for the living build checklist this doc summarizes the user-facing side of.

## Marketing site (`/`)

| Action | Status | Notes |
|---|---|---|
| Hero CTAs → Token Launchpad / Contracts Hub | Real | Real routes, not anchors to nowhere. |
| "Start here" tiles: Token, NFT, Contracts Hub | Real | Link out to the real pages. |
| "Start here" tile: Mint Site | Real | Links to `/mint`, real end to end since the Candy Machine creator flow + public storefront both shipped (2026-08-15/17). |
| "How it works" steps | Real | Describes only what's actually implemented (no testnet-gate/dashboard step invented). |
| Security & transparency claims | Real | All 4 points independently true today (no server-side key custody, client-side signing only, real inspectable contract source, live network status). |
| Nav "Products" dropdown | Real | Auto-derived from `lib/products.ts` — every entry with a `path` is a real page; entries without one would show a "Soon" badge instead (none currently — every listed product is real as of the Candy Machine creator flow). |
| Wallet connect (EVM) | Real | wagmi + MetaMask/injected connector, nonce + signature → JWT. |
| Wallet connect (Solana) | Real | `@solana/wallet-adapter` (Phantom), nonce + signature → JWT. |

## Dashboard (`/dashboard`) & New Project wizard (`/projects/new`)

| Action | Status | Notes |
|---|---|---|
| List projects | Real | `GET /api/projects`, real persisted records. |
| New Project → pick type → name it → create draft | Real | Creates a real `Project` row, hands off into the real Token/NFT/Contracts page. |
| Resume a draft | Real | Restores template/parameters/network (tokens/contracts) or the linked collection (NFT) from `draft_data`. |
| Archive / Unarchive / Delete | Real | `PATCH`/`DELETE /api/projects/:id`. |
| Switch project (from the Token/Contracts/NFT/Mint pages, not the Dashboard itself) | Real | Added 2026-09-13. `ProjectContextBar`'s "Switch project" dropdown, shown whenever a page is reached via `?project=<id>`; lists the user's other real projects (`GET /api/projects`) and navigates straight to each one's own page. |

## Token Launchpad (`/tokens`) & Smart Contracts Hub (`/contracts`)

| Action | Status | Notes |
|---|---|---|
| Live chain status grid (Contracts Hub only) | Real | Live RPC calls per network — actually reachable or not, not a static "connected" badge. |
| Template selection | Real | 3 real, complete Solidity templates (`erc20_basic`, `erc20_advanced`, `erc721_basic`) — not the legacy app's 7 dead stub templates. Parameters are validated against their declared types and rendered safely (escaped string literals, checksummed addresses, defaults filled in); names can contain spaces — the contract identifier is derived (2026-09-24). |
| Estimate cost | Real | Live gas estimate against the compiled bytecode via the selected network's RPC. |
| Mainnet confirmation checkbox | Real | Required before Deploy is enabled on any mainnet network; re-arms on every network switch. This is a frontend-only gate by architecture, not a backend one — the backend never holds signing authority to gate (see `docs/REBUILD_PROGRESS.md`'s Phase 4 note). |
| Deploy | Real | Backend compiles via `py-solc-x`; your connected wallet signs and broadcasts client-side — no private key ever reaches the server. |
| Deployment history | Real | Persisted in Postgres, independently re-verified against the chain (`get_transaction_status`) before being recorded — including that the receipt created the claimed contract, from the claimed deployer (2026-09-24). |
| Verify source (deploy result + every history row) | Real (optional config) | Added 2026-09-24. Submits the exact standard-JSON compiler input the contract was deployed from to Etherscan's multichain V2 API (Etherscan, Polygonscan, BscScan and their testnets, one `ETHERSCAN_API_KEY`), polls until it settles, and links to the verified code. Works for contracts deployed before this feature too — the compile path keeps the same source name, so their bytecode reproduces byte-for-byte. Without a key: a clean 503 saying so. |
| Solana SPL token launch (Token Launchpad → "Solana") | Real (optional config) | Added 2026-09-24. Classic SPL token + Metaplex Token Metadata (name, symbol, optional description/logo), built by `services/candy-machine/src/routes/token.ts` in one transaction; your connected Solana wallet signs, pays, receives the full supply, and keeps update authority. Mint and freeze authority are revoked by default (fixed supply, no freezing holders), each opt-out-able. Recording re-verifies on-chain (success, fee payer = your wallet, mint referenced) and reads decimals/supply/authorities back from the mint account itself. Optional config: a description or logo needs Pinata (clean 503 otherwise); a name+symbol-only token needs no IPFS at all. Not linked to Projects yet (projects' token drafts are EVM-template-shaped). |
| Solana token history | Real | `GET /api/solana-tokens` — your launches, with "Fixed"/"Mintable"/"Freezable" badges from what the chain said at record time. |

## NFT Collection Generator (`/nft`)

| Action | Status | Notes |
|---|---|---|
| Create collection / add layer / upload trait | Real | Persisted, real file storage. |
| AI-assisted rarity suggestion ("AI Suggest") | Real (optional config) | Real CV analysis (color/composition/technical) always runs; the AI-vision fields only appear if `OPENAI_API_KEY` is set — never faked when it's absent. |
| Generate collection | Real (capped) | Real rarity-weighted PIL compositing, deduped against actual trait combinations, run as a background job (`backend/app/services/nft_generation_jobs.py`) with live "Generating N / M…" progress — capped at 10,000 items/call (was 200 before the background-job move, 2026-09-13). |
| Preview metadata | Real | Published items fetch the literal JSON already pinned to IPFS; unpublished items show an honest preview with `image`/`created_at` left `null` rather than guessed. |
| Download metadata JSON | Real | Real browser download of exactly what's previewed. |
| Publish to IPFS | Real (optional config) | Real Pinata upload; returns a clear 503 if `PINATA_JWT`/keys aren't configured, never a fake hash. |
| Deploy on EVM (`/nft/deploy-evm`, from "Deploy on EVM" beside "Launch Mint Site") | Real (optional config) | Added 2026-09-24. Pins every published item's metadata as one IPFS directory (`1.json`…`N.json`, token ids in generation order), then deploys `erc721_basic` with that base URI through the ordinary compile → your-wallet-deploys → verify+record flow, on whichever EVM network the top bar has selected. Mint price is entered in the network's native token, not wei. Public minting starts off; "Enable public minting" sends the real owner-only `setMintingEnabled(true)`. The recorded deployment is linked to the collection, which lists where it's deployed. Needs Pinata (same as publishing). |

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

## Candy Machine (`/mint`) — creator flow

| Action | Status | Notes |
|---|---|---|
| Launch a Candy Machine from a published NFT collection | Real (capped) | Real `@metaplex-foundation/umi` + `mpl-core-candy-machine`/`mpl-core` on-chain creation (Core Collection + guarded Core Candy Machine + config lines) via `services/candy-machine` — migrated 2026-08-19 from the legacy `mpl-candy-machine` stack after its Guard↔Core CPI was found broken everywhere (Metaplex deprecated it); verified end to end against real devnet transactions, not just typechecked. Your connected Solana wallet signs and pays for everything — the sidecar generates only single-use, in-memory ephemeral signers for the two brand-new accounts, never a platform authority key. Capped at 20 items per drop (documented limit, same spirit as the NFT generator's own cap). |
| Allowlist phase (optional, at launch) | Real | Added 2026-09-24. A list of up to 2,000 wallets gets its own price and start time, ending when public minting opens — implemented as two on-chain guard groups (`wl`: merkle-root allowList + solPayment + start/end dates; `pub`: solPayment + start date), so it's enforced by the Candy Guard program, not just the app. Recording reads the guard configuration back from the chain and rejects any mismatch — prices, dates, payment destination, and the merkle root of the claimed list (single-phase drops get the same price/date/destination check). |
| Edit a live drop's phases (dashboard → "Edit phases") | Real | Added 2026-09-24. Change the public price and go-live, and add, change or remove the allowlist phase, on a drop that's already selling. One `updateCandyGuard` transaction signed by the creator's wallet (the guard's authority — any other wallet is rejected by the program itself); the backend saves the new phases only after reading the guard configuration back from the chain and finding it matches. Mints already made keep what they paid, and the dashboard's revenue range keeps covering every price the drop has had. |
| Mainnet confirmation checkbox | Real | Same pattern as the EVM mainnet gate — required before launching on Solana Mainnet, defaults to Solana Devnet. |
| Reachable via "Launch Mint Site" in the NFT Generator | Real | Only appears once at least one item is published to IPFS. |
| Creator dashboard (`/mint` with no collection) | Real | Added 2026-09-24. Every drop you launched with live on-chain sales read through the sidecar — minted/total with a progress bar, revenue (minted x price, exactly what the solPayment guard paid your wallet; a min–max range for a drop with an allowlist phase, since the chain doesn't record which phase each mint came through), live/scheduled/sold-out status, storefront + explorer links — and revenue totals per network (devnet and mainnet never summed). A drop whose on-chain status can't be read shows "Unavailable" without failing the rest. |
| Shareable public mint link after launch | Real | Links straight to the public storefront below for the just-created candy machine. |

## Public mint storefront (`/mint/buy/:candyMachineId`)

| Action | Status | Notes |
|---|---|---|
| View a live drop (no account needed) | Real | `GET /api/mint/public/<candy_machine_address>` — unauthenticated. Collection name/description/preview image come from what the creator's own launch already recorded; `items_redeemed`/`items_remaining` are read fresh from the on-chain Candy Machine account on every load, since that's the one thing that changes with every mint. |
| Mint from a live drop | Real | Any visitor connects their own Solana wallet and mints directly — a real `mintV1` (guard-gated, Core Candy Machine) transaction via `services/candy-machine`, partially signed the same way as the creator flow (fresh ephemeral signer for the new Core Asset, noop signer for the buyer's wallet). This app never holds the buyer's funds or key. |
| Sold-out / not-live-yet states | Real | Mint button is replaced with an explanatory empty state once `items_remaining` hits 0 or before the drop's recorded go-live date. |
| Allowlist-phase storefront | Real | Added 2026-09-24. Shows both phases with their prices and windows; a connected wallet is checked against the allowlist server-side (the list itself is never sent to the browser — on-chain there's only its merkle root). A listed wallet mints at the allowlist price through a real merkle-proof `route` + mint in one transaction; anyone else sees when public minting opens, and the backend refuses to build their mint (403). |
| Mainnet confirmation checkbox | Real | Same pattern as the creator flow's — required before minting on Solana Mainnet. |
