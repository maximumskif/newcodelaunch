from types import SimpleNamespace

import pytest
from web3 import Web3

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.services import blockchain, curve_market, holder_snapshot

CURVE = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
OTHER = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
A = Web3.to_checksum_address("0x00000000000000000000000000000000000000aa")
B = Web3.to_checksum_address("0x00000000000000000000000000000000000000bb")
PAIR = Web3.to_checksum_address("0x00000000000000000000000000000000000000cc")


@pytest.fixture(autouse=True)
def _fresh_cache():
    holder_snapshot._cache.clear()


@pytest.fixture
def curves(app):
    with app.app_context():
        for address, tx, symbol in ((CURVE, "0xdeploy", "MCAT"), (OTHER, "0xother", "DOGE")):
            _db.session.add(
                ContractDeployment(
                    user_id="u", template_id="curve_token", template_name="Bonding-Curve Token", contract_type="curve",
                    network="sepolia", contract_address=address, transaction_hash=tx, deployer_address=A,
                    parameters={"TOKEN_NAME": f"{symbol} coin", "TOKEN_SYMBOL": symbol, "GRADUATION_TARGET": "4000000000000000000"},
                )
            )
        _db.session.add(
            ContractDeployment(
                user_id="u", template_id="erc20_basic", template_name="Basic", contract_type="erc20",
                network="sepolia", contract_address=B, transaction_hash="0xbasic", deployer_address=A, parameters={},
            )
        )
        _db.session.commit()
        yield


def _topic(address):
    return bytes(12) + bytes.fromhex(address[2:])


def _data(*words):
    return b"".join(w.to_bytes(32, "big") for w in words)


def _log(block, topic0, who, *words, tx="0x01"):
    return {"blockNumber": block, "transactionHash": bytes.fromhex(tx[2:].rjust(64, "0")), "topics": [bytes.fromhex(topic0[2:]), _topic(who)], "data": _data(*words)}


class _Chain:
    """A curve deployed in block 100: A buys at 110, B buys at 120, A sells at 130, B buys it out at 140."""

    def __init__(self):
        self.eth = self
        self.block_number = 200
        self.blocks_read = []
        self.logs = [
            _log(110, curve_market.BUY_TOPIC, A, 10, 1, 1000, 10, 1000, tx="0x0a"),
            _log(120, curve_market.BUY_TOPIC, B, 20, 1, 1500, 30, 2500, tx="0x0b"),
            _log(130, curve_market.SELL_TOPIC, A, 500, 6, 1, 23, 2000, tx="0x0c"),
            _log(140, curve_market.BUY_TOPIC, B, 30, 1, 6000, 53, 8000, tx="0x0d"),
            _log(140, curve_market.GRADUATED_TOPIC, PAIR, 54, 2000, tx="0x0d"),
        ]

    def get_transaction_receipt(self, tx_hash):
        return {"blockNumber": 100}

    def get_logs(self, query):
        assert query["topics"] == [[
            curve_market.BUY_TOPIC, curve_market.SELL_TOPIC, curve_market.LEGACY_BUY_TOPIC, curve_market.LEGACY_SELL_TOPIC, curve_market.GRADUATED_TOPIC,
        ]]
        return [log for log in self.logs if query["fromBlock"] <= log["blockNumber"] <= query["toBlock"]]

    def get_block(self, number):
        self.blocks_read.append(number)
        return {"timestamp": 1_800_000_000 + number}


def test_trades_come_from_the_curves_own_events_newest_first(app, curves, monkeypatch):
    chain = _Chain()
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        result = curve_market.curve_trades("sepolia", CURVE.lower())

    assert result["trade_count"] == 4
    assert [(t["kind"], t["wallet"], t["eth"], t["tokens"]) for t in result["trades"]] == [
        ("buy", B, "30", "6000"), ("sell", A, "6", "500"), ("buy", B, "20", "1500"), ("buy", A, "10", "1000"),
    ]
    assert result["trades"][1]["eth_reserve"] == "23" and result["trades"][1]["tokens_sold"] == "2000"
    assert [t["fee"] for t in result["trades"]] == ["1", "1", "1", "1"]
    assert result["trades"][0]["time"] == 1_800_000_140 and result["trades"][0]["tx"].endswith("0d")
    assert result["graduated"]["pair"] == PAIR and result["graduated"]["eth"] == "54"
    assert sorted(set(chain.blocks_read)) == [110, 120, 130, 140]  # one timestamp read per block
    assert result["explorer_tx"] == "https://sepolia.etherscan.io/tx/"


def test_curves_launched_before_the_fee_still_list_their_trades(app, curves, monkeypatch):
    chain = _Chain()
    chain.logs = [
        _log(110, curve_market.LEGACY_BUY_TOPIC, A, 10, 1000, 10, 1000),
        _log(120, curve_market.LEGACY_SELL_TOPIC, A, 500, 6, 4, 500),
        _log(130, curve_market.BUY_TOPIC, A, 10, 1000, 10),  # a trade event of the wrong length is skipped
    ]
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        result = curve_market.curve_trades("sepolia", CURVE)
    assert [(t["kind"], t["eth"], t["fee"], t["tokens"], t["eth_reserve"]) for t in result["trades"]] == [
        ("sell", "6", "0", "500", "4"), ("buy", "10", "0", "1000", "10"),
    ]


