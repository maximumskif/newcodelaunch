import json
import logging

from app.logging_config import JsonFormatter, RequestIdFilter


def _make_record(**extra) -> logging.LogRecord:
    record = logging.LogRecord(
        name="app", level=logging.INFO, pathname=__file__, lineno=1, msg="hello", args=(), exc_info=None
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


class TestJsonFormatter:
    def test_includes_standard_and_extra_fields(self):
        record = _make_record(request_id="req-1", status=200, duration_ms=12.5)

        payload = json.loads(JsonFormatter().format(record))

        assert payload["level"] == "INFO"
        assert payload["logger"] == "app"
        assert payload["message"] == "hello"
        assert payload["request_id"] == "req-1"
        assert payload["status"] == 200
        assert payload["duration_ms"] == 12.5
        assert "timestamp" in payload

    def test_includes_exception_traceback_when_present(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = _make_record()
            record.exc_info = sys.exc_info()

        payload = json.loads(JsonFormatter().format(record))

        assert "ValueError: boom" in payload["exception"]

    def test_omits_exception_key_when_absent(self):
        payload = json.loads(JsonFormatter().format(_make_record()))

        assert "exception" not in payload


class TestRequestIdFilter:
    def test_sets_request_id_to_none_outside_any_request_context(self):
        record = _make_record()

        assert RequestIdFilter().filter(record) is True
        assert record.request_id is None

    def test_leaves_an_already_set_request_id_alone(self):
        record = _make_record(request_id="already-set")

        RequestIdFilter().filter(record)

        assert record.request_id == "already-set"


class TestRequestLogging:
    def test_a_real_request_logs_one_json_line_with_the_expected_fields(self, app, client, caplog):
        with caplog.at_level(logging.INFO, logger="app"):
            response = client.get("/api/health")

        assert response.status_code == 200
        request_logs = [r for r in caplog.records if r.message == "request"]
        assert len(request_logs) == 1
        record = request_logs[0]
        assert record.method == "GET"
        assert record.path == "/api/health"
        assert record.status == 200
        assert isinstance(record.duration_ms, float)
        assert record.request_id  # a real uuid4, not asserting the exact value

    def test_response_carries_an_x_request_id_header(self, app, client):
        response = client.get("/api/health")

        assert response.headers.get("X-Request-Id")

    def test_an_incoming_request_id_is_echoed_back_not_replaced(self, app, client):
        response = client.get("/api/health", headers={"X-Request-Id": "caller-supplied-id"})

        assert response.headers["X-Request-Id"] == "caller-supplied-id"

    def test_incoming_request_id_is_attached_to_the_logged_record_too(self, app, client, caplog):
        with caplog.at_level(logging.INFO, logger="app"):
            client.get("/api/health", headers={"X-Request-Id": "trace-me"})

        request_logs = [r for r in caplog.records if r.message == "request"]
        assert request_logs[0].request_id == "trace-me"
