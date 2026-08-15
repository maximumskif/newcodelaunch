"""
Only tests the input-validation path, which fails before any external API
call — CoinGecko/DeFiLlama success-path responses aren't mocked here, so
those aren't exercised by this suite (would need a live network call or a
mocked `requests.get`, neither set up yet).
"""


def test_market_tokens_rejects_a_non_integer_limit(client):
    # Regression test: this used to crash with an unhandled 500
    # (int("abc") raises ValueError, uncaught by the MarketDataError handler).
    response = client.get("/api/market/tokens?limit=abc")
    assert response.status_code == 400


def test_defi_protocols_rejects_a_non_integer_limit(client):
    response = client.get("/api/defi/protocols?limit=xyz")
    assert response.status_code == 400
