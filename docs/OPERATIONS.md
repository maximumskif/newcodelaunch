# Operations runbook

How to run NewCodeLaunch in production, independent of which host it ends up on. Everything below is taken from the code as of 2026-09-24 (file references given so it can be re-checked); where something hasn't been run for real, it says so. For setup and local development see [`README.md`](../README.md); for what each feature actually does, [`docs/FEATURE_REGISTRY.md`](FEATURE_REGISTRY.md); for history, [`docs/REBUILD_PROGRESS.md`](REBUILD_PROGRESS.md).

## What runs

| Service | What it is | Stateful? |
|---|---|---|
| **backend** | Flask JSON API under gunicorn (`backend/wsgi.py`, `backend/Dockerfile`) | Writes uploaded/generated NFT images to local disk (`UPLOAD_FOLDER`, see [Caveats](#operational-caveats)) |
| **candy-machine** | Node/Express sidecar building Solana transactions (`services/candy-machine`) | No — never holds keys, builds transactions for the user's wallet to sign |
| **frontend** | Static Vite bundle served by nginx (`frontend/Dockerfile`, `frontend/nginx.conf`) | No |
| **postgres** | The only source of truth | Yes |
| **redis** | Rate-limit counters, only needed with more than one backend worker | Counters only, safe to lose |
| **scheduler** | Runs the maintenance commands on a timer (`backend/scripts/maintenance-loop.sh`) | No |

The sidecar should only be reachable from the backend. Its `/internal` routes require the shared secret, but nothing else needs to reach it — don't publish its port publicly (`docker-compose.yml` maps `4000:4000` for local convenience only).

## Environment variables

"Required" means the service misbehaves in production without it, not only that it refuses to start — the ones that stop startup are marked. A **blank value is treated as unset** for every URL-type variable (RPCs, Pinata URLs, frontend overrides), so a blank line copied from an `.env.example` means "use the default".

### Backend (`backend/app/config.py`, plus the two files named below)

Required:

| Variable | Why |
|---|---|
| `SECRET_KEY`, `JWT_SECRET_KEY` | **Startup fails without them** (`_require`). Use two different long random values. |
| `DATABASE_URL` | Defaults to `postgresql://launchpad:launchpad@localhost:5432/launchpad`, a dev value. |
| `FLASK_ENV=production` | `DEBUG` is `FLASK_ENV == "development"`, and `backend/.env.example` ships `development`. |
| `CORS_ORIGINS` | Comma-separated list of the frontend's real origin(s). Defaults to `http://localhost:5173`, so a real frontend's browser calls fail CORS without it. |
| `CANDY_MACHINE_SERVICE_URL`, `CANDY_MACHINE_SHARED_SECRET` | Every Solana feature (Candy Machine drops, SPL token launches) goes through the sidecar. An empty secret fails those calls before they're sent (`candy_machine._sidecar_headers`). Must match the sidecar's own secret. |
| `PINATA_JWT` (or legacy `PINATA_API_KEY` + `PINATA_SECRET_KEY`) | IPFS publishing (NFT metadata, collection folders, SPL token logos). Without it those actions return a "not configured" error. |
| `RATE_LIMIT_STORAGE_URI` | Required as soon as there's more than one gunicorn worker or instance — see [Rate limiting](#rate-limiting-with-more-than-one-worker). |
| `TRUSTED_PROXY_COUNT` | Required as soon as anything (load balancer, CDN) sits in front — see the same section. |

Optional (default in brackets):

| Variable | Notes |
|---|---|
| `SEPOLIA_RPC_URL`, `ETHEREUM_RPC_URL`, `POLYGON_AMOY_RPC_URL`, `POLYGON_RPC_URL`, `BSC_TESTNET_RPC_URL`, `BSC_RPC_URL`, `SOLANA_DEVNET_RPC_URL`, `SOLANA_RPC_URL` | [public endpoints] Optional to start, but see [RPC providers](#rpc-providers). |
| `JWT_ACCESS_TOKEN_EXPIRES_SECONDS` | [3600] |
| `WALLET_NONCE_TTL_SECONDS` | [300] Also what `prune-nonces` uses as its cutoff. |
| `NFT_GENERATION_JOB_STALE_SECONDS` | [600] How long a generation job can go without progress before the reaper fails it. |
| `LOG_LEVEL` | [INFO] |
| `ETHERSCAN_API_KEY` | ["" → "Verify source" returns 503, nothing else affected] One key covers every EVM network via Etherscan's V2 API. |
| `COINGECKO_API_KEY` | ["" → CoinGecko's public rate limit] |
| `OPENAI_API_KEY` | ["" → trait analysis runs without the AI-vision section] |
| `UPLOAD_FOLDER` | [`<cwd>/instance/uploads`, i.e. `/app/instance/uploads` in the image] |
| `MAX_CONTENT_LENGTH` | [16 MiB] Max request body. |
| `PINATA_BASE_URL`, `PINATA_GATEWAY_URL` (`app/services/ipfs.py`) | [Pinata's API / public gateway] Set the gateway to a dedicated Pinata gateway if you have one. |
| `OPENAI_BASE_URL` (`app/services/ai_traits.py`) | ["" → the SDK's default] Exists for the e2e stub. |
| `ETHERSCAN_API_URL` | [Etherscan V2] Exists for the e2e stub. |
| `DEX_OVERRIDES` | [unset — the built-in, verified Uniswap/PancakeSwap V2 addresses] JSON replacing a network's DEX for adding liquidity, e.g. `{"sepolia": {"name": "…", "router": "0x…", "factory": "0x…", "wrapped_native": "0x…"}}`. For local chains (the e2e suite); leave unset in production. |
| `MAINTENANCE_INTERVAL_SECONDS` | [300] Read only by the scheduler script, not the app. |
| `MORALIS_API_KEY`, `SOLSCAN_API_KEY` | Read into config but not used by any code yet. |

Never set in production: `RATE_LIMIT_ENABLED=false` (exists only for the e2e harness, see `config.py`) and `TEST_DATABASE_URL` (tests only).

### Candy Machine sidecar (`services/candy-machine/src`)

| Variable | |
|---|---|
| `CANDY_MACHINE_SHARED_SECRET` | **Required.** Without it every `/internal` route returns 500 (`middleware/auth.ts`). Same value as the backend's. |
| `PORT` | [4000] |
| `SOLANA_DEVNET_RPC_URL`, `SOLANA_MAINNET_RPC_URL` | [public endpoints] Note the mainnet name differs from the backend's `SOLANA_RPC_URL`. |
| `CORS_ORIGINS` | [none] Only matters for browser callers, and nothing in a browser should call this service. Leave empty. |

### Frontend (build time only — `frontend/src/lib/http.ts`, `frontend/src/lib/rpcUrls.ts`)

Vite inlines these into the static bundle when it's built; changing one means rebuilding the image. Pass them as `--build-arg`s (`frontend/Dockerfile`), or through Compose interpolation (a shell variable or a `.env` file next to `docker-compose.yml`). Everything in the bundle is public, RPC API keys included — see [RPC providers](#rpc-providers).

| Variable | |
|---|---|
| `VITE_API_BASE_URL` | **Required** for any deployment not on localhost (default `http://localhost:5000/api`). The backend's public URL plus `/api`. |
| `VITE_SOLANA_RPC_URL`, `VITE_SOLANA_DEVNET_RPC_URL` | [public Solana endpoints] |
| `VITE_SEPOLIA_RPC_URL`, `VITE_ETHEREUM_RPC_URL`, `VITE_POLYGON_AMOY_RPC_URL`, `VITE_POLYGON_RPC_URL`, `VITE_BSC_TESTNET_RPC_URL`, `VITE_BSC_RPC_URL` | [viem's public default for that chain] |

## Deploying and migrations

Schema changes are Alembic migrations (`backend/migrations/`, via Flask-Migrate). Apply them with:

```bash
cd backend && flask db upgrade
```

`docker-compose.yml`'s backend service runs this before starting gunicorn. That's fine for a single instance. With more than one backend instance, run `flask db upgrade` once as a separate release step before rolling out new instances, rather than having every instance race to run it at boot. The backend image itself doesn't run migrations (see `backend/Dockerfile`).

Migrations have been applied against real Postgres (the 2026-09-15 Docker verification in `docs/REBUILD_PROGRESS.md`) and run in CI against SQLite. Back up the database before upgrading production. There is no tested downgrade path.

## Health and readiness

| Endpoint | Checks | Use it for |
|---|---|---|
| `GET /api/health` | Nothing. Always `200 {"status":"ok"}` while the process serves requests. | Liveness probes, load-balancer health, restart decisions. CI and the Playwright suite poll it during boot. |
| `GET /api/health/ready` | Runs `SELECT 1` on the database, and calls the sidecar's `GET /health` with a 2-second timeout. | Deploy gating ("is the new version actually able to work?") and monitoring/alerting. |

`/api/health/ready` returns `200 {"status":"ok","checks":{...}}` when both checks pass. Otherwise it returns `503 {"status":"unavailable","failed":["candy_machine"],"checks":{"candy_machine":{"ok":false,"error":"unreachable"},...}}`. Error strings are fixed and generic. The underlying exception goes to the backend log (`Readiness check failed: ...`), never into the response.

Don't use `/ready` as the load balancer's routing check. If the sidecar goes down, only Solana features break, and pulling every backend out of rotation for that would take down the EVM features too. Redis isn't checked either.

The sidecar exposes its own `GET /health` (unauthenticated, no dependencies). The Compose file uses it as the sidecar's healthcheck.

## Scheduled jobs

Two maintenance commands need to run regularly. Nothing in the request path does their work:

- `flask reap-stale-generation-jobs`: marks NFT generation jobs as failed when they've made no progress for `NFT_GENERATION_JOB_STALE_SECONDS`. Generation runs in a thread inside a gunicorn worker, so if that worker dies mid-run, the job stays "running" forever and blocks its collection from being regenerated. This command clears that.
- `flask prune-nonces`: deletes spent or expired sign-in nonces. Without it the `wallet_nonces` table grows forever.

Both are idempotent, so running them twice at once is harmless. `backend/scripts/maintenance-loop.sh` runs both every `MAINTENANCE_INTERVAL_SECONDS` (default 300). It logs one timestamped line per command to stdout, and a failed command is logged and retried on the next round rather than stopping the loop. The script header explains why it's a loop and not cron.

- **With Docker Compose:** the `scheduler` service runs the loop from the backend image and waits for the backend's healthcheck, which means migrations have run. Check it with `docker compose logs scheduler`. **This has not been run under Docker yet.** The script itself has been run directly (see the 2026-09-24 entry in `REBUILD_PROGRESS.md`).
- **On a host with its own scheduler** (a platform cron, a Kubernetes CronJob, etc.): run `sh scripts/maintenance-loop.sh --once` from the backend image's working directory (`/app`), with the backend's environment. It exits non-zero if either command failed, so the scheduler can alert on it. Every 5 to 10 minutes is enough.

## Rate limiting with more than one worker

Sign-in (`/api/auth/nonce`, `/api/auth/verify`) and the public mint routes are rate limited by Flask-Limiter. By default the counters are in memory, one set per worker process. That means with N gunicorn workers or instances, the real limit is N times the configured one. Set `RATE_LIMIT_STORAGE_URI=redis://<host>:6379` before running more than one worker. The Compose file already points the backend at its `redis` service. CI runs this against a real Redis (`backend/tests/test_ratelimit_storage.py`).

Flask-Limiter doesn't swallow storage errors by default (`RATELIMIT_SWALLOW_ERRORS` is unset). So if Redis is unreachable, expect the rate-limited routes to fail instead of letting requests through unlimited. This hasn't been tested against a stopped Redis. Monitor Redis alongside the backend.

Behind a load balancer or CDN, set `TRUSTED_PROXY_COUNT` to the number of proxy hops. Otherwise every request appears to come from the proxy's address and all users share one rate-limit bucket. Don't set it higher than the real hop count, or clients can spoof `X-Forwarded-For`. See the comment in `config.py`.

## RPC providers

The defaults are public RPC endpoints. They're fine for development, but they rate-limit hard and have no uptime guarantee. Before real traffic, point every network you use at a paid provider (for example Alchemy, Infura or QuickNode for EVM, and Helius, QuickNode or Triton for Solana). Three separate services make RPC calls, each with its own variables:

| Caller | Does what | Variables |
|---|---|---|
| Backend | Network status, reading deployment transactions and receipts back to verify them, gas estimation, SPL/Candy Machine chain checks | `*_RPC_URL` (backend table above) |
| Sidecar | Building Solana transactions, reading Candy Machine and guard state | `SOLANA_DEVNET_RPC_URL`, `SOLANA_MAINNET_RPC_URL` |
| Browser | The connected wallet's reads, and sending plus confirming transactions | `VITE_*_RPC_URL` |

- **Browser URLs are public.** Any key in a `VITE_*_RPC_URL` can be read by anyone who loads the page. Use a separate key restricted to your domain (origin allowlist) in the provider's dashboard. Keep an unrestricted key for the server-side variables only.
- Solana confirmations use the `confirmed` commitment everywhere (see `REBUILD_PROGRESS.md` for why). Any mainstream provider supports this.
- Mainnet deployment needs an explicit confirmation in the UI, but it's enabled. Set the mainnet RPCs to real providers before launch, not after.

## What to monitor

- **`/api/health/ready`**: alert on non-200 that lasts more than a minute or two. The `failed` field says whether the database or the sidecar is the problem.
- **Backend logs** (one JSON line per request on stdout, with `status`, `duration_ms` and a `request_id` that's echoed as `X-Request-Id`, see `backend/app/logging_config.py`):
  - the rate of `status >= 500`
  - p95 `duration_ms`
  - `429` rates on sign-in, which point to abuse or to a missing `TRUSTED_PROXY_COUNT`
  - `Candy Machine service error on a public route`
  - `Readiness check failed`

  No error-tracking service is wired in. Ship stdout to whatever the host provides.
- **Scheduler logs**: `maintenance: flask ... FAILED` lines, or no lines at all for more than a couple of intervals (the loop has stopped).
- **Database**: disk and connection count. Also watch NFT generation jobs in the `failed` state. A burst of reaped jobs, whose error says "No progress for over …s", means workers are dying mid-generation.
- **RPC providers**: request volume and 429 or error rates on each provider's dashboard, for all three callers.
- **Pinata**: storage and bandwidth quota. Publishing fails once the quota is exhausted.
- **Redis** (if used): availability, see [Rate limiting](#rate-limiting-with-more-than-one-worker).

## Operational caveats

These are known properties of the current code, not fixed by this runbook:

- **NFT images live on the backend's local disk** (`UPLOAD_FOLDER`), including uploaded trait layers, generated items before publishing, and the files served back to the UI. `docker-compose.yml` doesn't mount a volume there, so recreating the backend container loses them. More than one backend instance would need a shared filesystem at that path. For production, give it a persistent volume (and back it up) until this moves to object storage. Anything already published to IPFS is unaffected.
- **gunicorn's default worker timeout is 30 seconds** (sync workers, 1 worker; the Compose command sets neither). Some outbound calls are allowed longer than that: a Pinata directory upload has a 120-second timeout, and single pins have 30 to 60 seconds (`app/services/ipfs.py`). A request that takes longer than 30 seconds gets its worker killed. That also kills any NFT generation thread running in that worker, which the reaper then marks failed. Consider `--timeout 150` and more `--workers` (with Redis, see above) in the start command. This hasn't been load-tested.
- **The first Solidity compile after a fresh container** downloads a `solc` binary (py-solc-x, see `app/services/solidity.py`), so the first compile is slow and needs outbound internet access.
- **Solana on-chain limits** are enforced in code: at most 20 items per Candy Machine drop, and 2000 allowlist addresses per drop. See `README.md` / `FEATURE_REGISTRY.md` for what's capped.
