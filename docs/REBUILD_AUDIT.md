> Written 2026-08-14 against `nocodelaunchyeet` before it was split into this repo (`newcodelaunch`). Kept verbatim as the historical record of what the legacy monolith actually contained and why it was left behind — none of the legacy code described in sections 1, 4, 5, 6, or 7 was carried into this repo. Sections 2, 8, 9, and 10 describe the `backend/`/`frontend/`/`services/candy-machine/` code that *was* carried over and is this repo's actual starting point.

# Rebuild Audit

Date: 2026-08-14. Scope: read-only inspection of the entire repository as it exists on `main` today. Nothing in this document was taken from README/status-doc claims without independently checking the implementation.

## 1. Current architecture

This repository currently contains **two complete, unrelated applications side by side**, and `git log` shows why: the repo's history literally starts as the old public "NoCode Blockchain Launchpad" monolith (`fe9af6e` through `4b0dc2f`), and the "Rebuild Phase 1/2/3" commits (`7057889` onward) were layered on top without ever removing the original code.

**A. Legacy monolith (repo root)** — one Flask app, `app.py` (213 KB, 192 `@app.route` handlers), backed by:
- `config.py` — a dataclass-ish config loader, already patched in the Phase-1 commit to stop defaulting secrets (see §7).
- ~48 other root-level `.py` modules, no package structure, no blueprints — everything imports directly into `app.py`.
- `templates/` — 33 Jinja templates, `index.html` alone is 235 KB, `base.html` is 44 KB.
- `static/` — plain CSS/JS, several overlapping "color system" files (`complete_color_system.css`, `enhanced_colors.css`, plus three `.py` scripts whose whole job is generating/patching CSS: `advanced_color_system.py`, `color_conflict_resolver.py`, `color_system_fix.py`).
- 5 separate startup scripts (`run.py`, `run_optimized_server.py`, `start_optimized.py`, `start_server.py`, `quick_start.py`) and a `demo.py`.
- 4 "test" scripts at root that are not pytest/unittest — see §2/§5.
- A `requirements.txt` that still lists `fastapi`/`uvicorn` even though nothing here is FastAPI, and `Flask==2.3.3`.
- A pile of self-authored status docs (`PROJECT_COMPLETE_SUMMARY.md`, `IMPLEMENTATION_STATUS.md`, `CURRENT_STATUS_CHECKPOINT.md`, etc.) asserting completion — see §7 for how those claims hold up.

**B. New rebuild (`backend/`, `frontend/`, `services/candy-machine/`)** — an application-factory Flask JSON API (blueprints: `auth`, `blockchain`, `contracts`, `nft`; service layer; SQLAlchemy models; Postgres via `Flask-Migrate`) with zero Jinja, paired with a Vite + React + TypeScript SPA (`wagmi`/`viem` for EVM, `@solana/wallet-adapter` for Solana), plus a small Node/Express sidecar for Metaplex Umi (Candy Machine, scaffold only). `backend/app/__init__.py` uses a proper `create_app()` factory; `wsgi.py` is the one production entry point. No dead code duplication *inside* this half — it's the cleanest part of the repo.

Both halves are tracked in the same `main` branch today, both have their own `requirements.txt`/dependency file, and the root `.github/workflows/ci.yml` only exercises half of **neither** — see §6.

## 2. Verified working features (new rebuild only)

Legacy features are not listed here even when their code looks plausible — "looks plausible" is not "verified." Everything below was confirmed by reading the actual implementation, not the commit message describing it.

