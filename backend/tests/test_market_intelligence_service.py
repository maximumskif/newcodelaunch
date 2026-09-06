from app.services import market_intelligence


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


_COINS_PAYLOAD = [
    {
        "id": "bitcoin",
        "symbol": "btc",
        "name": "Bitcoin",
        "image": "https://example.com/btc.png",
        "current_price": 65000.12,
        "market_cap": 1_280_000_000_000,
        "market_cap_rank": 1,
        "total_volume": 30_000_000_000,
        "price_change_percentage_24h": 2.5,
    },
    {
        "id": "ethereum",
        "symbol": "eth",
        "name": "Ethereum",
        "image": "https://example.com/eth.png",
        "current_price": 3400.0,
        "market_cap": 410_000_000_000,
        "market_cap_rank": 2,
        "total_volume": 12_000_000_000,
        "price_change_percentage_24h": -1.1,
    },
]


def _reset_cache():
    market_intelligence._cache.clear()


def test_get_top_tokens_maps_a_real_coingecko_shape(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(market_intelligence.requests, "get", lambda *a, **k: _FakeResponse(_COINS_PAYLOAD))

        tokens = market_intelligence.get_top_tokens(limit=2)

        assert tokens[0]["id"] == "bitcoin"
        assert tokens[0]["symbol"] == "BTC"  # uppercased
        assert tokens[0]["current_price"] == 65000.12
        assert tokens[1]["id"] == "ethereum"


def test_get_top_tokens_raises_a_clean_error_on_a_malformed_200(app, monkeypatch):
    # A rate-limited/error response can still come back 200 with a dict
    # body instead of the expected list — must not crash with a raw
    # AttributeError/TypeError on the list comprehension below it.
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(
            market_intelligence.requests, "get", lambda *a, **k: _FakeResponse({"status": "error"})
        )

        try:
            market_intelligence.get_top_tokens(limit=5)
            assert False, "expected MarketDataError"
        except market_intelligence.MarketDataError:
            pass


def test_get_top_tokens_caches_within_the_ttl_window(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        call_count = {"n": 0}

        def fake_get(*args, **kwargs):
            call_count["n"] += 1
            return _FakeResponse(_COINS_PAYLOAD)

        monkeypatch.setattr(market_intelligence.requests, "get", fake_get)

        first = market_intelligence.get_top_tokens(limit=2)
        second = market_intelligence.get_top_tokens(limit=2)

        assert call_count["n"] == 1
        assert first == second


def test_get_top_tokens_refetches_once_the_cache_entry_expires(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        call_count = {"n": 0}

        def fake_get(*args, **kwargs):
            call_count["n"] += 1
            return _FakeResponse(_COINS_PAYLOAD)

        monkeypatch.setattr(market_intelligence.requests, "get", fake_get)
        monkeypatch.setattr(market_intelligence, "_CACHE_TTL_SECONDS", 0)

        market_intelligence.get_top_tokens(limit=2)
        market_intelligence.get_top_tokens(limit=2)

        assert call_count["n"] == 2


def test_get_top_tokens_caches_separately_per_limit(app, monkeypatch):
    # CoinGecko's own per_page param is limit-scoped, unlike DeFiLlama's
    # /protocols (see test_defi_scanner_service.py) — a distinct limit is a
    # genuinely distinct upstream request, so each must get its own entry.
    with app.app_context():
        _reset_cache()
        call_count = {"n": 0}

        def fake_get(*args, **kwargs):
            call_count["n"] += 1
            return _FakeResponse(_COINS_PAYLOAD)

        monkeypatch.setattr(market_intelligence.requests, "get", fake_get)

        market_intelligence.get_top_tokens(limit=2)
        market_intelligence.get_top_tokens(limit=5)

        assert call_count["n"] == 2
