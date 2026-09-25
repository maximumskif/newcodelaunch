import json

import pytest
from flask_jwt_extended import create_access_token
from web3 import Web3

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.user import Chain, User, WalletIdentity
from app.services import blockchain, liquidity

OWNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
LINKED = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
STRANGER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"
TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
PAIR = "0x1111111111111111111111111111111111111111"
WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"  # Sepolia's, per the built-in table
ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"
MINT_TOPIC = Web3.keccak(text="Mint(address,uint256,uint256)")


class _Call:
    def __init__(self, value):
        self.value = value

    def call(self, block_identifier=None):
        assert block_identifier == 42, "reads must be pinned to the receipt's block"
        return self.value


class _FakeChain:
    """Just enough of web3 for record_provision: one receipt, the factory's
    getPair and the pair's token0."""

    def __init__(self, receipt, pair=PAIR, token0=TOKEN):
        self.receipt, self.pair, self.token0 = receipt, pair, token0
        self.eth = self

    def get_transaction_receipt(self, tx_hash):
        if self.receipt is None:
            raise ValueError("not found")
        return self.receipt

    def contract(self, address, abi):
        chain = self

        class _Functions:
            def getPair(self, a, b):  # noqa: N802 — ABI name
                assert {a.lower(), b.lower()} == {TOKEN.lower(), WETH.lower()}
                return _Call(chain.pair)

            def token0(self):
                return _Call(chain.token0)

        return type("C", (), {"functions": _Functions()})()


def _mint_log(amount0, amount1, address=PAIR):
    return {
        "address": address,
        "topics": [MINT_TOPIC, bytes(12) + bytes.fromhex(ROUTER[2:])],
        "data": amount0.to_bytes(32, "big") + amount1.to_bytes(32, "big"),
    }


def _receipt(sender=OWNER, to=ROUTER, status=1, logs=None):
    return {"blockNumber": 42, "status": status, "from": Web3.to_checksum_address(sender), "to": to, "logs": logs if logs is not None else [_mint_log(1000, 5)]}


@pytest.fixture
def setup(app):
    with app.app_context():
        user = User(wallet_address=OWNER, chain=Chain.EVM)
        _db.session.add(user)
        _db.session.flush()
        _db.session.add(WalletIdentity(user_id=user.id, wallet_address=OWNER, chain=Chain.EVM))
        deployment = ContractDeployment(
            user_id=user.id,
            template_id="erc20_advanced",
            template_name="Advanced ERC-20 Token",
            contract_type="erc20",
            network="sepolia",
            contract_address=TOKEN,
            transaction_hash="0xdeploy",
            deployer_address=OWNER,
            parameters={},
        )
        _db.session.add(deployment)
        _db.session.commit()
        yield {"user_id": user.id, "deployment_id": deployment.id, "headers": {"Authorization": f"Bearer {create_access_token(identity=user.id)}"}}


def _chain(monkeypatch, **kwargs):
    fake = _FakeChain(**kwargs)
    monkeypatch.setattr(blockchain, "get_web3", lambda network: fake)
    return fake


def test_dexes_lists_verified_networks_only(app, client):
    body = client.get("/api/contracts/dexes").get_json()["dexes"]
    assert set(body) == {"ethereum", "sepolia", "polygon", "bsc", "bsc_testnet"}
    assert body["sepolia"]["router"] == ROUTER
    assert body["bsc"]["name"] == "PancakeSwap V2"


def test_dex_overrides_replace_a_network(app, client):
    app.config["DEX_OVERRIDES"] = json.dumps(
        {"sepolia": {"name": "Local V2", "router": STRANGER, "factory": LINKED, "wrapped_native": OWNER}}
    )
    body = client.get("/api/contracts/dexes").get_json()["dexes"]
    assert body["sepolia"] == {
        "name": "Local V2",
        "router": Web3.to_checksum_address(STRANGER),
        "factory": Web3.to_checksum_address(LINKED),
        "wrapped_native": Web3.to_checksum_address(OWNER),
    }
    app.config["DEX_OVERRIDES"] = json.dumps({"mars": {"name": "x", "router": OWNER, "factory": OWNER, "wrapped_native": OWNER}})
    with app.app_context(), pytest.raises(ValueError, match="unknown EVM network"):
        liquidity.dexes()


