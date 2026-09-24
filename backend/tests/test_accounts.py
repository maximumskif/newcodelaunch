import base58
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from flask_jwt_extended import create_access_token
from nacl.signing import SigningKey

from app.extensions import db as _db
from app.models.nft import NFTCollection
from app.models.project import Project
from app.models.user import User, WalletIdentity
from app.services import accounts


class EvmWallet:
    def __init__(self):
        self.account = Account.create()
        self.address = self.account.address.lower()
        self.chain = "evm"

    def sign(self, message: str) -> str:
        return "0x" + self.account.sign_message(encode_defunct(text=message)).signature.hex().removeprefix("0x")


class SolanaWallet:
    def __init__(self):
        self.key = SigningKey.generate()
        self.address = base58.b58encode(bytes(self.key.verify_key)).decode()
        self.chain = "solana"

    def sign(self, message: str) -> str:
        return base58.b58encode(self.key.sign(message.encode()).signature).decode()


def _proof(client, wallet):
    nonce = client.post("/api/auth/nonce", json={"wallet_address": wallet.address, "chain": wallet.chain}).get_json()
    return {
        "wallet_address": wallet.address,
        "chain": wallet.chain,
        "nonce": nonce["nonce"],
        "signature": wallet.sign(nonce["message"]),
    }


def _sign_in(client, wallet):
    response = client.post("/api/auth/verify", json=_proof(client, wallet))
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body["user"]


def test_a_linked_wallet_signs_in_to_the_same_account(app, client):
    evm, sol = EvmWallet(), SolanaWallet()
    headers, user = _sign_in(client, evm)
    assert [w["chain"] for w in user["wallets"]] == ["evm"]

    linked = client.post("/api/auth/wallets", headers=headers, json=_proof(client, sol))
    assert linked.status_code == 200
    assert {w["wallet_address"] for w in linked.get_json()["user"]["wallets"]} == {evm.address, sol.address}

    _, via_solana = _sign_in(client, sol)
    assert via_solana["id"] == user["id"]
    # The session wallet is the one that signed in — what the app checks the
    # connected wallet against.
    assert (via_solana["wallet_address"], via_solana["chain"]) == (sol.address, "solana")


def test_linking_a_wallet_with_its_own_account_merges_everything_into_this_one(app, client):
    evm, sol = EvmWallet(), SolanaWallet()
    evm_headers, evm_user = _sign_in(client, evm)
    _, sol_user = _sign_in(client, sol)
    # The Solana account has its own records.
    _db.session.add(Project(user_id=sol_user["id"], name="Solana project", project_type="token", chain="solana"))
    _db.session.add(NFTCollection(user_id=sol_user["id"], name="Solana collection", description="", collection_size=1, image_size=64))
    _db.session.commit()

    response = client.post("/api/auth/wallets", headers=evm_headers, json=_proof(client, sol))

    assert response.status_code == 200
    assert response.get_json()["merged"]["projects"] == 1
    assert response.get_json()["merged"]["nft_collections"] == 1
    assert Project.query.filter_by(name="Solana project").one().user_id == evm_user["id"]
    assert _db.session.get(User, sol_user["id"]) is None
    # And the EVM account's own project list now shows it.
    assert [p["name"] for p in client.get("/api/projects", headers=evm_headers).get_json()["projects"]] == ["Solana project"]


def test_linking_needs_a_valid_signature_from_the_wallet(app, client):
    evm, sol, impostor = EvmWallet(), SolanaWallet(), SolanaWallet()
    headers, _ = _sign_in(client, evm)
    proof = _proof(client, sol)
    proof["signature"] = impostor.sign("anything")
    assert client.post("/api/auth/wallets", headers=headers, json=proof).status_code in (400, 401)
    assert WalletIdentity.query.filter_by(wallet_address=sol.address).count() == 0
    assert client.post("/api/auth/wallets", json=_proof(client, sol)).status_code == 401  # must be signed in


def test_unlink_rules(app, client):
    evm, sol = EvmWallet(), SolanaWallet()
    headers, user = _sign_in(client, evm)

    # The last wallet can't go.
    only = client.delete(f"/api/auth/wallets/evm/{evm.address}", headers=headers)
    assert only.status_code == 422

    client.post("/api/auth/wallets", headers=headers, json=_proof(client, sol))
    # Nor the one this session signed in with.
    session = client.delete(f"/api/auth/wallets/evm/{evm.address}", headers=headers)
    assert session.status_code == 422
    assert "signed in with" in session.get_json()["error"]
    # Another linked wallet can.
    removed = client.delete(f"/api/auth/wallets/solana/{sol.address}", headers=headers)
    assert removed.status_code == 200
    assert [w["chain"] for w in removed.get_json()["user"]["wallets"]] == ["evm"]

    # Unlinked, it starts an account of its own on its next sign-in.
    _, fresh = _sign_in(client, sol)
    assert fresh["id"] != user["id"]


def test_the_account_creating_wallet_can_be_unlinked_and_start_over(app, client):
    # Regression guard for dropping users' unique (wallet, chain): the wallet
    # that created an account, once unlinked, must be able to sign in again
    # without colliding with that account's users row.
    evm, sol = EvmWallet(), SolanaWallet()
    evm_headers, account = _sign_in(client, evm)
    client.post("/api/auth/wallets", headers=evm_headers, json=_proof(client, sol))
    sol_headers, _ = _sign_in(client, sol)
    assert client.delete(f"/api/auth/wallets/evm/{evm.address}", headers=sol_headers).status_code == 200

    _, fresh = _sign_in(client, evm)
    assert fresh["id"] != account["id"]


def test_me_works_for_tokens_issued_before_wallet_claims(app, client):
    evm = EvmWallet()
    _, user = _sign_in(client, evm)
    legacy = {"Authorization": f"Bearer {create_access_token(identity=user['id'])}"}
    me = client.get("/api/auth/me", headers=legacy).get_json()["user"]
    assert (me["wallet_address"], me["chain"]) == (evm.address, "evm")


def test_every_user_owned_table_is_merged(app):
    # A new table with a users.id foreign key that isn't in OWNED_MODELS
    # would be silently left behind (orphaned) by a merge.
    owned = {
        table.name
        for table in _db.metadata.tables.values()
        for fk in table.foreign_keys
        if fk.column.table.name == "users" and table.name != "wallet_identities"
    }
    assert owned == {model.__tablename__ for model in accounts.OWNED_MODELS}
