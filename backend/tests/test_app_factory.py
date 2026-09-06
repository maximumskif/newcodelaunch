from werkzeug.middleware.proxy_fix import ProxyFix

from app import create_app
from app.config import TestConfig


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
