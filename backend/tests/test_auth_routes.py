def test_nonce_endpoint_rate_limits_per_wallet(client):
    payload = {"wallet_address": "0xSameWalletOverAndOver", "chain": "evm"}
    for _ in range(10):
        assert client.post("/api/auth/nonce", json=payload).status_code == 200

    blocked = client.post("/api/auth/nonce", json=payload)
    assert blocked.status_code == 429


def test_nonce_endpoint_rate_limit_is_per_wallet_not_global(client):
    exhausted = {"wallet_address": "0xExhaustedWallet", "chain": "evm"}
    for _ in range(10):
        assert client.post("/api/auth/nonce", json=exhausted).status_code == 200
    assert client.post("/api/auth/nonce", json=exhausted).status_code == 429

    # A different wallet, same request (same test-client "IP"), must not be
    # blocked by the wallet above exhausting its own per-wallet bucket.
    other = {"wallet_address": "0xFreshWallet", "chain": "evm"}
    assert client.post("/api/auth/nonce", json=other).status_code == 200


def test_nonce_endpoint_falls_back_to_ip_key_when_wallet_address_missing(client):
    # No wallet_address/chain to key on — _nonce_request_key() falls back to
    # the IP-based key rather than crashing or pooling every malformed
    # request into a single global bucket.
    response = client.post("/api/auth/nonce", json={})
    assert response.status_code == 400


def test_nonce_endpoint_rejects_non_string_fields_instead_of_crashing(client):
    # Regression: wallet_address/chain used to be read as `(data.get(x) or
    # "").strip()` — a truthy non-string JSON value (e.g. an int) is not
    # caught by `or ""`, so `.strip()` raised an unhandled 500. This is
    # unauthenticated attack surface (no token required to reach it).
    response = client.post("/api/auth/nonce", json={"wallet_address": 12345, "chain": "evm"})
    assert response.status_code == 400


def test_verify_endpoint_rejects_non_string_fields_instead_of_crashing(client):
    response = client.post(
        "/api/auth/verify",
        json={"wallet_address": 12345, "chain": "evm", "signature": ["not", "a", "string"], "nonce": {}},
    )
    assert response.status_code == 400
