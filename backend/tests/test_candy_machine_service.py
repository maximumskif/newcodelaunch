import pytest

from app.extensions import db as _db
from app.models.nft import NFTCollection
from app.models.user import Chain, User
from app.services import candy_machine


def _make_user():
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _make_collection(user_id):
    collection = NFTCollection(user_id=user_id, name="Test Collection", description="", collection_size=10, image_size=512)
    _db.session.add(collection)
    _db.session.commit()
    return collection


def test_prepare_rejects_unknown_network(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.prepare_candy_machine(
                collection=collection,
                network="ethereum",  # not a Solana network
                creator_wallet="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                price_sol=0.1,
                go_live_date="2026-09-01T00:00:00Z",
            )


def test_prepare_rejects_non_positive_price(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.prepare_candy_machine(
                collection=collection,
                network="solana_devnet",
                creator_wallet="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                price_sol=0,
                go_live_date="2026-09-01T00:00:00Z",
            )


def test_prepare_rejects_collection_with_no_published_items(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        # Real collection, real DB row — but zero generated/published items.
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.prepare_candy_machine(
                collection=collection,
                network="solana_devnet",
                creator_wallet="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                price_sol=0.1,
                go_live_date="2026-09-01T00:00:00Z",
            )


def test_record_rejects_unknown_network(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.record_candy_machine(
                collection=collection,
                network="ethereum",
                collection_mint="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                candy_machine="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                transaction_signatures=["5" * 88],
                price_sol=0.1,
                items_available=1,
                go_live_date="2026-09-01T00:00:00Z",
                creator_wallet="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
            )


def test_record_rejects_empty_transaction_signatures(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.record_candy_machine(
                collection=collection,
                network="solana_devnet",
                collection_mint="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                candy_machine="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
                transaction_signatures=[],
                price_sol=0.1,
                items_available=1,
                go_live_date="2026-09-01T00:00:00Z",
                creator_wallet="Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
            )
