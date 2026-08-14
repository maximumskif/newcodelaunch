from flask import Flask

from .config import Config
from .extensions import cors, db, jwt, limiter, migrate


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    migrate.init_app(app, db)
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

    return app