| Feature | Evidence it's real |
|---|---|
| Wallet-signature auth | `backend/app/services/auth.py` + `blueprints/auth/routes.py`: server issues a nonce, stores it with a TTL, verifies an EIP-191/ed25519 signature against it, then mints a JWT. No password ever touches the server. |
| Solidity compile | `backend/app/services/solidity.py` calls real `py-solc-x`; `contracts.py` compiles the actual template source, not a canned ABI. |
| Client-side signed deploy | Backend only compiles + estimates gas; `frontend/src/features/contracts/DeployPanel.tsx` + `useDeployTemplate.ts` build the transaction and the *user's connected wallet* signs and broadcasts it. The server never sees a private key. |
| NFT layer compositing | `backend/app/services/nft_compositing.py` does real `PIL.Image.alpha_composite` layer stacking onto a canvas — produces an actual PNG, not a placeholder URL. |
| Rarity-weighted generation | `nft_generation.py` uses `random.choices(..., weights=[trait.rarity_weight ...])` with a used-combinations set to avoid duplicates, capped at 200/call. |
| IPFS publish | `ipfs.py` makes real `requests.post` calls to Pinata's `pinFileToIPFS`/`pinJSONToIPFS`, returns the actual `IpfsHash`. |
| AI trait analysis (CV) | `ai_traits.py`'s color/composition/technical analysis runs real `PIL`/`numpy`/`colorsys` math over the uploaded image — not a random-number generator (contrast with the legacy `ai_security_auditor.py`, §4). |
| AI trait analysis (vision) | Same file's `_analyze_with_ai_vision` makes a real `openai` v1.x `chat.completions.create` vision call, gated on `OPENAI_API_KEY` being set — omits the section rather than fabricating a response when the key is absent. |

**Real gap: zero automated test coverage on the new rebuild.** `backend/tests/` exists as an empty directory. `frontend/package.json` has no test runner configured at all (no vitest/jest). Everything above was verified by manual code reading this session, not by a test suite — which is exactly the kind of unverifiable claim the rebuild spec is trying to eliminate. This needs to be fixed before any "verified working" claim in this doc can be trusted long-term.

## 3. Partially working features

- **Candy Machine service** (`services/candy-machine/`): scaffold only. Per prior session notes it has "just the internal-auth contract so far" — no real Metaplex Umi minting calls yet. Not independently re-verified this pass; flagged for the audit's benefit, not confirmed broken.
- **`wallet_integration.py` (legacy)**: actually wired into `app.py` (5 references, not orphaned) and has a real nonce/signature-verification shape (`verify_wallet_signature`, `pending_signatures` with nonces). Whether the connect route actually enforces this end-to-end, or has a bypass, was not traced through every call site given the time budget — call this **unverified**, not confirmed either way.
- **DeFi Scanner / Market Intelligence (new rebuild)**: routes exist in `App.tsx`'s nav (`ComingSoon` placeholder) — honestly labeled as not-yet-built, which is correct behavior per the spec ("disabled with a clear coming-soon"), just noting it's not a broken promise.

## 4. Mock or simulated features (legacy code, with receipts)

- **AI Security Auditor is entirely fabricated.** `app.py:5564-5673` (the security-audit endpoints) generate vulnerability counts and a "security score" with `random.randint(...)` — e.g. `base_score = random.randint(60, 95)`, `'critical': random.randint(0, 2)`, `'line': random.randint(40, 80)` (a fake line number for a fake vulnerability). This is presented to the user as an AI-powered contract audit. It is not one.
- **ChatGPT integration is a canned string, unconditionally.** `app.py:517`, `/api/chat-gpt`: `response = {'success': True, 'response': f"This is a simulated response to: {message}. The actual ChatGPT integration would provide AI-powered assistance..."}` — this ships to every caller regardless of whether an OpenAI key is configured. Contrast with the new rebuild's `ai_traits.py`, which does the equivalent thing correctly (real call when configured, honest omission when not).
- **IPFS upload is explicitly commented `# simulated`.** `app.py:490`, inside the NFT metadata-upload route.
- **Collection insights are canned.** `app.py:1184`, `/api/ai/collection-insights/<batch_id>`: `# For now, return simulated insights` followed by hardcoded numbers (`'collection_size': 100`, `'total_unique_traits': 45`, ...) regardless of the batch ID passed in.
- **Live global metrics fabricate motion.** `live_global_metrics.py:286`: `fluctuation = random.uniform(-0.05, 0.15)` — the "live" dashboard numbers are a random walk, not real data.
- **Self-reported platform health is fabricated by the same standard the spec objects to.** `IMPLEMENTATION_STATUS.md`: *"Overall Platform Health: 95/100 (Excellent - Production Ready)"*, and claims a completed *"WebSocket Real-time Engine - Complete with live metrics, price updates, activity feeds"* — but `websocket_manager.py` has **zero** references anywhere in `app.py` (`grep -c "websocket_manager|socketio" app.py` → 0). The feature the status doc calls complete is not wired into the running application at all.

