from types import SimpleNamespace

import pytest
from solders.pubkey import Pubkey
from web3 import Web3

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.user import Chain, User
from app.services import blockchain, holder_snapshot

TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
A = Web3.to_checksum_address("0x00000000000000000000000000000000000000aa")
B = Web3.to_checksum_address("0x00000000000000000000000000000000000000bb")
ZERO = "0x0000000000000000000000000000000000000000"
MINT = "46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr"


@pytest.fixture(autouse=True)
def _fresh_cache():
    holder_snapshot._cache.clear()


@pytest.fixture
def launched(app):
    with app.app_context():
        user = User(wallet_address="0x1111111111111111111111111111111111111111", chain=Chain.EVM)
        _db.session.add(user)
        _db.session.flush()
        _db.session.add(
            ContractDeployment(
                user_id=user.id, template_id="erc20_basic", template_name="Basic ERC-20 Token", contract_type="erc20",
                network="sepolia", contract_address=TOKEN, transaction_hash="0xdeploy", deployer_address=A, parameters={},
            )
        )
        _db.session.commit()
        yield


def _topic(address):
    return bytes(12) + bytes.fromhex(address[2:])


def _log(block, sender, recipient, amount):
    return {"blockNumber": block, "topics": [b"t", _topic(sender), _topic(recipient)], "data": amount.to_bytes(32, "big")}


class _Chain:
    """A token deployed in block 100: 1000 minted to A at 100, A→B 300 at
    5_000, B→A 100 at 90_000. Refuses log ranges wider than `max_range`."""

    def __init__(self, max_range=10**9, latest=100_000):
        self.eth = self
        self.block_number = latest
        self.max_range = max_range
        self.requests = []
        self.logs = [_log(100, ZERO, A, 1000), _log(5_000, A, B, 300), _log(90_000, B, A, 100)]

    def get_transaction_receipt(self, tx_hash):
        assert tx_hash == "0xdeploy"
        return {"blockNumber": 100}

    def get_logs(self, query):
        self.requests.append((query["fromBlock"], query["toBlock"]))
        if query["toBlock"] - query["fromBlock"] + 1 > self.max_range:
            raise ValueError("query returned more than 10000 results / block range too large")
        return [log for log in self.logs if query["fromBlock"] <= log["blockNumber"] <= query["toBlock"]]

    def contract(self, address, abi):
        answers = {"symbol": "NOVA", "decimals": 18, "totalSupply": 1000}
        return SimpleNamespace(functions=SimpleNamespace(**{name: (lambda v=v: SimpleNamespace(call=lambda **kw: v)) for name, v in answers.items()}))


def test_evm_replays_transfers_from_the_deploy_block(app, launched, monkeypatch):
    chain = _Chain()
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        result = holder_snapshot.snapshot_evm("sepolia", TOKEN.lower())

    assert result["holder_count"] == 2 and result["symbol"] == "NOVA"
    assert result["holders"] == [
        {"address": A, "balance": "800", "share": 0.8},
        {"address": B, "balance": "200", "share": 0.2},
    ]
    assert result["as_of"] == {"block": 100_000, "latest": True}
    assert chain.requests[0][0] == 100  # starts at the deploy block, not genesis


def test_evm_snapshot_at_a_past_block_and_shrinking_log_ranges(app, launched, monkeypatch):
    chain = _Chain(max_range=5_000)
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        result = holder_snapshot.snapshot_evm("sepolia", TOKEN, at_block=50_000)
        assert [(h["address"], h["balance"]) for h in result["holders"]] == [(A, "700"), (B, "300")]
        assert result["as_of"] == {"block": 50_000, "latest": False}
        # Refused ranges were split until they fit, and every block was covered once.
        served = [r for r in chain.requests if r[1] - r[0] + 1 <= 5_000]
        assert served[0][0] == 100 and served[-1][1] == 50_000
        assert all(b[0] == a[1] + 1 for a, b in zip(served, served[1:]))

        with pytest.raises(holder_snapshot.SnapshotError, match="didn't exist yet"):
            holder_snapshot.snapshot_evm("sepolia", TOKEN, at_block=50)
        with pytest.raises(holder_snapshot.SnapshotError, match="hasn't happened yet"):
            holder_snapshot.snapshot_evm("sepolia", TOKEN, at_block=200_000)


def test_evm_needs_a_token_launched_here(app, launched):
    with app.app_context():
        with pytest.raises(holder_snapshot.SnapshotError, match="launched here"):
            holder_snapshot.snapshot_evm("ethereum", TOKEN)
        with pytest.raises(holder_snapshot.SnapshotError, match="EVM address"):
            holder_snapshot.snapshot_evm("sepolia", "0x123")


def test_solana_sums_token_accounts_per_owner(app, monkeypatch):
    owner1, owner2 = Pubkey.from_string("3AfZ9DaHYVoPj8dNXk1HckcoLyCrcKPHKL193HhDYtib"), Pubkey.from_string(MINT)
    accounts = [(owner1, 600), (owner2, 300), (owner1, 100), (owner2, 0)]
    seen = {}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get_program_accounts(self, program, **kwargs):
            seen.update(kwargs)
            return SimpleNamespace(value=[SimpleNamespace(account=SimpleNamespace(data=bytes(owner) + amount.to_bytes(8, "little"))) for owner, amount in accounts])

    monkeypatch.setattr(blockchain, "get_solana_mint_info", lambda n, m: {"status": "success", "decimals": 6, "supply": "1000"})
    monkeypatch.setattr(blockchain, "_get_solana_client", lambda network: _Client())
    with app.app_context():
        result = holder_snapshot.snapshot_solana("solana_devnet", MINT)

    assert [(h["address"], h["balance"], h["share"]) for h in result["holders"]] == [(str(owner1), "700", 0.7), (str(owner2), "300", 0.3)]
    assert seen["data_slice"].offset == 32 and seen["data_slice"].length == 40
    assert seen["filters"][0] == 165 and seen["filters"][1].bytes == MINT


def test_route_validates_input_and_hides_rpc_details(client, launched, monkeypatch):
    assert client.get(f"/api/token-pages/holders/sepolia/{TOKEN}?block=abc").status_code == 400
    assert client.get(f"/api/token-pages/holders/solana_devnet/{MINT}?block=5").status_code == 400
    assert client.get(f"/api/token-pages/holders/ethereum/{TOKEN}").status_code == 400

    def broken(network):
        raise ConnectionError("https://secret-rpc.example/key123")

    monkeypatch.setattr(blockchain, "get_web3", broken)
    response = client.get(f"/api/token-pages/holders/sepolia/{TOKEN}")
    assert response.status_code == 502 and "secret-rpc" not in response.get_data(as_text=True)
