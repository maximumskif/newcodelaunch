from datetime import datetime, timedelta, timezone

import pytest

from app.extensions import db as _db
from app.models.candy_machine import CandyMachineDeployment
from app.models.nft import NFTCollection, NFTGeneratedItem
from app.models.user import Chain, User
from app.services import blockchain, candy_machine

VALID_ADDRESS = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
OTHER_ADDRESS = "2xNweLHLqrxsFCTd7oPHruTxSD5siVBt7XSQP2Vth2mB"


class _FakeResponse:
    def __init__(self, status_code, json_data):
        self.status_code = status_code
        self._json_data = json_data
        self.text = str(json_data)

    def json(self):
        return self._json_data


def _make_deployment(collection, *, go_live_delta=timedelta(hours=-1)):
    deployment = CandyMachineDeployment(
        user_id=collection.user_id,
        nft_collection_id=collection.id,
        network="solana_devnet",
        collection_mint=OTHER_ADDRESS,
        candy_machine=VALID_ADDRESS,
        price_sol=0.25,
        items_available=1,
        go_live_date=datetime.now(timezone.utc) + go_live_delta,
        creator_wallet=VALID_ADDRESS,
        transaction_signatures=["5" * 88],
        explorer_url="https://explorer.solana.com/address/x?cluster=devnet",
    )
    _db.session.add(deployment)
    _db.session.commit()
    return deployment


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


def test_record_is_idempotent_for_the_same_candy_machine_address(app, monkeypatch):
    # Regression test: a client retry after a slow/dropped response to a
    # request that actually succeeded server-side used to insert a second
    # row for the same on-chain candy_machine address, which
    # _get_deployment_by_address()'s .first() would then pick between
    # non-deterministically. Now the DB column is unique and the service
    # returns the existing row instead of inserting a duplicate.
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {"status": "success", "account_keys": [VALID_ADDRESS, OTHER_ADDRESS]},
        )

        kwargs = dict(
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

        first = candy_machine.record_candy_machine(**kwargs)
        second = candy_machine.record_candy_machine(**kwargs)

        assert first.id == second.id
        assert CandyMachineDeployment.query.filter_by(candy_machine=VALID_ADDRESS).count() == 1


def test_prepare_sends_the_sidecars_own_network_ids(app, monkeypatch):
    # Regression test: the backend's own network ids (solana_devnet/solana)
    # were being sent to the sidecar unmapped, which only recognizes its
    # own cluster ids (devnet/mainnet-beta) — every real /prepare call
    # would have 400'd. Found while building the public mint storefront.
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        _add_published_items(collection, 1)

        monkeypatch.setattr(candy_machine.ipfs, "upload_json", lambda *a, **k: {"url": "ipfs://collection"})

        captured = {}

        def fake_post(url, json, headers, timeout):
            captured.update(json)
            return _FakeResponse(200, {"collection_mint": "x", "candy_machine": "y", "transactions": []})

        monkeypatch.setattr(candy_machine.requests, "post", fake_post)

        candy_machine.prepare_candy_machine(
            collection=collection,
            network="solana_devnet",
            creator_wallet=VALID_ADDRESS,
            price_sol=0.1,
            go_live_date="2026-09-01T00:00:00Z",
        )

        assert captured["network"] == "devnet"


def test_get_public_status_rejects_an_unknown_address(app):
    with app.app_context():
        with pytest.raises(candy_machine.NotFoundError):
            candy_machine.get_public_candy_machine_status("nonexistent-address")


def test_get_public_status_merges_stored_and_on_chain_data(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        item = NFTGeneratedItem(
            collection_id=collection.id,
            token_index=1,
            attributes=[],
            image_path="generated/x/1.png",
            ipfs_image_hash="QmImage0",
            ipfs_metadata_hash="QmMeta0",
        )
        _db.session.add(item)
        _db.session.commit()
        deployment = _make_deployment(collection, go_live_delta=timedelta(hours=-1))

        def fake_get(url, params, headers, timeout):
            assert params == {"network": "devnet"}
            return _FakeResponse(200, {"items_available": 1, "items_redeemed": 0, "items_remaining": 1})

        monkeypatch.setattr(candy_machine.requests, "get", fake_get)

        status = candy_machine.get_public_candy_machine_status(deployment.candy_machine)

        assert status["candy_machine"] == VALID_ADDRESS
        assert status["is_live"] is True
        assert status["items_remaining"] == 1
        assert status["preview_image"] == f"{candy_machine.ipfs.PINATA_GATEWAY}QmImage0"


def test_get_public_status_not_live_before_go_live_date(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        deployment = _make_deployment(collection, go_live_delta=timedelta(hours=1))

        monkeypatch.setattr(
            candy_machine.requests,
            "get",
            lambda *a, **k: _FakeResponse(200, {"items_available": 1, "items_redeemed": 0, "items_remaining": 1}),
        )

        status = candy_machine.get_public_candy_machine_status(deployment.candy_machine)
        assert status["is_live"] is False


def test_prepare_mint_rejects_an_unknown_address(app):
    with app.app_context():
        with pytest.raises(candy_machine.NotFoundError):
            candy_machine.prepare_mint("nonexistent-address", VALID_ADDRESS)


def test_prepare_mint_sends_the_creator_wallet_as_sol_payment_destination(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        collection = _make_collection(user.id)
        deployment = _make_deployment(collection)

        captured = {}

        def fake_post(url, json, headers, timeout):
            captured.update(json)
            return _FakeResponse(200, {"transaction": "base64tx", "nft_mint": OTHER_ADDRESS})

        monkeypatch.setattr(candy_machine.requests, "post", fake_post)

        result = candy_machine.prepare_mint(deployment.candy_machine, OTHER_ADDRESS)

        assert captured["network"] == "devnet"
        assert captured["minterPublicKey"] == OTHER_ADDRESS
        assert captured["creatorPublicKey"] == VALID_ADDRESS
        assert captured["collectionMint"] == deployment.collection_mint
        assert result["nft_mint"] == OTHER_ADDRESS