## 5. Broken features

- **`GET` route rendering `enterprise_landing.html` is broken.** `app.py:4817`: `return render_template('enterprise_landing.html', industry=industry)` — that template file does not exist in `templates/` (verified: cross-referencing all 31 `render_template()` calls against the 33 files on disk, `enterprise_landing.html` is the one call target with no matching file). Hitting this route throws `TemplateNotFound`.
- **`launch_token_fixed.html`** exists on disk but is never referenced by any `render_template()` call — an abandoned "fixed" variant that never got wired in, while whatever it was meant to fix presumably still ships from the original `launch_token.html`.
- **`analytics.html`** likewise exists but is never rendered — superseded by `analytics_dashboard.html`, which *is* wired in, but the old file was never deleted.
- **CI never actually tests anything.** See §6 — the `test` job in `.github/workflows/ci.yml` runs `python test_all_functionality.py` and `python test_functionality.py` directly (not via pytest, despite the step being named "Test with pytest"), and both scripts require a live server at `http://localhost:5000` that the workflow never starts. Every request in both scripts will hit a connection error. Whether the job has ever gone green is unclear without checking Actions history, but the mechanics guarantee it can't be meaningfully testing behavior even when it does.

## 6. Duplicate and obsolete code

- **Five legacy server entry points** doing overlapping jobs: `run.py`, `run_optimized_server.py`, `start_optimized.py`, `start_server.py`, `quick_start.py`, plus `demo.py`. None of these matter once the legacy app is retired — the new rebuild already has exactly one dev path (`flask run` against `backend/app`) and one prod entry point (`backend/wsgi.py`), which is what the spec asks for.
- **Two config systems**: root `config.py` vs `backend/app/config.py`. The new one is the one to keep (env-var-only, no fallback secrets, fails loud on missing `SECRET_KEY`).
- **Two IPFS integrations**: `ipfs_integration.py` (legacy, targets Infura's IPFS pinning — which no longer accepts new signups, per the new rebuild's own commit notes) vs `backend/app/services/ipfs.py` (Pinata, real, already in use).
- **Two contract-deploy paths** with materially different security models: legacy `smart_contract_deployer.py` + `blockchain_manager.py` accept a raw `private_key` string from the request body and sign server-side (`w3.eth.account.from_key(private_key)`, `w3.eth.account.sign_transaction(...)`) — see §7. The new `backend/app/services/contracts.py` only compiles/estimates; the connected wallet signs client-side. These are not just duplicates, one of them is a real security liability that must not be revived.
- **Two NFT trait/generation implementations**: legacy `app.py`'s NFT routes pick traits round-robin (`i % len(traits)`, ignoring the `rarity` field entirely — confirmed in a prior session's read) and never composite a real image (`f"ipfs://generated_image_{i+1}"` fabricated URLs). The new `nft_generation.py`/`nft_compositing.py` do real rarity-weighted selection and real PIL compositing.
- **Three "color system" utility scripts + two CSS files** (`advanced_color_system.py`, `color_conflict_resolver.py`, `color_system_fix.py`, `complete_color_system.css`, `enhanced_colors.css`) — all superseded by Tailwind v4 + design tokens in `frontend/`, once that design-token pass happens (see §8/§10 — not done yet, tracked as its own gap).
- **~15 "phase 4 / strategic power hooks / enterprise expansion" modules** (`phase4_completion.py`, `phase4_summary.py`, `phase4_verification.py`, `strategic_integrations.py`, `enterprise_expansion.py`, `alpha_cards.py`, `auto_social.py`, `gamification.py`, `roi_calculator.py`, `liquidity_automation.py`, `bridge_engine.py`, `oauth_sso_integration.py`, `performance_flex.py`) are internal milestone-tracking scripts and speculative features, not user-facing product surface worth preserving. Per standing project decisions these are explicitly out of scope for the rebuild.

