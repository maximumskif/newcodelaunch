import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.solana_token import SolanaTokenLaunch
from app.models.user import Chain, User, WalletIdentity
from app.services import solana_pools

CREATOR = "3AfZ9DaHYVoPj8dNXk1HckcoLyCrcKPHKL193HhDYtib"
LINKED = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
STRANGER = "So11111111111111111111111111111111111111112"
MINT = "46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr"
POOL = "DHCaQbgU4jhiv9o9GRTNWbUHBeGAVhBu8SNpR2R94Mdt"
SIG = "5" * 88


@pytest.fixture
def setup(app):
    with app.app_context():
        user = User(wallet_address=CREATOR, chain=Chain.SOLANA)
        _db.session.add(user)
        _db.session.flush()
        _db.session.add(WalletIdentity(user_id=user.id, wallet_address=CREATOR, chain=Chain.SOLANA))
        launch = SolanaTokenLaunch(
            user_id=user.id, network="solana_devnet", mint_address=MINT, transaction_signature="4" * 88,
            creator_wallet=CREATOR, name="T", symbol="T", decimals=6, supply_raw="1000000000000",
            mint_authority_revoked=True, freeze_authority_revoked=True,
        )
        _db.session.add(launch)
        _db.session.commit()
        yield {
            "user_id": user.id,
            "launch_id": launch.id,
            "headers": {"Authorization": f"Bearer {create_access_token(identity=user.id)}"},
        }


