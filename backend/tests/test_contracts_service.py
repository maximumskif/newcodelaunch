from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.user import Chain, User
from app.services import blockchain, contracts


def _make_user():
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
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
            lambda network, tx_hash: {"status": "success", "gas_used": 21000, "gas_price": 1_000_000_000},
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