@pytest.mark.parametrize("token0, expected", [(TOKEN, ("1000", "5")), (WETH, ("5", "1000"))])
def test_records_what_the_pool_actually_received(client, setup, monkeypatch, token0, expected):
    _chain(monkeypatch, receipt=_receipt(), token0=token0)
    response = client.post(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", json={"transaction_hash": "0xadd"}, headers=setup["headers"])
    assert response.status_code == 201, response.get_json()
    provision = response.get_json()["provision"]
    assert (provision["token_amount"], provision["native_amount"]) == expected
    assert provision["pair_address"] == PAIR
    assert provision["dex_name"] == "Uniswap V2"

    # Idempotent, and listed.
    again = client.post(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", json={"transaction_hash": "0xadd"}, headers=setup["headers"])
    assert again.status_code == 201 and again.get_json()["provision"]["id"] == provision["id"]
    listed = client.get(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", headers=setup["headers"]).get_json()
    assert [p["id"] for p in listed["provisions"]] == [provision["id"]]


def test_a_linked_wallet_can_provide(app, client, setup, monkeypatch):
    with app.app_context():
        _db.session.add(WalletIdentity(user_id=setup["user_id"], wallet_address=LINKED, chain=Chain.EVM))
        _db.session.commit()
    _chain(monkeypatch, receipt=_receipt(sender=LINKED))
    response = client.post(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", json={"transaction_hash": "0xadd"}, headers=setup["headers"])
    assert response.status_code == 201


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"receipt": None}, "not found"),
        ({"receipt": _receipt(status=0)}, "reverted"),
        ({"receipt": _receipt(to=STRANGER)}, "router"),
        ({"receipt": _receipt(sender=STRANGER)}, "wallet on this account"),
        ({"receipt": _receipt(), "pair": "0x0000000000000000000000000000000000000000"}, "no pool"),
        # A Mint from some other pair (another token's pool) doesn't count.
        ({"receipt": _receipt(logs=[_mint_log(1, 1, address=STRANGER)])}, "didn't add liquidity"),
        ({"receipt": _receipt(logs=[])}, "didn't add liquidity"),
    ],
)
def test_refuses_anything_the_chain_doesnt_back(client, setup, monkeypatch, kwargs, message):
    _chain(monkeypatch, **kwargs)
    response = client.post(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", json={"transaction_hash": "0xadd"}, headers=setup["headers"])
    assert response.status_code == 422
    assert message in response.get_json()["error"]


def test_owner_only_and_erc20_only(app, client, setup, monkeypatch):
    _chain(monkeypatch, receipt=_receipt())
    with app.app_context():
        other = User(wallet_address=STRANGER, chain=Chain.EVM)
        _db.session.add(other)
        nft = ContractDeployment(
            user_id=setup["user_id"],
            template_id="erc721_basic",
            template_name="NFT",
            contract_type="erc721",
            network="sepolia",
            contract_address="0x2222222222222222222222222222222222222222",
            transaction_hash="0xnft",
            deployer_address=OWNER,
            parameters={},
        )
        _db.session.add(nft)
        _db.session.commit()
        other_headers = {"Authorization": f"Bearer {create_access_token(identity=other.id)}"}
        nft_id = nft.id
    url = f"/api/contracts/deployments/{setup['deployment_id']}/liquidity"
    assert client.post(url, json={"transaction_hash": "0xadd"}, headers=other_headers).status_code == 404
    assert client.get(url, headers=other_headers).status_code == 404
    assert client.post(url, json={"transaction_hash": "0xadd"}).status_code == 401
    assert client.post(url, json={}, headers=setup["headers"]).status_code == 400
    nft_url = f"/api/contracts/deployments/{nft_id}/liquidity"
    assert client.post(nft_url, json={"transaction_hash": "0xadd"}, headers=setup["headers"]).status_code == 404


def test_no_dex_on_a_network_without_one(app, client, setup, monkeypatch):
    _chain(monkeypatch, receipt=_receipt())
    # The fixture's app context is still active and the test client's
    # requests share it — change the row in that same session.
    _db.session.get(ContractDeployment, setup["deployment_id"]).network = "polygon_amoy"
    _db.session.commit()
    response = client.post(f"/api/contracts/deployments/{setup['deployment_id']}/liquidity", json={"transaction_hash": "0xadd"}, headers=setup["headers"])
    assert response.status_code == 422
    assert "No supported DEX" in response.get_json()["error"]