class _Sidecar:
    """Records calls to the sidecar and answers them."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, method, path, *, json=None, params=None, timeout):
        self.calls.append({"method": method, "path": path, "json": json, "params": params})
        for prefix, answer in self.answers.items():
            if path.startswith(prefix):
                return answer
        raise AssertionError(f"unexpected sidecar call: {path}")


def _facts(**overrides):
    return {
        "status": "success", "feePayer": CREATOR, "cpmmInvoked": True, "poolId": POOL,
        "tokenDelta": "10000000000", "solDelta": "100000000", "poolCreated": False, **overrides,
    }


def _sidecar(monkeypatch, answers):
    fake = _Sidecar(answers)
    monkeypatch.setattr(solana_pools, "_sidecar_request", fake)
    return fake


def test_pool_state_comes_from_the_chain_with_the_history(client, setup, monkeypatch):
    fake = _sidecar(monkeypatch, {"/internal/raydium/pool": {"poolId": POOL, "pool": None, "ownerLp": None}})
    body = client.get(f"/api/solana-tokens/{setup['launch_id']}/pool?owner={CREATOR}", headers=setup["headers"]).get_json()
    assert body == {"poolId": POOL, "pool": None, "ownerLp": None, "history": []}
    assert fake.calls[0]["params"] == {"network": "devnet", "mint": MINT, "owner": CREATOR}


@pytest.mark.parametrize(
    "request_body, path, sent",
    [
        ({"action": "create", "token_amount": "100", "sol_amount": "5"}, "/internal/raydium/pool/prepare-create", {"tokenAmount": "100", "solAmount": "5"}),
        ({"action": "deposit", "token_amount": "100"}, "/internal/raydium/pool/prepare-deposit", {"tokenAmount": "100"}),
        ({"action": "withdraw", "lp_amount": "7"}, "/internal/raydium/pool/prepare-withdraw", {"lpAmount": "7"}),
    ],
)
def test_prepare_passes_only_validated_fields(client, setup, monkeypatch, request_body, path, sent):
    fake = _sidecar(monkeypatch, {path: {"transaction": "dHg="}})
    response = client.post(
        f"/api/solana-tokens/{setup['launch_id']}/pool/prepare", json={**request_body, "owner": CREATOR}, headers=setup["headers"]
    )
    assert response.status_code == 200, response.get_json()
    assert fake.calls[0]["path"] == path
    # The mint and network always come from the launch, never the request.
    assert fake.calls[0]["json"] == {"network": "devnet", "owner": CREATOR, "mint": MINT, **sent}


@pytest.mark.parametrize(
    "request_body, message",
    [
        ({"action": "swap", "owner": CREATOR}, "action must be"),
        ({"action": "deposit", "owner": STRANGER, "token_amount": "1"}, "this account's Solana wallets"),
        ({"action": "deposit", "owner": CREATOR, "token_amount": "1.5"}, "token_amount"),
        ({"action": "deposit", "owner": CREATOR, "token_amount": "0"}, "token_amount"),
        ({"action": "create", "owner": CREATOR, "token_amount": "1"}, "sol_amount"),
        ({"action": "withdraw", "owner": CREATOR, "lp_amount": str(1 << 64)}, "lp_amount"),
    ],
)
def test_prepare_refuses_bad_requests_before_the_sidecar(client, setup, monkeypatch, request_body, message):
    fake = _sidecar(monkeypatch, {})
    response = client.post(f"/api/solana-tokens/{setup['launch_id']}/pool/prepare", json=request_body, headers=setup["headers"])
    assert response.status_code == 422
    assert message in response.get_json()["error"]
    assert fake.calls == []


@pytest.mark.parametrize(
    "facts, kind, amounts",
    [
        (_facts(poolCreated=True), "create", ("10000000000", "100000000")),
        (_facts(), "deposit", ("10000000000", "100000000")),
        (_facts(tokenDelta="-5", solDelta="-3"), "withdraw", ("5", "3")),
    ],
)
def test_records_what_the_pool_vaults_did(client, setup, monkeypatch, facts, kind, amounts):
    _sidecar(monkeypatch, {"/internal/raydium/transaction/": facts, "/internal/raydium/pool": {"pool": None}})
    url = f"/api/solana-tokens/{setup['launch_id']}/pool/record"
    response = client.post(url, json={"signature": SIG}, headers=setup["headers"])
    assert response.status_code == 201, response.get_json()
    action = response.get_json()["action"]
    assert (action["kind"], action["token_amount"], action["sol_amount"], action["pool_id"]) == (kind, *amounts, POOL)
    # Idempotent, and listed with the pool.
    assert client.post(url, json={"signature": SIG}, headers=setup["headers"]).get_json()["action"]["id"] == action["id"]
    history = client.get(f"/api/solana-tokens/{setup['launch_id']}/pool", headers=setup["headers"]).get_json()["history"]
    assert [h["id"] for h in history] == [action["id"]]


def test_a_linked_wallet_counts(app, client, setup, monkeypatch):
    _db.session.add(WalletIdentity(user_id=setup["user_id"], wallet_address=LINKED, chain=Chain.SOLANA))
    _db.session.commit()
    _sidecar(monkeypatch, {"/internal/raydium/transaction/": _facts(feePayer=LINKED)})
    response = client.post(f"/api/solana-tokens/{setup['launch_id']}/pool/record", json={"signature": SIG}, headers=setup["headers"])
    assert response.status_code == 201


@pytest.mark.parametrize(
    "facts, message",
    [
        ({"status": "not_found"}, "not a confirmed success"),
        (_facts(status="failed"), "not a confirmed success"),
        (_facts(feePayer=STRANGER), "wallet on this account"),
        (_facts(cpmmInvoked=False), "pool program"),
        # A swap: one side in, the other out.
        (_facts(tokenDelta="-100", solDelta="5"), "didn't add liquidity"),
        # Nothing happened to this token's pool (e.g. another pool's deposit).
        (_facts(tokenDelta="0", solDelta="0"), "didn't add liquidity"),
    ],
)
def test_refuses_what_the_chain_doesnt_back(client, setup, monkeypatch, facts, message):
    _sidecar(monkeypatch, {"/internal/raydium/transaction/": facts})
    response = client.post(f"/api/solana-tokens/{setup['launch_id']}/pool/record", json={"signature": SIG}, headers=setup["headers"])
    assert response.status_code == 422
    assert message in response.get_json()["error"]


def test_signature_is_checked_before_it_reaches_a_url(client, setup, monkeypatch):
    fake = _sidecar(monkeypatch, {})
    for bad in ["../../internal/ping", "", 5, "0" * 88]:
        response = client.post(f"/api/solana-tokens/{setup['launch_id']}/pool/record", json={"signature": bad}, headers=setup["headers"])
        assert response.status_code == 422
    assert fake.calls == []


def test_owner_only(app, client, setup, monkeypatch):
    _sidecar(monkeypatch, {"/internal/raydium/": {}})
    other = User(wallet_address=STRANGER, chain=Chain.SOLANA)
    _db.session.add(other)
    _db.session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(identity=other.id)}"}
    base = f"/api/solana-tokens/{setup['launch_id']}/pool"
    assert client.get(base, headers=headers).status_code == 404
    assert client.post(f"{base}/prepare", json={"action": "deposit"}, headers=headers).status_code == 404
    assert client.post(f"{base}/record", json={"signature": SIG}, headers=headers).status_code == 404
    assert client.get(base).status_code == 401
