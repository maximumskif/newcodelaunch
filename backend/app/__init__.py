from flask import Flask

from .config import Config
from .extensions import cors, db, jwt, limiter, migrate


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    # Batch mode is required for SQLite (no native ALTER TABLE support —
    # Alembic falls back to copy-and-swap); harmless but unnecessary on
    # Postgres, the real deploy target, so only turn it on for SQLite.
    is_sqlite = app.config.get("SQLALCHEMY_DATABASE_URI", "").startswith("sqlite")
    migrate.init_app(app, db, render_as_batch=is_sqlite)
    cors.init_app(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    jwt.init_app(app)
    limiter.init_app(app)

    from . import models  # noqa: F401  (registers models with SQLAlchemy metadata)

    from .blueprints.health import health_bp

    app.register_blueprint(health_bp, url_prefix="/api")

    from .blueprints.auth import auth_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    from .blueprints.blockchain import blockchain_bp

    app.register_blueprint(blockchain_bp, url_prefix="/api/blockchain")

    from .blueprints.contracts import contracts_bp

    app.register_blueprint(contracts_bp, url_prefix="/api/contracts")

    from .blueprints.nft import nft_bp

    app.register_blueprint(nft_bp, url_prefix="/api/nft")

    from .blueprints.projects import projects_bp

    app.register_blueprint(projects_bp, url_prefix="/api/projects")

    from .blueprints.market import market_bp

    app.register_blueprint(market_bp, url_prefix="/api/market")

    from .blueprints.defi import defi_bp

    app.register_blueprint(defi_bp, url_prefix="/api/defi")

    from .blueprints.mint import mint_bp

    app.register_blueprint(mint_bp, url_prefix="/api/mint")

    from .commands import register_cli

    register_cli(app)

    return app
