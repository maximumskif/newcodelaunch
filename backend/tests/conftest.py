import os

# Config._require("SECRET_KEY"/"JWT_SECRET_KEY") runs at class-definition
# time (see app/config.py) — both must be set before `app.config`/`app` is
# ever imported, not just before create_app() is called.
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-real-use")
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-key-not-for-real-use")

import pytest

from app import create_app
from app.config import TestConfig
from app.extensions import db as _db


@pytest.fixture
def app():
    application = create_app(TestConfig)
    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()
