# Rebuild Progress

Living checklist. Update this as work lands — keep entries terse, one line of evidence each. See `docs/REBUILD_AUDIT.md` for the full reasoning behind any decision referenced here.

> This repo (`newcodelaunch`) is a clean split-off, created 2026-08-14, from `nocodelaunchyeet` — a repo whose git history turned out to still contain the entire legacy monolith (`app.py`, `templates/`, ~50 root Python modules) sitting alongside the `backend/`/`frontend/`/`services/` rebuild. Rather than move the legacy code into a `legacy/` subfolder as the audit's §8 originally proposed, only the verified-real rebuild code was carried into this repo; the legacy code and its full history remain in `nocodelaunchyeet` for reference. That supersedes the "move to `legacy/`" checklist item below.

## Phase 0 — Baseline
- [x] Repo audit complete — `docs/REBUILD_AUDIT.md` (2026-08-14, written pre-split, carried over verbatim). Legacy app not execution-verified (no pip/venv in this sandbox); confirmed via `py_compile` + static analysis instead. New backend `py_compile`-clean; new frontend `tsc -b` + `oxlint` + `vite build` all clean.
- [x] Confirmed the legacy monolith and the rebuild coexisted in one repo/branch — resolved by splitting into this repo, carrying over only the rebuild code.

