"""Structured (JSON) request logging.

Every request gets one JSON log line to stdout — method/path/status/
duration_ms — tagged with a request id that's both echoed back to the
caller (`X-Request-Id`) and attached to every other log record produced
while handling that request (see `RequestIdFilter`), so a real log
aggregator can correlate a single request across every line it produced,
unhandled-exception traceback included (Flask's own `log_exception` already
routes through `app.logger`, which is why nothing extra is needed to catch
that case — see `JsonFormatter`'s `exc_info` handling).

Deliberately stops at "structured logs to stdout," not a specific
error-tracking SDK (Sentry, etc.) — see docs/REBUILD_PROGRESS.md's "known
gap" note on this. Which paid service to send these to is a real deploy-
target decision this codebase has no business making on its own; JSON
lines on stdout is what any of them consume regardless of which is chosen.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from flask import Flask, g, has_request_context, request

REQUEST_ID_HEADER = "X-Request-Id"

# Attributes every LogRecord already has (see logging.makeLogRecord({})) —
# used below to find the *extra* fields a caller passed in via `extra=`,
# without hardcoding their names.
_STANDARD_LOG_RECORD_KEYS = frozenset(vars(logging.makeLogRecord({})).keys())


class JsonFormatter(logging.Formatter):
    """Renders one JSON object per log record. Anything passed via
    `extra=` is folded in verbatim alongside the standard fields — that's
    what lets a real aggregator query on `status`/`duration_ms`/
    `request_id` as actual fields, not grep text out of a formatted line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in vars(record).items():
            if key not in _STANDARD_LOG_RECORD_KEYS and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class RequestIdFilter(logging.Filter):
    """Attaches the in-flight request's id to every record that doesn't
    already carry one — not just the one request-completion line logged
    below, but any `current_app.logger.*` call made from inside a route
    while handling that request too."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = g.get("request_id") if has_request_context() else None
        return True


def configure_logging(app: Flask) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())

    # app.logger resolves to logging.getLogger(app.import_name) — a
    # process-wide singleton keyed by name, not a fresh object per Flask()
    # instance. Replacing (not appending to) its handler list keeps this
    # idempotent across repeated create_app() calls (every test in this
    # suite makes a fresh app — see tests/conftest.py's `app` fixture — and
    # they'd otherwise pile up one handler per test). propagate=False keeps
    # every line JSON-formatted exactly once, rather than also hitting
    # whatever (if anything) the root logger has attached.
    app.logger.handlers = [handler]
    app.logger.propagate = False
    app.logger.setLevel(app.config.get("LOG_LEVEL", "INFO"))

    @app.before_request
    def _start_request_log() -> None:
        g.request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        g.request_started_at = time.monotonic()

    @app.after_request
    def _log_request(response):
        started_at = g.get("request_started_at")
        duration_ms = round((time.monotonic() - started_at) * 1000, 2) if started_at is not None else None
        request_id = g.get("request_id") or str(uuid.uuid4())
        response.headers[REQUEST_ID_HEADER] = request_id
        app.logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
                "remote_addr": request.remote_addr,
            },
        )
        return response