## 7. Security concerns

**Q: are the previously-reported leaked API keys still hardcoded anywhere live?**
**A: No, not anymore — but they *were*, and it's worth recording exactly what leaked.** `git diff original/main -- config.py` shows the exact remediation: the Phase-1 rebuild commit (`7057889`) edited the **legacy root `config.py` directly** (not just a `backend/` copy) to remove:
- `coingecko_api_key=os.getenv('COINGECKO_API_KEY', 'CG-A3Z5iYAYHRkBAofzWQzxCzcr')` → now defaults to `''`
- `etherscan_api_key=os.getenv('ETHERSCAN_API_KEY', 'VH2EIAJF3S75VRB4466EXJZ2CWZBT8EE95')` → now defaults to `''`
- `secret_key=os.getenv('SECRET_KEY', 'dev-key-change-in-production-2024-secure')` → now required, no fallback

Those two API keys were real, committed, hardcoded fallback values and were live in every clone of this repo (and still are, in the separate public `original` remote / the old `maximumskif/nocodelaunchyeet` repo, which was never patched). The user previously chose to let them die rather than rotate, since nothing in the new backend uses them yet — that's a reasonable call given they're low-value data-API keys, not custodial/financial keys, but it should be revisited before Phase 4 (DeFi/Market Intelligence) starts using CoinGecko/Etherscan again with a *new* key.

**Far more serious, and NOT remediated: the legacy deploy flow still accepts and server-side-signs raw private keys.**
- `app.py:2817`: `private_key = data['private_key']` — taken directly from the JSON request body.
- `app.py:2590`: `private_key = data.get('private_key', 'demo_key')  # For demo purposes` — a second route with the same pattern.
- `smart_contract_deployer.py:157`: `account = w3.eth.account.from_key(private_key)`
- `smart_contract_deployer.py:201`: `signed_txn = w3.eth.account.sign_transaction(transaction, private_key)`
- `blockchain_manager.py:378-511`: the same pattern threaded through `deploy_contract`/`_deploy_evm_contract`/`_deploy_solana_program`.

This is a direct, textbook violation of "never request, receive, log, or store seed phrases; never store raw private keys" — the exact thing the rebuild spec calls out. It is not a leftover from years ago that's already fixed; it is live in `app.py`'s current routes today. The new rebuild's client-signed flow is the correct fix and already exists — the fix here is "never run the legacy deploy routes," not "patch them."

- `env.example` (legacy) still documents `PRIVATE_KEY=your-private-key-for-deployment` as a server-side env var, reinforcing the same bad pattern at the config level.
- No secrets found hardcoded in `app.py` itself beyond the two now-fixed `config.py` defaults.
- Root `requirements.txt` carries `fastapi`/`uvicorn` as dead weight (nothing here is FastAPI) — not a security issue, just confirms the dependency file was never cleaned up.

## 8. Recommended target architecture

**Keep the `backend/` + `frontend/` split, retire the legacy root app.** This isn't a default-to-keeping-what-exists recommendation — checking it against the spec's own architecture checklist, the new half already satisfies nearly all of it: application factory ✓ (`create_app()`), blueprints ✓, service layer for external APIs/blockchain ✓, database migrations ✓ (`Flask-Migrate`), one dev entry point / one prod entry point ✓ (`wsgi.py`), centralized config with no secret fallbacks ✓, `.env.example` present ✓. What it's missing is coverage, not structure: no tests, no marketing homepage, no authenticated app shell, no project/draft persistence model — all real gaps, none of them architecture problems.

