import requests

from app import create_app
from app.blueprints import health
from app.config import TestConfig


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


def _sidecar_returns(monkeypatch, status_code: int, calls: list | None = None):
    def fake_get(url, timeout):
        if calls is not None:
            calls.append((url, timeout))
        return _FakeResponse(status_code)

    monkeypatch.setattr(health.requests, "get", fake_get)


def test_liveness_touches_no_dependency(client, monkeypatch):
    # /api/health is what Playwright's webServer config and CI poll during
    # boot — it must stay 200 even when every dependency is down.
    def explode(*_args, **_kwargs):
        raise AssertionError("liveness must not call the sidecar")

    monkeypatch.setattr(health.requests, "get", explode)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_ready_when_database_and_sidecar_are_up(client, monkeypatch):
    calls = []
    _sidecar_returns(monkeypatch, 200, calls)

    response = client.get("/api/health/ready")

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "ok",
        "checks": {"database": {"ok": True}, "candy_machine": {"ok": True}},
    }
    # The sidecar's own unauthenticated /health, with the short timeout —
    # not one of candy_machine.py's 10-60s request timeouts.
    assert calls == [("http://localhost:4000/health", health.SIDECAR_HEALTH_TIMEOUT_SECONDS)]


def test_not_ready_when_sidecar_is_unreachable(client, monkeypatch):
    def refuse(url, timeout):
        raise requests.ConnectionError(f"Max retries exceeded with url: {url} (secret-bearing detail)")

    monkeypatch.setattr(health.requests, "get", refuse)

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "unavailable"
    assert body["failed"] == ["candy_machine"]
    assert body["checks"]["database"] == {"ok": True}
    assert body["checks"]["candy_machine"] == {"ok": False, "error": "unreachable"}
    # Exception text (URLs, hostnames) stays in the server log.
    assert "secret-bearing" not in response.get_data(as_text=True)
    assert "localhost:4000" not in response.get_data(as_text=True)


def test_not_ready_when_sidecar_returns_an_error_status(client, monkeypatch):
    _sidecar_returns(monkeypatch, 500)

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.get_json()["checks"]["candy_machine"] == {"ok": False, "error": "returned HTTP 500"}


def test_not_ready_when_database_is_unreachable(monkeypatch):
    # A real failing connection, not a mocked one: SQLite can't create a
    # file in a directory that doesn't exist.
    class BrokenDatabaseConfig(TestConfig):
        SQLALCHEMY_DATABASE_URI = "sqlite:////nonexistent-readiness-dir/private-name.db"

    app = create_app(BrokenDatabaseConfig)
    _sidecar_returns(monkeypatch, 200)

    response = app.test_client().get("/api/health/ready")

    assert response.status_code == 503
    body = response.get_json()
    assert body["failed"] == ["database"]
    assert body["checks"]["database"] == {"ok": False, "error": "database query failed"}
    assert body["checks"]["candy_machine"] == {"ok": True}
    assert "private-name" not in response.get_data(as_text=True)
    assert "Traceback" not in response.get_data(as_text=True)


def test_reports_every_failed_check_at_once(monkeypatch):
    class BrokenDatabaseConfig(TestConfig):
        SQLALCHEMY_DATABASE_URI = "sqlite:////nonexistent-readiness-dir/app.db"

    app = create_app(BrokenDatabaseConfig)
    _sidecar_returns(monkeypatch, 503)

    response = app.test_client().get("/api/health/ready")

    assert response.status_code == 503
    assert response.get_json()["failed"] == ["database", "candy_machine"]


def test_readiness_is_rate_limited(app, client, monkeypatch):
    # Public and fans out to the database and the sidecar — see health.py.
    monkeypatch.setattr(health.requests, "get", lambda url, timeout: type("R", (), {"status_code": 200})())
    statuses = [client.get("/api/health/ready").status_code for _ in range(61)]
    assert statuses[:60] == [200] * 60
    assert statuses[60] == 429
