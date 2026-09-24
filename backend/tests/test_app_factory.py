from werkzeug.middleware.proxy_fix import ProxyFix

from app import create_app
from app.config import TestConfig
from app.extensions import db


def test_proxy_fix_not_applied_when_trusted_proxy_count_is_zero():
    # Default (TRUSTED_PROXY_COUNT=0) — request.remote_addr must come
    # straight from the WSGI environ, not from a spoofable X-Forwarded-For
    # header, since nothing in front of this app is trusted to have set it.
    application = create_app(TestConfig)
    assert not isinstance(application.wsgi_app, ProxyFix)


def test_proxy_fix_applied_when_trusted_proxy_count_is_configured():
    class ConfigWithProxy(TestConfig):
        TRUSTED_PROXY_COUNT = 1

    application = create_app(ConfigWithProxy)
    assert isinstance(application.wsgi_app, ProxyFix)


def test_rate_limiting_can_be_disabled_for_the_e2e_harness():
    # RATE_LIMIT_ENABLED=false is what frontend/e2e/setup/run-backend.sh sets —
    # the config key must actually reach Flask-Limiter, same trap as the
    # RATELIMIT_STORAGE_URI naming bug (see config.py).
    class NoLimitConfig(TestConfig):
        RATELIMIT_ENABLED = False

    app = create_app(NoLimitConfig)
    with app.app_context():
        db.create_all()
        client = app.test_client()
        payload = {"wallet_address": "0xUnlimitedWallet", "chain": "evm"}
        statuses = [client.post("/api/auth/nonce", json=payload).status_code for _ in range(15)]
        db.drop_all()
    assert statuses == [200] * 15
