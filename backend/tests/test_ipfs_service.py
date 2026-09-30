import pytest
import requests

from app.services import ipfs


@pytest.fixture(autouse=True)
def _forget_remembered_apis():
    ipfs._api_for_credential.clear()
    yield
    ipfs._api_for_credential.clear()


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
        app.config["PINATA_API"] = "legacy"
        monkeypatch.setattr(
            ipfs.requests, "post", lambda *a, **k: _FakeResponse(200, {"IpfsHash": "QmABC", "PinSize": 123})
        )

        result = ipfs.upload_file(b"fake-bytes", "trait.png")

        assert result["hash"] == "QmABC"
        assert result["url"] == "ipfs://QmABC"


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
        app.config["PINATA_API"] = "legacy"
        monkeypatch.setattr(ipfs.requests, "post", lambda *a, **k: _FakeResponse(200, {"IpfsHash": "QmMeta"}))

        result = ipfs.upload_json({"name": "Test"}, "metadata.json")

        assert result["hash"] == "QmMeta"
        assert result["url"] == "ipfs://QmMeta"


def test_blank_pinata_url_env_vars_fall_back_to_the_real_endpoints(monkeypatch):
    # backend/.env.example ships PINATA_BASE_URL=/PINATA_GATEWAY_URL= blank,
    # which python-dotenv loads as "" — that must mean "default", not a
    # hostless URL.
    monkeypatch.setenv("PINATA_BASE_URL", "")
    assert ipfs._url_from_env("PINATA_BASE_URL", "https://api.pinata.cloud") == "https://api.pinata.cloud"
    monkeypatch.delenv("PINATA_BASE_URL")
    assert ipfs._url_from_env("PINATA_BASE_URL", "https://api.pinata.cloud") == "https://api.pinata.cloud"
    monkeypatch.setenv("PINATA_BASE_URL", "http://127.0.0.1:5555")
    assert ipfs._url_from_env("PINATA_BASE_URL", "https://api.pinata.cloud") == "http://127.0.0.1:5555"


class _Recorder:
    """requests.post stand-in: answers by URL, records each call."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def __call__(self, url, files=None, data=None, headers=None, timeout=None):
        self.calls.append({"url": url, "files": files, "data": data, "headers": headers})
        for fragment, answer in self.answers.items():
            if fragment in url:
                return answer
        raise AssertionError(f"unexpected request: {url}")


V3_OK = _FakeResponse(200, {"data": {"cid": "bafyV3", "mime_type": "file"}})
LEGACY_OK = _FakeResponse(200, {"IpfsHash": "QmLegacy"})
NO_SCOPES = _FakeResponse(403, {"error": {"reason": "NO_SCOPES_FOUND"}})


def test_a_jwt_uploads_through_the_v3_files_api(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        post = _Recorder({"/v3/files": V3_OK})
        monkeypatch.setattr(ipfs.requests, "post", post)

        result = ipfs.upload_json({"name": "Ape #1"}, "ape_1.json")

        assert result == {"hash": "bafyV3", "url": "ipfs://bafyV3", "gateway_url": f"{ipfs.PINATA_GATEWAY}bafyV3"}
        (call,) = post.calls
        assert call["url"].endswith("/v3/files") and call["data"] == {"network": "public"}
        assert call["headers"] == {"Authorization": "Bearer test-jwt"}
        name, body, content_type = call["files"][0][1]
        assert (name, body, content_type) == ("ape_1.json", b'{"name": "Ape #1"}', "application/json")


def test_a_key_without_v3_scopes_falls_back_to_the_classic_api_and_is_remembered(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        post = _Recorder({"/v3/files": NO_SCOPES, "/pinning/pinFileToIPFS": LEGACY_OK})
        monkeypatch.setattr(ipfs.requests, "post", post)

        assert ipfs.upload_file(b"png", "a.png")["hash"] == "QmLegacy"
        assert ipfs.upload_file(b"png", "b.png")["hash"] == "QmLegacy"

        # v3 was tried once; after the fallback worked, straight to classic.
        assert [c["url"].rsplit("/", 1)[-1] for c in post.calls] == ["files", "pinFileToIPFS", "pinFileToIPFS"]


def test_a_directory_is_one_upload_of_files_under_a_shared_folder(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        post = _Recorder({"/v3/files": _FakeResponse(200, {"data": {"cid": "bafyDir", "mime_type": "directory"}})})
        monkeypatch.setattr(ipfs.requests, "post", post)

        result = ipfs.upload_directory({"1.json": b"{}", "2.json": b"{}"}, "apes_metadata")

        assert result["url"] == "ipfs://bafyDir/"
        assert [part[1][0] for part in post.calls[0]["files"]] == ["apes_metadata/1.json", "apes_metadata/2.json"]


def test_api_key_and_secret_without_a_jwt_use_the_classic_api(app, monkeypatch):
    with app.app_context():
        app.config.update(PINATA_JWT="", PINATA_API_KEY="k", PINATA_SECRET_KEY="s")
        post = _Recorder({"/pinning/pinFileToIPFS": LEGACY_OK})
        monkeypatch.setattr(ipfs.requests, "post", post)

        assert ipfs.upload_file(b"png", "a.png")["hash"] == "QmLegacy"
        assert post.calls[0]["headers"] == {"pinata_api_key": "k", "pinata_secret_api_key": "s"}


def test_a_real_v3_error_is_reported_not_retried_elsewhere(app, monkeypatch):
    with app.app_context():
        _configure_pinata(app)
        app.config["PINATA_API"] = "v3"
        post = _Recorder({"/v3/files": NO_SCOPES})
        monkeypatch.setattr(ipfs.requests, "post", post)

        with pytest.raises(ipfs.IPFSUploadError, match="403"):
            ipfs.upload_file(b"png", "a.png")
        assert len(post.calls) == 1
