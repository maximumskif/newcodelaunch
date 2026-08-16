import pytest

from app.extensions import db as _db
from app.models.nft import NFTCollection, NFTGeneratedItem
from app.models.user import Chain, User
from app.services import blockchain, candy_machine

VALID_ADDRESS = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
OTHER_ADDRESS = "2xNweLHLqrxsFCTd7oPHruTxSD5siVBt7XSQP2Vth2mB"


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


def _add_published_items(collection, count):
    for i in range(count):
        item = NFTGeneratedItem(
            collection_id=collection.id,
            token_index=i + 1,
            attributes=[],
            image_path=f"generated/{collection.id}/{i + 1}.png",
            ipfs_image_hash=f"QmImage{i}",
            ipfs_metadata_hash=f"QmMeta{i}",
        )
        _db.session.add(item)
    _db.session.commit()


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


def test_prepare_rejects_too_many_items(app):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        _add_published_items(collection, candy_machine.MAX_ITEMS + 1)
        with pytest.raises(candy_machine.ValidationError):
            candy_machine.prepare_candy_machine(
                collection=collection,
                network="solana_devnet",
                creator_wallet=VALID_ADDRESS,
                price_sol=0.1,
                go_live_date="2026-09-01T00:00:00Z",
            )


def test_record_rejects_a_confirmed_transaction_that_does_not_reference_the_candy_machine(app, monkeypatch):
    # Regression test: a caller could previously supply any successful
    # signature paired with an arbitrary candy_machine address and it would
    # be persisted as if verified — only the *signature's* success was
    # checked, never that it actually touched the claimed account.
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {"status": "success", "account_keys": [OTHER_ADDRESS]},
        )

        with pytest.raises(candy_machine.ValidationError):
            candy_machine.record_candy_machine(
                collection=collection,
                network="solana_devnet",
                collection_mint=VALID_ADDRESS,
                candy_machine=VALID_ADDRESS,
                transaction_signatures=["5" * 88],
                price_sol=0.1,
                items_available=1,
                go_live_date="2026-09-01T00:00:00Z",
                creator_wallet=VALID_ADDRESS,
            )


def test_record_accepts_a_confirmed_transaction_that_references_the_candy_machine(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {"status": "success", "account_keys": [VALID_ADDRESS, OTHER_ADDRESS]},
        )

        deployment = candy_machine.record_candy_machine(
            collection=collection,
            network="solana_devnet",
            collection_mint=OTHER_ADDRESS,
            candy_machine=VALID_ADDRESS,
            transaction_signatures=["5" * 88],
            price_sol=0.1,
            items_available=1,
            go_live_date="2026-09-01T00:00:00Z",
            creator_wallet=VALID_ADDRESS,
        )
        assert deployment.candy_machine == VALID_ADDRESS