def test_only_the_latest_trades_are_listed(app, curves, monkeypatch):
    chain = _Chain()
    chain.block_number = 1_000
    chain.logs = [_log(101 + i, curve_market.BUY_TOPIC, A, 1, 0, 1, i + 1, i + 1) for i in range(curve_market.MAX_TRADES + 20)]
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        result = curve_market.curve_trades("sepolia", CURVE)
    assert result["trade_count"] == curve_market.MAX_TRADES + 20
    assert len(result["trades"]) == curve_market.MAX_TRADES
    assert result["trades"][0]["tokens_sold"] == str(curve_market.MAX_TRADES + 20)


def test_trades_only_for_curves_launched_here(app, curves):
    with app.app_context():
        for network, address in (("sepolia", B), ("sepolia", "0x" + "12" * 20), ("mars", CURVE), ("sepolia", "nope")):
            with pytest.raises(curve_market.NotFoundError):
                curve_market.curve_trades(network, address)


def test_launches_feed_newest_first_and_survives_a_network_being_down(app, curves, monkeypatch):
    answers = {CURVE: (False, 10**18), OTHER: (True, 4 * 10**18)}

    def contract(address, abi):
        graduated, reserve = answers[address]
        return SimpleNamespace(functions=SimpleNamespace(graduated=lambda: SimpleNamespace(call=lambda: graduated), ethReserve=lambda: SimpleNamespace(call=lambda: reserve)))

    monkeypatch.setattr(blockchain, "get_web3", lambda network: SimpleNamespace(eth=SimpleNamespace(contract=contract)))
    with app.app_context():
        launches = curve_market.curve_launches()["launches"]
    assert [launch["symbol"] for launch in launches] == ["DOGE", "MCAT"]  # the basic ERC-20 isn't a curve
    assert launches[0]["graduated"] is True and launches[1]["eth_reserve"] == str(10**18)
    assert launches[1]["graduation_target"] == "4000000000000000000"

    holder_snapshot._cache.clear()
    monkeypatch.setattr(blockchain, "get_web3", lambda network: (_ for _ in ()).throw(RuntimeError("rpc down")))
    with app.app_context():
        launches = curve_market.curve_launches()["launches"]
    assert len(launches) == 2 and launches[0]["graduated"] is None


def test_routes_validate_and_hide_rpc_details(client, curves, monkeypatch):
    assert client.get("/api/token-pages/curves?network=mars").status_code == 404
    assert client.get(f"/api/token-pages/evm/sepolia/{B}/trades").status_code == 404

    def broken(network):
        raise RuntimeError("secret-rpc-host exploded")

    monkeypatch.setattr(blockchain, "get_web3", broken)
    response = client.get(f"/api/token-pages/evm/sepolia/{CURVE}/trades")
    assert response.status_code == 502 and "secret-rpc-host" not in response.get_data(as_text=True)


def test_a_new_block_brings_new_trades_at_once(app, curves, monkeypatch):
    # Cached per block: a buyer's own trade (always in a new block) shows on
    # the next refresh instead of after a fixed cache lifetime.
    chain = _Chain()
    chain.logs = chain.logs[:1]
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        assert curve_market.curve_trades("sepolia", CURVE)["trade_count"] == 1
        chain.logs.append(_log(201, curve_market.BUY_TOPIC, B, 20, 1, 1500, 30, 2500))
        assert curve_market.curve_trades("sepolia", CURVE)["trade_count"] == 1  # same block: cached
        chain.block_number = 201
        assert curve_market.curve_trades("sepolia", CURVE)["trade_count"] == 2


def test_fees_owed_lists_curves_holding_fees_and_skips_the_rest(app, curves, monkeypatch):
    owed = {CURVE: 3 * 10**15, OTHER: 0}

    class _Fees:
        def __init__(self, address):
            self.functions = SimpleNamespace(feesOwed=lambda: SimpleNamespace(call=lambda: owed[address]))

    chain = SimpleNamespace(eth=SimpleNamespace(contract=lambda address, abi: _Fees(address)))
    monkeypatch.setattr(blockchain, "get_web3", lambda network: chain)
    with app.app_context():
        assert curve_market.fees_owed() == [{"network": "sepolia", "address": CURVE, "symbol": "MCAT", "fees_owed": 3 * 10**15}]
        result = app.test_cli_runner().invoke(args=["curve-fees"])
    assert "MCAT" in result.output and "total on sepolia: 0.003" in result.output

    # A curve from before the fee has no feesOwed(): left out, not an error.
    def legacy(address, abi):
        raise ValueError("execution reverted")

    chain.eth.contract = legacy
    with app.app_context():
        assert curve_market.fees_owed() == []
        assert "No curve holds any fees." in app.test_cli_runner().invoke(args=["curve-fees"]).output
