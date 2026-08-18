from app.services import blockchain


def test_gas_price_rejects_unknown_network(client):
    response = client.get("/api/blockchain/nonexistent/gas-price")
    assert response.status_code == 404


def test_gas_price_returns_a_clean_error_on_rpc_failure(client, monkeypatch):
    # Regression test: a flaky/unreachable public RPC endpoint (llamarpc.com,
    # polygon-rpc.com, etc — found happening for real, not hypothetically)
    # used to crash this route with an unhandled 500 that, with debug=True,
    # leaked a full traceback to the caller. Every RPC call here is a real
    # network request that can genuinely fail — this must degrade to a clean
    # JSON 502, the same way _get_evm_status already does for /status.
    def fake_get_gas_price_gwei(network):
        raise ConnectionError("RPC endpoint unreachable")

    monkeypatch.setattr(blockchain, "get_gas_price_gwei", fake_get_gas_price_gwei)

    response = client.get("/api/blockchain/sepolia/gas-price")

    assert response.status_code == 502
    assert "error" in response.get_json()


def test_gas_price_reports_no_concept_for_solana(client, monkeypatch):
    monkeypatch.setattr(blockchain, "get_gas_price_gwei", lambda network: None)

    response = client.get("/api/blockchain/solana_devnet/gas-price")

    assert response.status_code == 400
