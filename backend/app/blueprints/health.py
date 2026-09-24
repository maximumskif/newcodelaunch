import requests
from flask import Blueprint, current_app, jsonify
from sqlalchemy import text

from ..extensions import db

health_bp = Blueprint("health", __name__)

# Short on purpose: a readiness probe that hangs for the sidecar's full
# request timeout (candy_machine.py uses 10-60s) would itself get killed by
# whatever is polling it, reporting "timed out" instead of which check failed.
SIDECAR_HEALTH_TIMEOUT_SECONDS = 2


@health_bp.get("/health")
def health():
    # Liveness only: "the process is up and serving requests". Deliberately
    # touches nothing else — Playwright's webServer config and CI poll this
    # while the stack boots, and a liveness probe that fails when a
    # dependency is down gets healthy workers restarted for someone else's
    # outage. Dependency checks live on /health/ready below.
    return jsonify(status="ok")


def _check_database() -> dict:
    try:
        db.session.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as exc:  # any driver/connection error means "not ready"
        db.session.rollback()
        # Full detail goes to the server log only — a DB error string can
        # carry the host/user from DATABASE_URL, and this route is public.
        current_app.logger.warning("Readiness check failed: database: %s", exc)
        return {"ok": False, "error": "database query failed"}


def _check_candy_machine() -> dict:
    # The sidecar's /health needs no shared secret (only /internal does, see
    # services/candy-machine/src/index.ts), so none is sent here.
    url = f"{current_app.config['CANDY_MACHINE_SERVICE_URL']}/health"
    try:
        response = requests.get(url, timeout=SIDECAR_HEALTH_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        current_app.logger.warning("Readiness check failed: candy_machine: %s", exc)
        return {"ok": False, "error": "unreachable"}
    if response.status_code != 200:
        current_app.logger.warning("Readiness check failed: candy_machine returned %s", response.status_code)
        return {"ok": False, "error": f"returned HTTP {response.status_code}"}
    return {"ok": True}


@health_bp.get("/health/ready")
def ready():
    """Readiness: can this instance actually serve traffic that needs its
    dependencies? 200 with every check's result when all pass, 503 naming
    the failed check(s) otherwise — for deploy gating and monitoring. Not a
    load-balancer liveness probe (see /health above): the Candy Machine
    sidecar being down only breaks the Solana routes (Candy Machine drops,
    SPL token launches), not the rest of the API. Error strings are fixed,
    generic ones — never exception text or a URL, since this route is
    unauthenticated."""
    checks = {"database": _check_database(), "candy_machine": _check_candy_machine()}
    failed = [name for name, result in checks.items() if not result["ok"]]
    if failed:
        return jsonify(status="unavailable", failed=failed, checks=checks), 503
    return jsonify(status="ok", checks=checks)
