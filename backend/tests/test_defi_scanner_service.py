from app.services import defi_scanner


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


_PROTOCOLS_PAYLOAD = [
    {"id": "1", "name": "Small Protocol", "symbol": "SML", "category": "Lending", "chains": ["Ethereum"], "tvl": 1_000_000, "change_1d": 0.1, "change_7d": 1.2, "url": "https://small.example", "logo": None},
    {"id": "2", "name": "Big Protocol", "symbol": "BIG", "category": "DEX", "chains": ["Ethereum", "Polygon"], "tvl": 50_000_000, "change_1d": -0.4, "change_7d": 3.0, "url": "https://big.example", "logo": None},
]


def _reset_cache():
    defi_scanner._cache = None


def test_get_top_protocols_sorts_by_tvl_descending(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(defi_scanner.requests, "get", lambda *a, **k: _FakeResponse(_PROTOCOLS_PAYLOAD))

        protocols = defi_scanner.get_top_protocols(limit=20)

        assert [p["id"] for p in protocols] == ["2", "1"]  # Big Protocol (higher TVL) first


def test_get_top_protocols_applies_limit_after_sorting(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(defi_scanner.requests, "get", lambda *a, **k: _FakeResponse(_PROTOCOLS_PAYLOAD))

        protocols = defi_scanner.get_top_protocols(limit=1)

        assert len(protocols) == 1
        assert protocols[0]["id"] == "2"


def test_get_top_protocols_raises_a_clean_error_on_a_malformed_200(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(defi_scanner.requests, "get", lambda *a, **k: _FakeResponse({"status": "error"}))

        try:
            defi_scanner.get_top_protocols(limit=5)
            assert False, "expected DefiDataError"
        except defi_scanner.DefiDataError:
            pass


def test_get_top_protocols_caches_the_full_list_once_regardless_of_limit(app, monkeypatch):
    # DeFiLlama's /protocols endpoint has no limit param — every call fetches
    # the entire list and slices locally, so two different limits must still
    # only hit the network once within the cache window.
    with app.app_context():
        _reset_cache()
        call_count = {"n": 0}

        def fake_get(*args, **kwargs):
            call_count["n"] += 1
            return _FakeResponse(_PROTOCOLS_PAYLOAD)

        monkeypatch.setattr(defi_scanner.requests, "get", fake_get)

        defi_scanner.get_top_protocols(limit=1)
        defi_scanner.get_top_protocols(limit=20)

        assert call_count["n"] == 1


def test_get_top_protocols_refetches_once_the_cache_entry_expires(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        call_count = {"n": 0}

        def fake_get(*args, **kwargs):
            call_count["n"] += 1
            return _FakeResponse(_PROTOCOLS_PAYLOAD)

        monkeypatch.setattr(defi_scanner.requests, "get", fake_get)
        monkeypatch.setattr(defi_scanner, "_CACHE_TTL_SECONDS", 0)

        defi_scanner.get_top_protocols(limit=20)
        defi_scanner.get_top_protocols(limit=20)

        assert call_count["n"] == 2
