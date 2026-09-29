import pytest
import requests

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


def test_get_top_tokens_tolerates_an_item_missing_id_or_symbol(app, monkeypatch):
    # Regression: a well-formed list response (passes the isinstance(list)
    # guard above) could still contain one item missing id/symbol/name —
    # a plausible delisted/edge-case token, not just a whole-body error
    # shape. Direct indexing (coin["id"], coin["symbol"].upper()) raised an
    # unhandled KeyError instead of a clean MarketDataError.
    with app.app_context():
        _reset_cache()
        malformed_payload = [{"current_price": 1.23, "market_cap": 100}]
        monkeypatch.setattr(market_intelligence.requests, "get", lambda *a, **k: _FakeResponse(malformed_payload))

        tokens = market_intelligence.get_top_tokens(limit=5)

        assert tokens[0]["id"] is None
        assert tokens[0]["symbol"] is None
        assert tokens[0]["current_price"] == 1.23


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


class _Refused:
    def raise_for_status(self):
        raise requests.HTTPError("403 Client Error: Forbidden")


_PAPRIKA = [
    {"id": "btc-bitcoin", "name": "Bitcoin", "symbol": "btc", "rank": 1,
     "quotes": {"USD": {"price": 83000.5, "market_cap": 1.6e12, "volume_24h": 2.2e10, "percent_change_24h": -0.4}}},
]


def _by_host(answers):
    def fake_get(url, **kwargs):
        for fragment, answer in answers.items():
            if fragment in url:
                return answer
        raise AssertionError(f"unexpected request: {url}")
    return fake_get


def test_falls_back_to_coinpaprika_when_coingecko_refuses(app, monkeypatch):
    # Seen for real: CoinGecko answers keyless requests with a 403 from many
    # networks, which left the page with nothing to show.
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(market_intelligence.requests, "get", _by_host({"coingecko": _Refused(), "coinpaprika": _FakeResponse(_PAPRIKA)}))

        source, tokens = market_intelligence.get_top_tokens_with_source(1)

        assert source == "CoinPaprika"
        assert tokens == [{
            "id": "btc-bitcoin", "symbol": "BTC", "name": "Bitcoin", "image": None, "current_price": 83000.5,
            "market_cap": 1.6e12, "market_cap_rank": 1, "total_volume": 2.2e10, "price_change_percentage_24h": -0.4,
        }]


def test_every_source_failing_is_one_clean_error(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(market_intelligence.requests, "get", _by_host({"coingecko": _Refused(), "coinpaprika": _Refused()}))
        with pytest.raises(market_intelligence.MarketDataError, match="CoinGecko.*CoinPaprika"):
            market_intelligence.get_top_tokens_with_source(5)


def test_the_route_names_the_source(client, monkeypatch):
    _reset_cache()
    monkeypatch.setattr(market_intelligence.requests, "get", _by_host({"coingecko": _FakeResponse(_COINS_PAYLOAD)}))
    body = client.get("/api/market/tokens?limit=2").get_json()
    assert body["source"] == "CoinGecko" and len(body["tokens"]) == 2


_PAIR = {
    "chainId": "ethereum", "dexId": "uniswap", "pairAddress": "0xpair", "url": "https://dexscreener.com/ethereum/0xpair",
    "baseToken": {"address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "name": "Wrapped Ether", "symbol": "WETH"},
    "quoteToken": {"symbol": "USDC"}, "priceUsd": "2685.45", "priceChange": {"h24": 1.2}, "volume": {"h24": 5e6},
    "liquidity": {"usd": 1e8}, "fdv": 7e9, "marketCap": 7e9, "pairCreatedAt": 1600000000000, "info": {"imageUrl": "https://img"},
}


def test_lookup_maps_pairs_most_liquid_first(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        thin = {**_PAIR, "pairAddress": "0xthin", "liquidity": {"usd": 10}}
        monkeypatch.setattr(market_intelligence.requests, "get", _by_host({"/latest/dex/tokens/": _FakeResponse({"pairs": [thin, _PAIR]})}))

        pairs = market_intelligence.lookup_token("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")

        assert [p["pair_address"] for p in pairs] == ["0xpair", "0xthin"]
        assert pairs[0]["price_usd"] == 2685.45 and pairs[0]["base_token"]["symbol"] == "WETH"


def test_lookup_rejects_something_that_is_not_an_address(client):
    response = client.get("/api/market/lookup?address=bitcoin")
    assert response.status_code == 400
    assert "address" in response.get_json()["error"]


def test_unlisted_token_is_an_empty_list(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        monkeypatch.setattr(market_intelligence.requests, "get", _by_host({"/latest/dex/tokens/": _FakeResponse({"pairs": None})}))
        assert market_intelligence.lookup_token("46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr") == []


def test_trending_joins_boosts_with_their_best_pair(app, monkeypatch):
    with app.app_context():
        _reset_cache()
        boosts = [
            {"chainId": "ethereum", "tokenAddress": _PAIR["baseToken"]["address"], "totalAmount": 500, "icon": "https://icon"},
            {"chainId": "ethereum", "tokenAddress": "0xnopairs", "totalAmount": 100},
        ]
        thin = {**_PAIR, "pairAddress": "0xthin", "liquidity": {"usd": 10}}
        monkeypatch.setattr(market_intelligence.requests, "get", _by_host({
            "token-boosts": _FakeResponse(boosts),
            "/tokens/v1/ethereum/": _FakeResponse([thin, _PAIR]),
        }))

        tokens = market_intelligence.trending_tokens()

        assert len(tokens) == 1  # a boosted token with no pair is left out
        assert tokens[0]["pair_address"] == "0xpair" and tokens[0]["boosts"] == 500
