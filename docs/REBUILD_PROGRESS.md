# Rebuild Progress

Living checklist. Update this as work lands — keep entries terse, one line of evidence each. See `docs/REBUILD_AUDIT.md` for the full reasoning behind any decision referenced here.

> This repo (`newcodelaunch`) is a clean split-off, created 2026-08-14, from `nocodelaunchyeet` — a repo whose git history turned out to still contain the entire legacy monolith (`app.py`, `templates/`, ~50 root Python modules) sitting alongside the `backend/`/`frontend/`/`services/` rebuild. Rather than move the legacy code into a `legacy/` subfolder as the audit's §8 originally proposed, only the verified-real rebuild code was carried into this repo; the legacy code and its full history remain in `nocodelaunchyeet` for reference. That supersedes the "move to `legacy/`" checklist item below.

## Phase 0 — Baseline
- [x] Repo audit complete — `docs/REBUILD_AUDIT.md` (2026-08-14, written pre-split, carried over verbatim). Legacy app not execution-verified (no pip/venv in this sandbox); confirmed via `py_compile` + static analysis instead. New backend `py_compile`-clean; new frontend `tsc -b` + `oxlint` + `vite build` all clean.
- [x] Confirmed the legacy monolith and the rebuild coexisted in one repo/branch — resolved by splitting into this repo, carrying over only the rebuild code.

## Phase 1 — Architecture & design system
- [x] Canonical architecture decided: `backend/` (Flask app-factory, blueprints, services, SQLAlchemy) + `frontend/` (Vite/React/TS) + `services/candy-machine/` (Node sidecar). Documented in audit §8.
- [ ] React-vs-Jinja choice explicitly ratified by the user (audit recommends keeping React; needs a yes/no).
- [x] Legacy code split out — this repo (`newcodelaunch`) carries over only `backend/`, `frontend/`, `services/candy-machine/`; legacy monolith stays in `nocodelaunchyeet`, not copied here.
- [ ] Design tokens (color/type/spacing/radii/shadow/motion/breakpoints) — not started. Current frontend uses ad hoc Tailwind per component.
- [ ] Visual direction dialed back per spec (one primary accent, no gradient/glow overuse) — the most recent design pass (in the source repo, pre-audit) went the other way and needs revisiting here.

## Phase 2 — Homepage & app shell
- [ ] Marketing homepage — not started. `Home()` in `App.tsx` is a 2-line placeholder.
- [ ] Global nav redesign (logo, Products, Templates, How It Works, Docs, sign-in/dashboard, Start Building CTA) — not started.
- [ ] Authenticated app shell (sidebar, project switcher, network selector, wallet state, user menu) — not started. Every feature is currently a flat top-level route.
- [ ] Shared UI component library — partially exists (`frontend/src/features/nft/ui/*`: Dropzone, RarityBadge, Stepper, PageHero) but scoped to one feature, not app-wide.

## Phase 3 — Core project system
- [ ] `Project` model (type/network/status/draft) — not started. Token deployments and NFT collections exist as separate per-feature records, no unifying project.
- [ ] Multi-step project wizard with save/resume — not started.
- [ ] Dashboard with real persisted projects/drafts/deployments — not started.
- [x] Auth is real: wallet-signature nonce + JWT, `backend/app/services/auth.py`. Per-user ownership enforced on NFT collection routes (`get_owned_collection` etc.); contracts/deployments — ownership scoping not reverified this pass.

## Phase 4 — Token workflow
- [x] Token config + Solidity compile (real `py-solc-x`) — `backend/app/services/solidity.py`, `contracts.py`.
- [x] Gas/cost estimation — `contracts.py` `estimate_deployment`.
- [x] Client-side signed deploy (no server-side private key) — `frontend/src/features/contracts/DeployPanel.tsx` + `useDeployTemplate.ts`.
- [x] Deployment history persisted — Postgres via `ContractDeployment` model.
- [ ] Testnet-first default — **gap**. `backend/app/config.py` network defaults are mainnet RPCs; frontend network picker defaults to `'ethereum'`.
- [ ] Folded into the Phase-3 project wizard — currently a standalone page, not part of a guided multi-step flow.

## Phase 5 — NFT workflow
- [x] Layer/trait upload, rarity weighting — `backend/app/services/nft_collections.py`, frontend `LayerEditor`/`LayerCard`.
- [x] Real compositing (PIL layer stack, not a fake URL) — `nft_compositing.py`.
- [x] Rarity-weighted bulk generation with dedupe — `nft_generation.py`, capped 200/call (documented limitation, needs a job queue for larger collections).
- [x] AI-assisted rarity suggestion, scoped inside the trait-upload step (not a standalone page) — `ai_traits.py` + inline "AI Suggest" button in `LayerCard.tsx`.
- [x] IPFS publish (real Pinata calls) — `ipfs.py`.
- [ ] Metadata preview/export as a distinct step — publish currently pushes straight to IPFS per item; no pre-publish metadata review screen.
- [ ] Progress reporting for large generation batches — currently synchronous, capped at 200 items with no progress UI (acceptable at current cap, revisit if the cap is raised).

## Phase 6 — Secondary features
- [ ] DeFi Protocol Scanner / Market Intelligence — not started (`ComingSoon` placeholder). Must use real DeFiLlama/CoinGecko calls only when built — no `random.uniform` fallback like the legacy version.
- [ ] Template Marketplace — not started. Must use real data when built — legacy version had fictional authors/download counts.
- [ ] Mint-site / Candy Machine — scaffold only (`services/candy-machine/`), internal-auth contract exists, no real Metaplex Umi minting yet.

## Phase 7 — Hardening
- [ ] Test suite — **not started at all**. `backend/tests/` is an empty directory. `frontend/package.json` has no test runner. This is the single biggest process gap right now and should start incrementally during Phases 3-5, not be deferred to the end.
- [ ] CI actually exercises this rebuild — **not started**. No `.github/workflows/` in this repo yet (the old one, left behind in `nocodelaunchyeet`, only ever tested the legacy app anyway).
- [ ] Accessibility review — not started.
- [ ] Performance review — not started (though `vite build` already flags a >500 KB chunk — wallet-adapter/wagmi weight, not yet addressed).
- [ ] Feature registry doc — not started.
- [x] README reflects only verified capabilities — done as part of the 2026-08-14 split (`README.md` explicitly separates "works today" from "not built yet").

## Known security items to close before mainnet is ever enabled
- [ ] Testnet-default + explicit mainnet-confirmation gate (see Phase 4).
- [x] Legacy server-side private-key signing routes (confirmed live in `nocodelaunchyeet`'s `app.py`, `smart_contract_deployer.py`, `blockchain_manager.py`) — resolved by not carrying that code into this repo at all.
