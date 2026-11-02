# Mainnet release checklist

Work through this before pointing real users and mainnet networks at a deployment. Every item has a check that's either a command or something to look at. An item is done only when its check passes on the server being released, not on a dev machine.

In the commands, `$DOMAIN` is the deployment's domain (for example `export DOMAIN=launch.example.com`) and `$SHA` is the commit being released.

Status as of 2026-11-02: **not ready for mainnet.** Items 1–5, 9 and 14 are done, item 8 is half done, and items 6, 7 and 10–13 are open.

## Code and CI

### 1. CI is green on the release commit — done (`f6a8bed`)
All six jobs in `.github/workflows/ci.yml` pass: backend, frontend, end-to-end (real chain, backend and browser), the Candy Machine sidecar, Docker, and Docker on ARM.

```bash
curl -s "https://api.github.com/repos/maximumskif/newcodelaunch/commits/$SHA/check-runs" \
  | python3 -c "import json,sys; [print(r['conclusion'], r['name']) for r in json.load(sys.stdin)['check_runs']]"
```
Pass: every line starts with `success`. A `None` means the job is still running (GitHub can report the run complete before the e2e job finishes), so wait and rerun.

### 2. Fresh deploys set the fee wallets — done (`9560888`)
`deploy/bootstrap.sh` writes `PLATFORM_FEE_RECIPIENT` and refuses to run without it.

```bash
curl -s "https://$DOMAIN/api/contracts/curve-fee"
```
Pass: `200` with the platform's EVM fee wallet in the body. Check that the address is the wallet you control, character for character.

### 3. Compile and estimate are rate-limited and cached — done (`9560888`)
```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$DOMAIN/api/contracts/estimate" -H 'Content-Type: application/json' -d '{}'; done | sort | uniq -c
```
Pass: some `429`s appear after 30 requests in a minute. The tests for this are in the backend suite (item 1).

### 4. Sign-in is bound to the domain (SIWE / EIP-4361) — done (`e3eba0b`)
Look: connect a wallet on `https://$DOMAIN` and sign in. The wallet's signature prompt must show `$DOMAIN` and the site's URI, not a bare sentence. Pass: MetaMask and Phantom both show the domain, and sign-in succeeds on an EVM network and on Solana.

### 5. Security headers are served — done (`feb2850`)
```bash
curl -sI "https://$DOMAIN/" | grep -i -E 'content-security-policy|x-frame-options'
```
Pass: `Content-Security-Policy` contains `frame-ancestors 'none'`, and `Content-Security-Policy-Report-Only` is present.

## Before mainnet

