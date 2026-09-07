import importlib
import os

import pytest
import redis as redis_client_lib
from limits.storage import RedisStorage

import app.config as config_module
from app import create_app
from app.extensions import db, limiter

# Real Redis (or a wire-compatible server, e.g. Valkey) instance — set by CI
# via a `redis` service container, or manually for a local run. No mocking:
# these tests exist specifically because a config-key typo once made
# RATE_LIMIT_STORAGE_URI silently do nothing (see the comment in config.py),
# and a mock of flask_limiter's storage selection could never have caught
# that — the bug was in which literal string reached real Flask-Limiter code.
REDIS_URL = os.environ.get("TEST_REDIS_URL")

pytestmark = pytest.mark.skipif(
    not REDIS_URL, reason="TEST_REDIS_URL not set — no Redis/Valkey instance available for this run"
)


@pytest.fixture
def redis_test_config(monkeypatch):
    # Config's attributes are computed once at class-body (import) time from
    # os.environ — reload the module after setting the env var so this goes
    # through the exact same env-var -> Config-attribute path production
    # does, rather than hardcoding the resulting attribute name in a
    # subclass (which would test nothing: it'd bypass config.py entirely).
    monkeypatch.setenv("RATE_LIMIT_STORAGE_URI", REDIS_URL)
    importlib.reload(config_module)
    try:
        yield config_module.TestConfig
    finally:
        monkeypatch.delenv("RATE_LIMIT_STORAGE_URI", raising=False)
        importlib.reload(config_module)  # restore the memory:// default for every other test


@pytest.fixture
def redis_client():
    client = redis_client_lib.from_url(REDIS_URL)
    client.flushdb()  # isolate from any prior run against this same instance
    yield client
    client.flushdb()


def test_ratelimit_storage_uri_config_key_actually_reaches_flask_limiter(redis_test_config, redis_client):
    # Guards the exact bug found in this repo: Flask-Limiter reads the
    # literal config key "RATELIMIT_STORAGE_URI" (see
    # flask_limiter.constants.ConfigVars.STORAGE_URI) — a differently-named
    # key (as config.py used to have) is silently ignored, falling back to
    # in-memory storage with no error at all.
    create_app(redis_test_config)
    assert isinstance(limiter._storage, RedisStorage)


def test_nonce_rate_limit_is_shared_across_separate_app_instances_via_redis(redis_test_config, redis_client):
    # This is the actual point of Redis-backed rate limiting: under gunicorn
    # with multiple workers, each worker constructs its own Flask app /
    # Limiter object, so the limit is only real if the *storage* is shared,
    # not the in-process object. Simulate that by hammering the limit
    # against one app instance, then hitting it again on a second,
    # independently-created app instance pointed at the same Redis URL.
    wallet_address = "0x000000000000000000000000000000000000aa"
    payload = {"wallet_address": wallet_address, "chain": "evm"}

    app_one = create_app(redis_test_config)
    with app_one.app_context():
        db.create_all()
    client_one = app_one.test_client()

    # The per-wallet limit is 10/minute (see auth/routes.py's
    # _nonce_request_key) — exhaust it on the first "worker".
    for _ in range(10):
        response = client_one.post("/api/auth/nonce", json=payload)
        assert response.status_code == 200

    # 11th request on the same instance is correctly rejected.
    assert client_one.post("/api/auth/nonce", json=payload).status_code == 429

    # A brand-new app/Limiter object, own separate in-memory SQLite DB —
    # nothing about this app instance has seen any of the 10 prior wallet
    # nonce requests. If the *rate-limit* storage were in-memory too (the
    # pre-fix behavior, since the wrong config key meant this always
    # silently fell back to "memory://"), this would incorrectly succeed
    # with a fresh counter. It must still be rate-limited, because the
    # counter genuinely lives in Redis, shared by config alone, not by
    # either app object.
    app_two = create_app(redis_test_config)
    with app_two.app_context():
        db.create_all()
    client_two = app_two.test_client()
    response = client_two.post("/api/auth/nonce", json=payload)
    assert response.status_code == 429
