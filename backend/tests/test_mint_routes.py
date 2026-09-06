from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.nft import NFTCollection
from app.models.user import Chain, User
from app.services import candy_machine


def _make_authenticated_collection(app):
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    collection = NFTCollection(user_id=user.id, name="Test Collection", description="", collection_size=10, image_size=512)
    _db.session.add(collection)
    _db.session.commit()
    token = create_access_token(identity=user.id)
    return collection, token


def test_prepare_collection_preserves_an_explicit_zero_seller_fee_bps(app, client, monkeypatch):
    # Regression test: `int(data.get("seller_fee_bps") or 500)` treated an
    # explicit 0 (no royalty) as falsy and silently replaced it with the
    # 500 bps default.
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        captured = {}

        def fake_prepare_collection(**kwargs):
            captured.update(kwargs)
            return {"collection_mint": "x", "transaction": "base64tx"}

        monkeypatch.setattr(candy_machine, "prepare_collection", fake_prepare_collection)

        response = client.post(
            "/api/mint/prepare-collection",
            json={
                "collection_id": collection.id,
                "network": "solana_devnet",
                "creator_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                "price_sol": 0.1,
                "go_live_date": "2026-09-01T00:00:00Z",
                "seller_fee_bps": 0,
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert captured["seller_fee_bps"] == 0


def test_prepare_collection_rejects_non_numeric_price(app, client):
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        response = client.post(
            "/api/mint/prepare-collection",
            json={
                "collection_id": collection.id,
                "network": "solana_devnet",
                "creator_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                "price_sol": "not-a-number",
                "go_live_date": "2026-09-01T00:00:00Z",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400


def test_prepare_candy_machine_step_requires_collection_mint(app, client):
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        response = client.post(
            "/api/mint/prepare-candy-machine",
            json={
                "collection_id": collection.id,
                "network": "solana_devnet",
                "creator_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                "price_sol": 0.1,
                "go_live_date": "2026-09-01T00:00:00Z",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400


def test_prepare_candy_machine_step_forwards_collection_mint(app, client, monkeypatch):
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        captured = {}

        def fake_prepare_step(**kwargs):
            captured.update(kwargs)
            return {"candy_machine": "y", "transactions": ["base64tx"]}

        monkeypatch.setattr(candy_machine, "prepare_candy_machine_step", fake_prepare_step)

        response = client.post(
            "/api/mint/prepare-candy-machine",
            json={
                "collection_id": collection.id,
                "network": "solana_devnet",
                "creator_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                "collection_mint": "CollMint1111111111111111111111111111111111",
                "price_sol": 0.1,
                "go_live_date": "2026-09-01T00:00:00Z",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert captured["collection_mint"] == "CollMint1111111111111111111111111111111111"


def test_get_public_candy_machine_needs_no_auth(client, monkeypatch):
    # No Authorization header at all — a buyer visiting a shared link has
    # no account with this app.
    monkeypatch.setattr(candy_machine, "get_public_candy_machine_status", lambda addr: {"candy_machine": addr})

    response = client.get("/api/mint/public/some-address")

    assert response.status_code == 200
    assert response.get_json() == {"candy_machine": "some-address"}


def test_get_public_candy_machine_404s_on_unknown_address(client, monkeypatch):
    def fake_status(addr):
        raise candy_machine.NotFoundError(f"No candy machine found for address: {addr}")

    monkeypatch.setattr(candy_machine, "get_public_candy_machine_status", fake_status)

    response = client.get("/api/mint/public/nonexistent")

    assert response.status_code == 404


def test_prepare_public_mint_needs_no_auth(client, monkeypatch):
    captured = {}

    def fake_prepare_mint(addr, minter_wallet):
        captured["addr"] = addr
        captured["minter_wallet"] = minter_wallet
        return {"transaction": "base64tx", "nft_mint": "some-mint"}

    monkeypatch.setattr(candy_machine, "prepare_mint", fake_prepare_mint)

    response = client.post(
        "/api/mint/public/some-address/mint",
        json={"minter_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"},
    )

    assert response.status_code == 200
    assert captured == {"addr": "some-address", "minter_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"}


def test_prepare_public_mint_requires_minter_wallet(client):
    response = client.post("/api/mint/public/some-address/mint", json={})
    assert response.status_code == 400


def test_get_public_candy_machine_sanitizes_service_errors(client, monkeypatch):
    # Regression test: a CandyMachineServiceError's message can include the
    # sidecar's raw response body, or an internal-config message like
    # "CANDY_MACHINE_SHARED_SECRET is not configured" — that must never
    # reach an anonymous caller verbatim on these two public routes (unlike
    # the authenticated /prepare route above, where it's fine).
    def fake_status(addr):
        raise candy_machine.CandyMachineServiceError(
            "Candy Machine service returned 500: <secret internal sidecar traceback>", status_code=500
        )

    monkeypatch.setattr(candy_machine, "get_public_candy_machine_status", fake_status)

    response = client.get("/api/mint/public/some-address")

    assert response.status_code == 502
    body = response.get_json()
    assert "secret internal sidecar traceback" not in body["error"]


def test_prepare_public_mint_sanitizes_service_errors(client, monkeypatch):
    def fake_prepare_mint(addr, minter_wallet):
        raise candy_machine.CandyMachineServiceError("CANDY_MACHINE_SHARED_SECRET is not configured")

    monkeypatch.setattr(candy_machine, "prepare_mint", fake_prepare_mint)

    response = client.post(
        "/api/mint/public/some-address/mint",
        json={"minter_wallet": "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"},
    )

    assert response.status_code == 502
    body = response.get_json()
    assert "CANDY_MACHINE_SHARED_SECRET" not in body["error"]
