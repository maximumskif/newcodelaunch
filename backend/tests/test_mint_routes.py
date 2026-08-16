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


def test_prepare_preserves_an_explicit_zero_seller_fee_bps(app, client, monkeypatch):
    # Regression test: `int(data.get("seller_fee_bps") or 500)` treated an
    # explicit 0 (no royalty) as falsy and silently replaced it with the
    # 500 bps default.
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        captured = {}

        def fake_prepare(**kwargs):
            captured.update(kwargs)
            return {"collection_mint": "x", "candy_machine": "y", "transactions": []}

        monkeypatch.setattr(candy_machine, "prepare_candy_machine", fake_prepare)

        response = client.post(
            "/api/mint/prepare",
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


def test_prepare_rejects_non_numeric_price(app, client):
    with app.app_context():
        collection, token = _make_authenticated_collection(app)

        response = client.post(
            "/api/mint/prepare",
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
