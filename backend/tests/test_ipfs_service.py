import requests

from app.services import ipfs


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def _configure_pinata(app):
    app.config["PINATA_JWT"] = "test-jwt"


def test_upload_file_returns_the_real_pinata_shape(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        monkeypatch.setattr(
            ipfs.requests, "post", lambda *a, **k: _FakeResponse(200, {"IpfsHash": "QmABC", "PinSize": 123})
        )

        result = ipfs.upload_file(b"fake-bytes", "trait.png")

        assert result["hash"] == "QmABC"
        assert result["url"] == "ipfs://QmABC"
        assert result["size"] == 123


def test_upload_file_raises_a_clean_error_on_a_non_200(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        monkeypatch.setattr(ipfs.requests, "post", lambda *a, **k: _FakeResponse(500, "server error"))

        try:
            ipfs.upload_file(b"fake-bytes", "trait.png")
            assert False, "expected IPFSUploadError"
        except ipfs.IPFSUploadError:
            pass


def test_upload_file_raises_a_clean_error_on_a_connection_failure_instead_of_crashing(app, monkeypatch):
    # Regression: requests.post had no try/except around connection
    # failures, unlike every other outbound-HTTP call in this codebase — a
    # real Pinata timeout/connection error propagated uncaught as a raw
    # requests.exceptions.ConnectionError instead of the IPFSUploadError
    # pattern every caller (nft_collections.py, candy_machine.py) already
    # expects and catches.
    with app.app_context():
        _configure_pinata(app)

        def _raise(*_a, **_k):
            raise requests.exceptions.ConnectionError("connection refused")

        monkeypatch.setattr(ipfs.requests, "post", _raise)

        try:
            ipfs.upload_file(b"fake-bytes", "trait.png")
            assert False, "expected IPFSUploadError"
        except ipfs.IPFSUploadError:
            pass


def test_upload_json_raises_a_clean_error_on_a_connection_failure_instead_of_crashing(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)

        def _raise(*_a, **_k):
            raise requests.exceptions.Timeout("timed out")

        monkeypatch.setattr(ipfs.requests, "post", _raise)

        try:
            ipfs.upload_json({"name": "Test"}, "metadata.json")
            assert False, "expected IPFSUploadError"
        except ipfs.IPFSUploadError:
            pass


def test_upload_json_returns_the_real_pinata_shape(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        monkeypatch.setattr(ipfs.requests, "post", lambda *a, **k: _FakeResponse(200, {"IpfsHash": "QmMeta"}))

        result = ipfs.upload_json({"name": "Test"}, "metadata.json")

        assert result["hash"] == "QmMeta"
        assert result["url"] == "ipfs://QmMeta"