## Phase 1 — Architecture & design system
- [x] Canonical architecture decided: `backend/` (Flask app-factory, blueprints, services, SQLAlchemy) + `frontend/` (Vite/React/TS) + `services/candy-machine/` (Node sidecar). Documented in audit §8.
- [x] React-vs-Jinja choice explicitly ratified by the user (2026-08-14) — keeping React.
- [x] Legacy code split out — this repo (`newcodelaunch`) carries over only `backend/`, `frontend/`, `services/candy-machine/`; legacy monolith stays in `nocodelaunchyeet`, not copied here.
- [x] Design tokens defined — `frontend/src/index.css` `@theme`: one accent hue (violet, `accent-50..800`), semantic status colors (success/warning/danger/info), semantic neutral surfaces (canvas/surface/surface-hover/border/border-strong/ink/ink-muted/ink-faint), restrained radii (sm/md/lg), one shadow token, motion tokens + `prefers-reduced-motion` support. Spacing/breakpoints/typography scale left as Tailwind v4 defaults (already sound, no need to reinvent) with a semantic `--font-sans`/`--font-mono` pair.
- [x] Reusable component library started — `frontend/src/components/ui/`: `Button` (primary/secondary/ghost/danger), `Card`, `Badge` (status pill), `EmptyState`, plus `Dropzone`/`Stepper`/`PageHero`/icon set promoted out of the NFT feature into app-wide components (closes the audit's "scoped to one feature" gap). `RarityBadge` stays NFT-specific, now built on top of `Badge`.
- [x] Visual direction dialed back per spec — removed all gradient buttons, blurred glow blobs (`PageHero`), and competing accent hues (indigo/purple/violet/fuchsia/sky simplified to one violet accent + semantic status colors) across every feature (nft, contracts, tokens, auth, app shell). Radii reduced from `-2xl/-3xl` to `-md/-lg` throughout.

## Phase 2 — Homepage & app shell
- [x] Marketing homepage — `frontend/src/features/marketing/HomePage.tsx`, wired at `/`. Hero (real CTAs → `/tokens`, `/contracts`), "Start here" creation-path cards (Token/NFT/Contracts Hub marked "Live" and link out; Mint Site marked "Coming soon" and is a non-clickable disabled tile — no dead links), a 5-step "how it works today" that only describes what's actually implemented (no testnet-gate or dashboard step, since those don't exist yet), an honest security/transparency section (4 points, all independently true today), minimal footer (no links to pages/docs that don't exist, no link to the still-private GitHub repo). Deliberately skipped the spec's "interactive wizard preview" widget in the hero — real content shipped first, decorative-but-functional preview can follow later.
- [x] Global nav redesign — `frontend/src/components/layout/Nav.tsx`, replaces the old flat feature-link list. Logo → `/`; "Products" dropdown (new `components/ui/Dropdown.tsx` primitive) lists the 3 live features as real links plus Candy Machine/DeFi Scanner/Market Intelligence with a "Soon" badge instead of a route to an empty `ComingSoon` page; "Templates" shown the same way (soon-badge, non-interactive — Template Marketplace isn't built, so it's not a link at all, consistent with the homepage's disabled Mint Site tile); "How It Works" and the new "Start Building" CTA are `#hash` links into the homepage's `#how-it-works`/`#start-here` sections, made to actually scroll via a small `ScrollToHash` effect in `App.tsx` (react-router doesn't do this itself). Deliberately **left "Docs" out** — no docs pages exist or are planned yet, and the spec's other nav items were about real destinations, not filling out the list for its own sake. Sign-in is the existing `WalletConnect` — there's no separate dashboard/account nav item since no dashboard route exists yet (that's Phase 3). Verified via `tsc -b` + `oxlint` + `vite build`, all clean.
- [x] App shell — `frontend/src/components/layout/AppShell.tsx`, wraps `/tokens`, `/nft`, `/contracts` (routed via a layout route in `App.tsx`; the homepage and coming-soon placeholders stay under the separate `MarketingLayout` + top `Nav`). Collapsible sidebar (state persisted in `localStorage`) lists the same live-vs-soon product set as the marketing nav's dropdown, now deduplicated into one shared `lib/products.ts`. Top bar has a real `WalletConnect`-based user menu (dropdown: full address, copy-address, disconnect — was a bare badge+button before) and a network selector, shown only on `/tokens` and `/contracts` since those are the only flows that read an EVM network (`/nft` has none). The network selector is now backed by a shared `features/network/NetworkContext.tsx` instead of per-page state — previously picking a network on Token Launchpad didn't carry over to the Contracts Hub since `DeployPanel` kept its own local `useState`; both pages now read/write the same context. **Project switcher deliberately not built** — there's no `Project` model or persisted-draft backend yet (Phase 3, still not started), and this repo's rule is no invented data standing in for a feature that isn't real server-side. Verified `tsc -b`/`oxlint`/`vite build` clean.
- [x] Shared UI component library — `frontend/src/components/ui/` (Button incl. `buttonClassName` for non-`<button>` CTAs like `Link`, Card, Badge, EmptyState, Dropzone, Stepper, PageHero, icons — added Coin/Code/Shield/Wallet/ArrowRight for the homepage), used by every feature. Still small — grows as Phase 3 needs more primitives (sidebar, dialog, toast).

## Phase 3 — Core project system
- [x] `Project` model (type/network/status/draft) — `backend/app/models/project.py`, `backend/app/services/projects.py`, `backend/app/blueprints/projects/` (`/api/projects` CRUD, JWT-owned). Fields: `project_type` (token/nft_collection/contract), `chain`/`network`, `status` (draft/active/archived), `draft_data` JSON for in-progress form state, plus nullable FKs to `ContractDeployment`/`NFTCollection`. A project doesn't duplicate what those records already store — it's a resumable pointer that gets linked once a real deployment/collection exists. Linking is best-effort from `contracts`/`nft` routes (`project_id` in the create payload): a stale/foreign project_id never blocks recording a deployment that already landed on-chain or a collection that already got created.
- [x] Multi-step project wizard with save/resume — `frontend/src/features/projects/NewProjectWizard.tsx` (`/projects/new`). Step 1 picks a type (Token/NFT Collection/Custom Contract), step 2 names it (+ network picker for chain-aware types), then creates the `Project` draft immediately and hands off into the real existing page (`/tokens`, `/nft`, `/contracts`) via `?project=<id>` — the wizard doesn't reimplement compile/deploy/generate UI. Save/resume itself lives in those pages: `DeployPanel.tsx` restores `template_id`/`parameters`/`network` from `draft_data` on load and autosaves on change (debounced); `NFTGeneratorPage.tsx` restores the linked collection if one exists, or pre-fills the create-collection form with the draft's name if not.
- [x] Dashboard with real persisted projects/drafts/deployments — `frontend/src/features/projects/ProjectsDashboard.tsx` (`/dashboard`, added to the app shell sidebar). Lists real `GET /api/projects` data — type, status badge (Draft/Active/Archived), network, and the linked contract address or collection name when active — with Resume/View (routes to the real feature page), Archive/Unarchive, and Delete actions. No invented stats or fake activity feed.
- [x] Auth is real: wallet-signature nonce + JWT, `backend/app/services/auth.py`. Per-user ownership enforced on NFT collection routes (`get_owned_collection` etc.) and now on `Project` routes (`get_owned_project`); contracts/deployments — ownership scoping not reverified this pass.

**Known gap from this pass**: no Alembic migration was generated for the new `projects` table — `backend/migrations/` has been empty (no `env.py`/`versions/`) since Phase 1, because this sandbox has no pip/venv to run `flask db init`/`migrate`. Same limitation as every prior phase's models; run `flask db migrate` in a real environment before deploying. Not execution-verified against a live Postgres for the same reason — only `py_compile`-clean.

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
