import pytest

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.nft import NFTCollection
from app.models.user import Chain, User
from app.services import blockchain, contracts


def _make_user(wallet_address: str = "0xabc0000000000000000000000000000000000a"):
    user = User(wallet_address=wallet_address, chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def test_record_deployment_is_idempotent_for_the_same_transaction_hash(app, monkeypatch):
    # Regression test: a client retry after a slow/dropped response to a
    # request that actually broadcast successfully used to insert a second
    # ContractDeployment row for the same on-chain transaction — the exact
    # bug class already fixed for candy_machine.record_candy_machine.
    # transaction_hash is now a unique DB column and the service returns
    # the existing row instead of inserting a duplicate.
    with app.app_context():
        user = _make_user()

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {
                "status": "success",
                "gas_used": 21000,
                "gas_price": 1_000_000_000,
                "contract_address": "0xContractAddress",
                "from": "0xDeployerAddress",
            },
        )

        kwargs = dict(
            user_id=user.id,
            template_id="erc20_basic",
            network="sepolia",
            contract_address="0xContractAddress",
            transaction_hash="0xSameTransactionHash",
            deployer_address="0xDeployerAddress",
            parameters={"TOKEN_NAME": "MyToken", "TOKEN_SYMBOL": "MTK", "TOKEN_DECIMALS": 18, "TOKEN_SUPPLY": 1000},
        )

        first = contracts.record_deployment(**kwargs)
        second = contracts.record_deployment(**kwargs)

        assert first.id == second.id
        assert ContractDeployment.query.filter_by(transaction_hash="0xSameTransactionHash").count() == 1


def test_record_deployment_still_rejects_an_unconfirmed_transaction(app, monkeypatch):
    with app.app_context():
        user = _make_user()

        monkeypatch.setattr(
            blockchain, "get_transaction_status", lambda network, tx_hash: {"status": "failed"}
        )

        try:
            contracts.record_deployment(
                user_id=user.id,
                template_id="erc20_basic",
                network="sepolia",
                contract_address="0xContractAddress",
                transaction_hash="0xNeverSucceeded",
                deployer_address="0xDeployerAddress",
                parameters={},
            )
            assert False, "expected a ValueError for a non-successful transaction"
        except ValueError:
            pass

        assert ContractDeployment.query.filter_by(transaction_hash="0xNeverSucceeded").count() == 0


def test_record_deployment_rejects_a_transaction_hash_already_recorded_by_a_different_user(app, monkeypatch):
    # Regression: the idempotency check above was scoped only by
    # transaction_hash, not by user — since a transaction hash is public
    # (visible on any block explorer), a second user could submit a hash
    # they merely observed (never deployed themselves) and get back, and
    # silently link into their own project, a deployment row that actually
    # belongs to a different user.
    with app.app_context():
        user_a = _make_user("0xaaa0000000000000000000000000000000000a")
        user_b = _make_user("0xbbb0000000000000000000000000000000000b")

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {
                "status": "success",
                "gas_used": 21000,
                "gas_price": 1_000_000_000,
                "contract_address": "0xContractAddress",
                "from": "0xDeployerAddress",
            },
        )

        shared_kwargs = dict(
            template_id="erc20_basic",
            network="sepolia",
            contract_address="0xContractAddress",
            transaction_hash="0xObservedPubliclyOnAnExplorer",
            deployer_address="0xDeployerAddress",
            parameters={},
        )

        contracts.record_deployment(user_id=user_a.id, **shared_kwargs)

        try:
            contracts.record_deployment(user_id=user_b.id, **shared_kwargs)
            assert False, "expected a ValueError — this transaction belongs to a different user"
        except ValueError:
            pass

        # Still exactly one row, owned by user_a — user_b's attempt must not
        # have been handed back someone else's row nor inserted a new one
        # (which the unique constraint would reject anyway).
        deployment = ContractDeployment.query.filter_by(
            transaction_hash="0xObservedPubliclyOnAnExplorer"
        ).one()
        assert deployment.user_id == user_a.id


def _successful_receipt(contract_address="0xContractAddress", sender="0xDeployerAddress"):
    return lambda network, tx_hash: {
        "status": "success",
        "gas_used": 21000,
        "gas_price": 1_000_000_000,
        "contract_address": contract_address,
        "from": sender,
    }


def _record(user, **overrides):
    kwargs = dict(
        user_id=user.id,
        template_id="erc20_basic",
        network="sepolia",
        contract_address="0xcontractaddress",  # case-insensitive match
        transaction_hash="0xTx",
        deployer_address="0xDeployerAddress",
        parameters={},
    )
    kwargs.update(overrides)
    return contracts.record_deployment(**kwargs)


def test_record_deployment_rejects_a_receipt_that_created_a_different_contract(app, monkeypatch):
    # Regression: only the transaction's success used to be checked, so any
    # successful hash could be recorded next to an arbitrary contract address.
    with app.app_context():
        user = _make_user()
        monkeypatch.setattr(blockchain, "get_transaction_status", _successful_receipt(contract_address="0xSomethingElse"))
        with pytest.raises(ValueError, match="did not create"):
            _record(user)

        monkeypatch.setattr(blockchain, "get_transaction_status", _successful_receipt(contract_address=None))
        with pytest.raises(ValueError, match="did not create"):
            _record(user)


def test_record_deployment_rejects_a_receipt_from_a_different_sender(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        monkeypatch.setattr(blockchain, "get_transaction_status", _successful_receipt(sender="0xSomeoneElse"))
        with pytest.raises(ValueError, match="not sent by"):
            _record(user)


def test_record_deployment_links_an_owned_nft_collection_to_an_erc721_only(app, monkeypatch):
    with app.app_context():
        user = _make_user()
        collection = NFTCollection(user_id=user.id, name="Apes", description="", collection_size=3, image_size=64)
        _db.session.add(collection)
        _db.session.commit()
        monkeypatch.setattr(blockchain, "get_transaction_status", _successful_receipt())

        with pytest.raises(ValueError, match="only applies to an ERC-721"):
            _record(user, nft_collection_id=collection.id)

        stranger = _make_user("0xabc000000000000000000000000000000000000b")
        with pytest.raises(ValueError, match="not found"):
            _record(stranger, template_id="erc721_basic", nft_collection_id=collection.id, transaction_hash="0xOther")

        deployment = _record(user, template_id="erc721_basic", nft_collection_id=collection.id)
        assert deployment.to_dict()["nft_collection_id"] == collection.id