**On "don't migrate to React merely because it's newer"** — this instruction predates knowing that migration already happened and is substantially built (~20 working `.tsx` files across auth/contracts/tokens/nft, real wagmi + Solana wallet-adapter integration, verified via `tsc -b` + build this session). Re-litigating framework choice at this point would mean throwing away working, verified code to rebuild the *exact thing being escaped* — a large server-rendered Jinja app (`templates/index.html` alone is 235 KB) — for no stated benefit; the spec's own complaint about the legacy app is precisely "large Jinja templates," "overlapping design systems," "thousands of lines of CSS/JS in templates." A modernized Flask+Jinja frontend was never attempted or compared against React here, so I can't claim a rigorous side-by-side — but the concrete cost of reverting now (discard ~3 rebuild phases of verified work, rebuild the same features again in a different template layer, still end up needing structured client-side state for a multi-step wizard, wallet connection, and live gas estimates — all things React's ecosystem already solves and Jinja would hand-roll) is high and the stated benefit is zero. **Recommendation: keep React, but this is flagged for you to explicitly confirm rather than assumed**, since the spec text asked for that confirmation by name.

**Legacy code disposal — recommend moving it under `legacy/` in one commit, not deleting outright.** Git history preserves either way, so the safety argument for "keep it forever in history" is moot — but a working tree that still has `app.py` sitting at the root next to `backend/` is actively confusing (as this very audit had to untangle) and risks someone running the wrong entry point or a future AI-assisted session "fixing" dead legacy code instead of the real app. Moving everything legacy into `legacy/` (one clean commit, nothing deleted) keeps it trivially inspectable for reference during the rebuild without it competing for attention. Once the rebuild reaches feature parity, a follow-up decision to delete `legacy/` outright is reasonable — that's a separate, later call.

**Testnet-default gap.** `backend/app/config.py` currently defaults `ETHEREUM_RPC_URL`/`POLYGON_RPC_URL`/`BSC_RPC_URL`/`SOLANA_RPC_URL` to **mainnet** public endpoints (`eth.llamarpc.com`, `polygon-rpc.com`, `bsc-dataseed.binance.org`, `api.mainnet-beta.solana.com`), and the frontend's network picker in `DeployPanel.tsx` defaults to `'ethereum'` (mainnet). This directly contradicts the spec's "default to testnet, require explicit confirmation for mainnet." This is a real, actionable gap, not a legacy-only problem — it's in the code being actively built right now.

**Total absence, not yet started, confirmed by inspection (not assumed from memory):**
- No marketing homepage — `App.tsx`'s `Home()` component is two lines of placeholder text.
- No authenticated app shell — no sidebar, no project switcher, no dashboard; each feature is a flat top-level route.
- No `Project`/draft persistence model in the backend — `NFTCollection`/`ContractDeployment` exist per-feature, but there's no unifying "project" concept a user creates once and configures across token/NFT/mint-site.
- No test suite on the new rebuild (`backend/tests/` empty, no frontend test runner).
- No feature registry doc.

## 9. Features to retain / rebuild / postpone / remove

**Retain (already real, keep building on):** wallet-signature JWT auth, Solidity compile + client-signed deploy, Token Launchpad, Smart Contracts Hub, NFT layer/trait system with real compositing + rarity generation, Pinata IPFS publish, AI-assisted rarity suggestion (already correctly scoped as a generator sub-feature, not a standalone page).

**Rebuild from scratch, not ported (legacy version is fake or insecure):** AI Security Auditor (currently 100% `random.randint` — either implement real static analysis, e.g. Slither, or don't ship the feature), ChatGPT/AI assistant (currently a canned string), live/collection "insights" endpoints (currently hardcoded numbers), any contract-deploy path that signs server-side (must stay client-signed only, no exceptions).

**Postpone (legitimate future phases, per the spec's own priority order — core workflows before speculative features):** DeFi Protocol Scanner, Market Intelligence (`defi_scanner.py`/`defi_engine.py`/`market_data.py` → Phase 4), Template Marketplace (`template_marketplace.py` → Phase 5), Mint-site/Candy Machine (Phase 6, scaffold exists).

**Remove (not worth rebuilding — internal tooling, speculative/vanity features, or superseded utilities):** the 5 duplicate server entry points, `demo.py`, the 3 color-system-patch scripts + 2 duplicate CSS files (superseded by Tailwind design tokens once §10's design-system pass happens), `phase4_*` milestone-tracking scripts, `strategic_integrations.py`, `enterprise_expansion.py`, `access_control.py`, `oauth_sso_integration.py`, `gamification.py`, `roi_calculator.py`, `liquidity_automation.py`, `bridge_engine.py`, `auto_social.py`, `alpha_cards.py`, `performance_flex.py`, `live_global_metrics.py`, `websocket_manager.py` (confirmed dead — zero references from `app.py`), `api_usage_analytics.py`, `environment_diagnostic.py`, all self-reported status/completion docs at root (`PROJECT_COMPLETE_SUMMARY.md`, `IMPLEMENTATION_STATUS.md`, `CURRENT_STATUS_CHECKPOINT.md`, `FUNCTIONS_SUMMARY.md`, `PLATFORM_STRUCTURE.md`, `QUICK_RESUME_GUIDE.md`, `START_HERE.md`, `FUNCTIONALITY_AUDIT.md`, `COLOR_OPTIMIZATION.md`, `FINAL_COLOR_TYPOGRAPHY_REPORT.md`, `color_usage_report.md`, `typography_style_guide.md`, `ai_features.md`, `enterprise_features.md`) — none of these describe the new rebuild and all of them assert unverified completion.

## 10. Implementation sequence

Bridging where the rebuild actually is today to the spec's Phase 0-7:

- **Phase 0 (baseline) — this audit.** Done as of this document. Legacy app was not runnable-verified in this sandbox (no pip/venv available here, same limitation noted throughout prior sessions); `py_compile` confirms the legacy Python at least parses. New backend confirmed to `py_compile` cleanly; frontend confirmed via `tsc -b` + `oxlint` (clean) and a full `vite build` (clean, from the prior session in this conversation).
- **Phase 1 (architecture + design system) — partially done, needs closing out.** Architecture is effectively decided (§8) but not yet *written down and ratified* anywhere durable until this doc; design tokens (colors/type/spacing/radii/shadows/motion) don't exist yet — the frontend currently uses ad hoc Tailwind utility classes per component, and the most recent design pass (this session, pre-audit) went in the opposite direction from the spec's visual-direction section (gradient-heavy purple/violet blobs, gradient buttons) and needs to be dialed back to "one strong primary accent, no giant glows" per the spec.
- **Phase 2 (homepage + app shell) — not started.** Needs: real marketing homepage (nav, hero with an actual interactive wizard-preview component, core creation paths, guided-process explainer, security/transparency section, templates section, footer), plus an authenticated app shell (collapsible sidebar, project switcher, network selector, wallet state, user menu) that the existing feature pages get moved into.
- **Phase 3 (core project system) — not started.** Needs a `Project` model (type, network, status, draft vs configured vs deployed) that Token/NFT/mint-site configs attach to, a multi-step wizard component, draft autosave, and a dashboard that lists real projects/drafts/deployments — replacing today's flat "just go to /tokens or /nft directly" navigation.
- **Phase 4/5 (token, NFT) — substantially done, needs wizard/dashboard integration + tests.** The underlying services and compile/deploy/generate/publish flows already work (§2); what's missing is folding them into the Phase-3 project wizard instead of standing alone, plus the testnet-default fix (§8) and a real test suite.
- **Phase 6 (secondary features) — correctly not started yet**, matching the spec's own priority order. When it starts: DeFi Scanner/Market Intel must use real DeFiLlama/CoinGecko calls only (no `random.uniform` fallback like the legacy version), Template Marketplace must use real data (no fictional authors/download counts like the legacy version).
- **Phase 7 (hardening) — not started.** Blocked on Phases 2-5 existing to harden in the first place; §2's "zero test coverage" gap should start being closed incrementally *during* Phases 3-5, not deferred entirely to the end, so each new workflow lands with at least one real assertion-based test rather than accumulating the same debt the legacy app has.
