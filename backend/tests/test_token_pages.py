import pytest

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.solana_token import SolanaTokenLaunch
from app.models.user import Chain, User
from app.services import blockchain, token_pages
from app.services.candy_machine import CandyMachineServiceError

MINT = "46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr"
TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3"


@pytest.fixture
def records(app):
    with app.app_context():
        user = User(wallet_address="3AfZ9DaHYVoPj8dNXk1HckcoLyCrcKPHKL193HhDYtib", chain=Chain.SOLANA)
        _db.session.add(user)
        _db.session.flush()
        _db.session.add(
            SolanaTokenLaunch(
                user_id=user.id, network="solana_devnet", mint_address=MINT, transaction_signature="4" * 88,
                creator_wallet=user.wallet_address, name="Pooled", symbol="POOL", decimals=6, supply_raw="1",
                mint_authority_revoked=True, freeze_authority_revoked=True, metadata_locked=True,
            )
        )
        _db.session.add(
            ContractDeployment(
                user_id=user.id, template_id="erc721_basic", template_name="NFT", contract_type="erc721",
                network="sepolia", contract_address="0x2222222222222222222222222222222222222222",
                transaction_hash="0xnft", deployer_address="0x1", parameters={},
            )
        )
        _db.session.add(
            ContractDeployment(
                user_id=user.id, template_id="erc20_basic", template_name="Basic ERC-20 Token", contract_type="erc20",
                network="sepolia", contract_address=TOKEN, transaction_hash="0xtok", deployer_address="0x1", parameters={},
            )
        )
        _db.session.commit()
        yield


def _mint_info(monkeypatch, **overrides):
    info = {"status": "success", "decimals": 6, "supply": "1000000000000", "mint_authority": None, "freeze_authority": "Frz1", **overrides}
    monkeypatch.setattr(blockchain, "get_solana_mint_info", lambda network, mint: info)


def test_solana_page_reads_the_mint_and_pool_from_chain(client, records, monkeypatch):
    _mint_info(monkeypatch)
    calls = []

    def sidecar(method, path, *, params=None, json=None, timeout):
        calls.append(params)
        return {
            "poolId": "Pool1",
            "pool": {"tokenReserve": "100", "solReserve": "5", "lpSupply": "1000", "lpMint": "Lp1", "lpDecimals": 9, "openTime": 0},
            "lockedLp": "400",
        }

    monkeypatch.setattr(token_pages, "_sidecar_request", sidecar)
    response = client.get(f"/api/token-pages/solana/{MINT}")
    assert response.status_code == 200
    body = response.get_json()
    assert (body["symbol"], body["total_supply"], body["mint_authority_revoked"], body["freeze_authority_revoked"]) == (
        "POOL", "1000000000000", True, False,
    )
    assert body["pool"] == {
        "dex": "Raydium", "pair": "Pool1", "token_reserve": "100", "native_reserve": "5", "lp_supply": "1000", "permanently_locked_lp": "400",
    }
    # No owner — the page never asks about anyone's wallet.
    assert calls == [{"network": "devnet", "mint": MINT}]


def test_solana_page_survives_the_sidecar_being_down(client, records, monkeypatch):
    _mint_info(monkeypatch)

    def down(*args, **kwargs):
        raise CandyMachineServiceError("connection refused to http://internal:4000")

    monkeypatch.setattr(token_pages, "_sidecar_request", down)
    body = client.get(f"/api/token-pages/solana/{MINT}").get_json()
    assert body["pool"] is None
    assert body["symbol"] == "POOL"


def test_chain_failures_dont_leak_details(client, records, monkeypatch):
    _mint_info(monkeypatch, status="error")
    response = client.get(f"/api/token-pages/solana/{MINT}")
    assert response.status_code == 502
    assert "status" not in response.get_json()["error"]

    def broken(network):
        raise RuntimeError("HTTPConnectionPool(host='10.0.0.5', port=8545): secret-rpc-key")

    monkeypatch.setattr(blockchain, "get_web3", broken)
    response = client.get(f"/api/token-pages/evm/sepolia/{TOKEN.lower()}")
    assert response.status_code == 502
    assert "10.0.0.5" not in response.get_json()["error"] and "secret" not in response.get_json()["error"]


@pytest.mark.parametrize(
    "path",
    [
        "/api/token-pages/solana/Unknown1111111111111111111111111111111111",
        # Only ERC-20s have token pages — not an NFT collection.
        "/api/token-pages/evm/sepolia/0x2222222222222222222222222222222222222222",
        # Right address, wrong network.
        f"/api/token-pages/evm/polygon/{TOKEN}",
        f"/api/token-pages/evm/mars/{TOKEN}",
    ],
)
def test_only_tokens_launched_here_have_pages(client, records, path):
    assert client.get(path).status_code == 404
