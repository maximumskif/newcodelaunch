import os

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    """Raised when a required environment variable is missing."""


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(
            f"{name} is required but not set. Copy .env.example to .env and fill it in."
        )
    return value


class Config:
    ENV = os.environ.get("FLASK_ENV", "development")
    DEBUG = ENV == "development"

    # Security — no fallback defaults. A missing SECRET_KEY must fail startup,
    # not silently run with a well-known dev value (that's how the old app.py leaked).
    SECRET_KEY = _require("SECRET_KEY")
    # Previously fell back to SECRET_KEY when unset, so a leak of one secret
    # compromised both Flask's own signing and every issued JWT. Required
    # independently now, same as SECRET_KEY — set a different value.
    JWT_SECRET_KEY = _require("JWT_SECRET_KEY")
    JWT_ACCESS_TOKEN_EXPIRES_SECONDS = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRES_SECONDS", "3600"))
    WALLET_NONCE_TTL_SECONDS = int(os.environ.get("WALLET_NONCE_TTL_SECONDS", "300"))

    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql://launchpad:launchpad@localhost:5432/launchpad"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    CORS_ORIGINS = [
        origin.strip()
        for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]

    # In-memory by default — fine for one dev process, silently wrong the
    # moment this runs behind gunicorn with more than one worker (this
    # app's documented production entry point): each worker keeps its own
    # counter, so the real allowed rate becomes (configured limit) x
    # (worker count). Point this at a Redis instance in production instead
    # (e.g. "redis://localhost:6379") — the `redis` package is already a
    # dependency (see requirements.txt) specifically so this works with no
    # further code change, just an env var.
    RATE_LIMIT_STORAGE_URI = os.environ.get("RATE_LIMIT_STORAGE_URI", "memory://")

    # Number of trusted reverse-proxy hops in front of this app (a load
    # balancer, a CDN, etc). 0 by default — meaning ProxyFix does nothing
    # and request.remote_addr (what the rate limiter keys on) is trusted as
    # given, correct only when nothing sits in front of this app. Set this
    # to the actual hop count once one exists, or every request will look
    # like it comes from the proxy's own address, and per-user rate
    # limiting stops working correctly (either every user is treated as
    # one, or the proxy's address gets allow-listed and no one is limited).
    TRUSTED_PROXY_COUNT = int(os.environ.get("TRUSTED_PROXY_COUNT", "0"))

    # Chain RPCs are not secrets — public endpoints are a fine default, same as the old config.
    # Testnets are listed first and are what the frontend network picker
    # defaults to (see NetworkContext.tsx) — mainnet requires the user to
    # deliberately switch networks and confirm before a deploy goes through.
    SEPOLIA_RPC_URL = os.environ.get("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
    ETHEREUM_RPC_URL = os.environ.get("ETHEREUM_RPC_URL", "https://eth.llamarpc.com")
    POLYGON_AMOY_RPC_URL = os.environ.get("POLYGON_AMOY_RPC_URL", "https://rpc-amoy.polygon.technology")
    POLYGON_RPC_URL = os.environ.get("POLYGON_RPC_URL", "https://polygon-rpc.com")
    BSC_TESTNET_RPC_URL = os.environ.get("BSC_TESTNET_RPC_URL", "https://bsc-testnet-rpc.publicnode.com")
    BSC_RPC_URL = os.environ.get("BSC_RPC_URL", "https://bsc-dataseed.binance.org")
    SOLANA_DEVNET_RPC_URL = os.environ.get("SOLANA_DEVNET_RPC_URL", "https://api.devnet.solana.com")
    SOLANA_RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")

    # Market/chain-data API keys (Phase 6: Market Intelligence / DeFi Scanner).
    # COINGECKO_API_KEY is optional — market_intelligence.py works unauthenticated
    # too, just at CoinGecko's lower public rate limit. The others aren't used yet.
    COINGECKO_API_KEY = os.environ.get("COINGECKO_API_KEY", "")
    ETHERSCAN_API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
    MORALIS_API_KEY = os.environ.get("MORALIS_API_KEY", "")
    SOLSCAN_API_KEY = os.environ.get("SOLSCAN_API_KEY", "")

    # Candy Machine sidecar (Node/Umi service)
    CANDY_MACHINE_SERVICE_URL = os.environ.get("CANDY_MACHINE_SERVICE_URL", "http://localhost:4000")
    CANDY_MACHINE_SHARED_SECRET = os.environ.get("CANDY_MACHINE_SHARED_SECRET", "")

    # Pinata (Phase 3) — the old app defaulted to Infura's IPFS pinning service,
    # which no longer accepts new signups. Pinata is the only supported provider
    # now. Prefer a JWT if set; fall back to the legacy key/secret header pair.
    PINATA_JWT = os.environ.get("PINATA_JWT", "")
    PINATA_API_KEY = os.environ.get("PINATA_API_KEY", "")
    PINATA_SECRET_KEY = os.environ.get("PINATA_SECRET_KEY", "")

    # AI Trait Identifier (Phase 3) — optional. Without it, trait analysis still
    # runs (real color/composition/technical CV analysis), just without the
    # AI-vision section.
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

    # Local storage for trait/generated images before an explicit "publish to
    # IPFS" step (see app/services/nft_generation.py).
    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", os.path.join(os.getcwd(), "instance", "uploads"))
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_CONTENT_LENGTH", str(16 * 1024 * 1024)))


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
    # Base Config defaults this to "" (no secret set) since it's normally an
    # env var — tests that exercise candy_machine.py past its own validation
    # (real requests.post/get calls are mocked, but _sidecar_headers() itself
    # isn't) need a non-empty value or every such call 500s before the mock
    # is ever reached.
    CANDY_MACHINE_SHARED_SECRET = "test-shared-secret"
