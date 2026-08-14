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
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", SECRET_KEY)
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

    RATE_LIMIT_STORAGE_URI = os.environ.get("RATE_LIMIT_STORAGE_URI", "memory://")

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
    SOLANA_RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")

    # Market/chain-data API keys — used starting Phase 4 (Market Intelligence / DeFi Scanner).
    # No hardcoded fallback; features that need one degrade to "unavailable", never a leaked key.
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
