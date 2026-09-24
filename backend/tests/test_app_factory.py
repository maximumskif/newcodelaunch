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


def test_rpc_url_env_falls_back_on_unset_or_blank_values(monkeypatch):
    # `NAME=` in an env file sets "", not unset — must still mean "use the
    # public default", not hand web3/solana-py an empty URL.
    from app.config import _rpc_url_env

    monkeypatch.delenv("PROBE_RPC_URL", raising=False)
    assert _rpc_url_env("PROBE_RPC_URL", "https://default.example") == "https://default.example"
    monkeypatch.setenv("PROBE_RPC_URL", "  ")
    assert _rpc_url_env("PROBE_RPC_URL", "https://default.example") == "https://default.example"
    monkeypatch.setenv("PROBE_RPC_URL", "https://provider.example/key")
    assert _rpc_url_env("PROBE_RPC_URL", "https://default.example") == "https://provider.example/key"


def test_every_supported_network_has_a_configured_rpc_url():
    # Every network blockchain.py can route to reads its URL from config —
    # so every one can be pointed at a paid provider by env var alone.
    from app.services.blockchain import _RPC_CONFIG_KEYS, EVM_NETWORKS, SOLANA_NETWORKS

    assert set(_RPC_CONFIG_KEYS) == set(EVM_NETWORKS) | set(SOLANA_NETWORKS)
    for config_key in _RPC_CONFIG_KEYS.values():
        assert getattr(TestConfig, config_key).startswith("http")