### 6. Enforce the full CSP
The full policy is report-only today. WalletConnect needs `VITE_WALLETCONNECT_PROJECT_ID` in `deploy/.env` (free from dashboard.reown.com, with the site's domain allowed), otherwise phone browsers can't connect an EVM wallet. Use the live site with MetaMask, Phantom and WalletConnect (from a phone): connect, sign in, launch a token, trade on a curve, mint a drop. Then read the reports:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml logs backend | grep 'CSP violation'
```
Pass: no violations from your own pages (browser-extension noise excepted). Then move the policy from `Content-Security-Policy-Report-Only` into `Content-Security-Policy` in `deploy/Caddyfile`, redeploy, repeat the wallet session, and confirm nothing breaks.

### 7. Rotate the keys that were shared in chat
The Pinata JWT, Etherscan API key and Helius API key have been pasted in chat sessions, so treat them as exposed. Create new ones, put them in `deploy/.env`, and revoke the old ones in each provider's dashboard.

Pass: each provider's dashboard shows the old key revoked. A Pinata upload, an Etherscan verification and a Solana read still work with the new keys (the smoke tests in items 8–9 exercise all three).

### 8. Sepolia smoke passes, fee included (P0-6) — fee run done, full run due
`--only curve` passed 21/21 on 2026-11-01: the 0.7 : 0.3 split reached the platform's wallet and the creator, and the curve kept nothing (`docs/REBUILD_PROGRESS.md`, "Fees on the real networks"). The full run last passed 21/21 on 2026-09-29; the token, vesting and curve templates have changed since, so rerun it. It needs about 0.03 Sepolia ETH, and the smoke wallet had about 0.021 left on 2026-11-01, so top it up first. Start the stack with `frontend/e2e/devnet/run-stack.sh` (with `ETHERSCAN_API_KEY` and `PLATFORM_FEE_RECIPIENT` set), then:

```bash
cd frontend
node e2e/sepolia/smoke.mjs --key-file ~/sepolia-smoke.json --only curve   # bonding curve + fees
node e2e/sepolia/smoke.mjs --key-file ~/sepolia-smoke.json                # everything else
```
Pass: both runs end with every check passing. The curve run must show the 0.7% platform share paid to `PLATFORM_FEE_RECIPIENT`, and the 0.3% creator share claimable.

### 9. Devnet smoke passes, including the NFT mint fee — done (`ab5d346`)
Passed 16/16 on real devnet on 2026-11-01. The storefront shows the 0.01 SOL fee, and the allowlist mint and the public mint each paid the platform's wallet exactly 10,000,000 lamports. Rerun before release:

```bash
cd frontend && node e2e/devnet/smoke.mjs --keypair ~/devnet.json --fee-wallet <PLATFORM_SOLANA_FEE_RECIPIENT>
```
Pass: every check passes, the three fee checks included.

### 10. A staging server runs the production stack
The Oracle instance doesn't have a public IP yet. Deploy with `deploy/bootstrap.sh` and the prod compose file (see `docs/OPERATIONS.md`, "Hosting").

```bash
curl -s "https://$DOMAIN/api/health/ready"
```
Pass: `200 {"status":"ok",...}` over HTTPS with a valid certificate, and items 2–6 pass against this server.

### 11. Backups are automated and a restore has been tested
Today backups are a manual `pg_dump` (OPERATIONS.md, "Hosting"). Schedule a daily dump of Postgres and of the `uploads` volume to storage off the server.

Pass: a dump from the schedule exists off the server, and restoring it into a scratch Postgres gives the same `users`, `projects` and `contract_deployments` row counts as production.

### 12. Monitoring and paid RPC
- Error tracking or log shipping is wired in. No error-tracking service exists today; see OPERATIONS.md, "What to monitor".
- An uptime alert on `/api/health/ready` fires within two minutes of a failure.
- Paid RPC endpoints are set for every mainnet network you enable, for the backend, the sidecar and the frontend build (OPERATIONS.md, "RPC providers").

Pass: stopping the sidecar on staging triggers the alert; a forced 500 shows up in the error tracker or log search; `grep -E '_RPC_URL' deploy/.env` shows no public endpoints for enabled mainnets.

### 13. Terms, Privacy and risk-disclosure pages
None exist (no routes for them in `frontend/src/App.tsx`). Add them and link them from the footer and from the launch and trade flows.

Pass: each page loads at its URL, the footer links work, and the curve launch page links the risk disclosure before the wallet prompt.

### 14. Say that the contracts are unaudited — done
The bonding curve holds buyers' ETH, and no independent audit has been done. Until one is (a business decision), the curve launch and trade panels must say so plainly. Nothing anywhere may imply an audit. `UnauditedNotice` (`frontend/src/features/tokens/UnauditedNotice.tsx`) is shown on the launch page's summary and in a curve's trade panel until it graduates; Vitest checks both.

Pass: the notice is visible on `/tokens/curve` and on an ungraduated curve's token page, and `grep -rn -i audit frontend/src` finds no claim of an audit (the token checker's `audit` search keyword is not one). If an audit is ever done, change the notice to name the auditor and link the report.

## On release day

- [ ] Items 1–14 pass on the server being released (rerun 8 and 9 against it, not just a dev stack).
- [ ] `deploy/.env` is backed up somewhere safe; it holds every secret.
- [ ] A database backup is taken just before deploying (migrations have no tested downgrade, OPERATIONS.md, "Deploying and migrations").
- [ ] After deploying, `/api/health/ready` returns 200 and one real sign-in works on each chain.
