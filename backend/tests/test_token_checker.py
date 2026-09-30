import pytest

from app.services import blockchain, market_intelligence, token_checker

TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
PROXY_IMPL = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
ZERO = "0x0000000000000000000000000000000000000000"
MINT = "46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr"


class _Call:
    def __init__(self, value):
        self.value = value

    def call(self):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


class _Token:
    def __init__(self, answers):
        self.functions = self
        self.answers = answers

    def __getattr__(self, name):
        return lambda *args: _Call(self.answers.get(name, ValueError("execution reverted")))


class _W3:
    def __init__(self, code=b"\x60\x80", answers=None):
        self.eth = self
        self.code = code
        self.answers = answers or {}

    def get_code(self, address):
        return self.code

    def contract(self, address, abi):
        return _Token(self.answers)


ERC20 = {"name": "Nova", "symbol": "NOVA", "decimals": 18, "totalSupply": 10**27}
POOL = [{"chain": "ethereum", "dex": "uniswap", "pair_address": "0xp", "url": "u", "price_usd": 1.0, "liquidity_usd": 50000.0, "volume_24h": 1.0, "base_token": {"name": "Nova", "symbol": "NOVA", "address": TOKEN}}]


def _by_id(result):
    return {check["id"]: check for check in result["checks"]}


def test_evm_token_with_renounced_owner_and_verified_code(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_web3", lambda network: _W3(answers={**ERC20, "owner": ZERO}))
        monkeypatch.setattr(token_checker, "_verified_source", lambda n, a: {"verified": True, "contract_name": "Nova", "proxy": False, "implementation": None, "function_names": ["transfer", "setBuyFee", "mint"]})
        monkeypatch.setattr(market_intelligence, "lookup_token", lambda a: POOL)

        result = token_checker.check_evm("ethereum", TOKEN)

        checks = _by_id(result)
        assert (result["name"], result["symbol"], result["total_supply"]) == ("Nova", "NOVA", str(10**27))
        assert checks["owner"]["ok"] is True
        assert checks["source"]["ok"] is True and checks["proxy"]["ok"] is True
        # Powers exist in the code, but a renounced owner can't use them.
        assert checks["powers"]["ok"] is True and result["powers"] == ["mint new tokens", "change buy/sell fees"]
        assert checks["liquidity"]["ok"] is True and "$50,000" in checks["liquidity"]["label"]
        assert result["launched_here"] is None


def test_evm_proxy_reads_the_implementations_functions(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_web3", lambda network: _W3(answers={**ERC20, "owner": "0x00000000000000000000000000000000000000Aa"}))
        sources = {
            TOKEN: {"verified": True, "contract_name": "Proxy", "proxy": True, "implementation": PROXY_IMPL, "function_names": ["upgradeTo"]},
            PROXY_IMPL: {"verified": True, "contract_name": "Impl", "proxy": False, "implementation": None, "function_names": ["mint", "blacklist", "pause"]},
        }
        monkeypatch.setattr(token_checker, "_verified_source", lambda n, a: sources[a])
        monkeypatch.setattr(market_intelligence, "lookup_token", lambda a: [])

        checks = _by_id(token_checker.check_evm("ethereum", TOKEN))

        assert checks["owner"]["ok"] is False and checks["proxy"]["ok"] is False
        assert checks["powers"]["ok"] is False
        assert "mint new tokens, block wallets from trading, pause transfers" in checks["powers"]["label"]
        assert checks["liquidity"]["ok"] is False


def test_evm_refuses_what_isnt_an_erc20(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_web3", lambda network: _W3(code=b""))
        with pytest.raises(token_checker.CheckError, match="No contract"):
            token_checker.check_evm("sepolia", TOKEN)
        monkeypatch.setattr(blockchain, "get_web3", lambda network: _W3(answers={}))
        with pytest.raises(token_checker.CheckError, match="ERC-20"):
            token_checker.check_evm("sepolia", TOKEN)
        with pytest.raises(token_checker.CheckError, match="EVM address"):
            token_checker.check_evm("sepolia", "0x123")


def test_solana_token_with_authorities_and_concentrated_holders(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_solana_mint_info", lambda n, m: {"status": "success", "decimals": 6, "supply": "1000", "mint_authority": "Auth1", "freeze_authority": None})
        monkeypatch.setattr(blockchain, "get_solana_largest_accounts", lambda n, m: {"status": "success", "accounts": [{"address": "A", "amount": "600"}, {"address": "B", "amount": "100"}]})
        monkeypatch.setattr(market_intelligence, "lookup_token", lambda a: [{**POOL[0], "chain": "solana", "base_token": {"name": "Pool", "symbol": "POOL", "address": MINT}}])

        result = token_checker.check_solana("solana", MINT)

        checks = _by_id(result)
        assert checks["mint"]["ok"] is False and "Auth1" in checks["mint"]["detail"]
        assert checks["freeze"]["ok"] is True
        assert checks["holders"]["ok"] is False and checks["holders"]["label"] == "Largest 10 accounts hold 70%"
        assert result["largest_holders"][0] == {"address": "A", "share": 0.6}
        assert (result["name"], result["symbol"]) == ("Pool", "POOL")


def test_solana_rejects_a_non_mint(app, monkeypatch):
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_solana_mint_info", lambda n, m: {"status": "not_a_mint"})
        with pytest.raises(token_checker.CheckError, match="isn't an SPL token mint"):
            token_checker.check_solana("solana", MINT)


def test_the_route_maps_bad_input_and_chain_trouble(client, monkeypatch):
    assert client.get("/api/token-pages/check/sepolia/0x123").status_code == 400

    def broken(network):
        raise ConnectionError("internal-rpc.example with key abc")

    monkeypatch.setattr(blockchain, "get_web3", broken)
    response = client.get(f"/api/token-pages/check/sepolia/{TOKEN}")
    assert response.status_code == 502
    assert "internal-rpc" not in response.get_data(as_text=True)


def test_liquidity_counts_only_this_chain_and_prices_from_base_pools(app, monkeypatch):
    # Both found checking real USDC: a PulseChain copy of the address ranked
    # first ($0.0009), and in XYZ/USDC pools the price is XYZ's, not USDC's.
    with app.app_context():
        monkeypatch.setattr(blockchain, "get_web3", lambda network: _W3(answers={**ERC20, "owner": ZERO}))
        monkeypatch.setattr(token_checker, "_verified_source", lambda n, a: None)
        fork = {**POOL[0], "chain": "pulsechain", "price_usd": 0.0009, "liquidity_usd": 9e6, "token_is_base": True}
        quote_side = {**POOL[0], "price_usd": 2600.0, "liquidity_usd": 8e6, "token_is_base": False}
        monkeypatch.setattr(market_intelligence, "lookup_token", lambda a: [fork, quote_side])

        result = token_checker.check_evm("ethereum", TOKEN)

        assert result["liquidity"]["pools"] == 1 and result["liquidity"]["total_liquidity_usd"] == 8e6
        assert result["liquidity"]["top"]["price_usd"] is None
        assert token_checker.check_evm("sepolia", TOKEN)["liquidity"] is None
