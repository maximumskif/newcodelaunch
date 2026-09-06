from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.project import Project
from app.models.user import Chain, User
from app.services import blockchain


def _make_user(wallet_address: str) -> User:
    user = User(wallet_address=wallet_address, chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _auth_header(user: User) -> dict:
    token = create_access_token(identity=user.id)
    return {"Authorization": f"Bearer {token}"}


def _make_deployment(user_id: str, transaction_hash: str) -> ContractDeployment:
    deployment = ContractDeployment(
        user_id=user_id,
        template_id="erc20_basic",
        template_name="Basic ERC-20 Token",
        contract_type="erc20",
        network="sepolia",
        contract_address=f"0xContract-{transaction_hash}",
        transaction_hash=transaction_hash,
        deployer_address="0xDeployer",
        parameters={},
    )
    _db.session.add(deployment)
    _db.session.commit()
    return deployment


def test_list_deployments_only_returns_the_authenticated_users_own(app, client):
    with app.app_context():
        user_a = _make_user("0xUserAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        user_b = _make_user("0xUserBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")
        _make_deployment(user_a.id, "0xHashOwnedByA")
        _make_deployment(user_b.id, "0xHashOwnedByB")

        response = client.get("/api/contracts/deployments", headers=_auth_header(user_b))

        assert response.status_code == 200
        transaction_hashes = {d["transaction_hash"] for d in response.get_json()["deployments"]}
        assert transaction_hashes == {"0xHashOwnedByB"}


def test_list_deployments_requires_authentication(client):
    response = client.get("/api/contracts/deployments")
    assert response.status_code == 401


def test_create_deployment_with_a_foreign_project_id_does_not_hijack_it(app, client, monkeypatch):
    # Regression coverage for projects.link_if_owned: a caller supplying
    # someone else's project_id must not attach their deployment to it —
    # the on-chain deployment already happened by the time this endpoint is
    # called, so the request must still succeed (best-effort linking), but
    # the foreign project itself must come back unmodified.
    with app.app_context():
        owner = _make_user("0xProjectOwnerAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        attacker = _make_user("0xAttackerBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")

        foreign_project = Project(user_id=owner.id, name="Owner's Project", project_type="contract", chain="evm")
        _db.session.add(foreign_project)
        _db.session.commit()
        foreign_project_id = foreign_project.id

        monkeypatch.setattr(
            blockchain,
            "get_transaction_status",
            lambda network, tx_hash: {"status": "success", "gas_used": 21000, "gas_price": 1_000_000_000},
        )

        response = client.post(
            "/api/contracts/deployments",
            headers=_auth_header(attacker),
            json={
                "template_id": "erc20_basic",
                "network": "sepolia",
                "contract_address": "0xAttackerContract",
                "transaction_hash": "0xAttackerTxHash",
                "deployer_address": "0xAttackerWallet",
                "project_id": foreign_project_id,
            },
        )

        assert response.status_code == 201

        untouched = _db.session.get(Project, foreign_project_id)
        assert untouched.contract_deployment_id is None
        assert untouched.status == "draft"


def test_get_deployment_by_address_is_intentionally_public(app, client):
    # Not a bug: a deployed contract's address is already public on-chain
    # (visible on any block explorer) regardless of what this app does, so
    # this lookup is by the public address rather than an internal owned
    # ID — unlike list_deployments above, there is no per-user data to leak
    # here. See the docstring on get_deployment in
    # app/blueprints/contracts/routes.py.
    with app.app_context():
        owner = _make_user("0xDeploymentOwnerAAAAAAAAAAAAAAAAAAAAAAAAAA")
        deployment = _make_deployment(owner.id, "0xPubliclyKnownTxHash")
        contract_address = deployment.contract_address

    response = client.get(f"/api/contracts/deployments/{contract_address}")

    assert response.status_code == 200
    assert response.get_json()["deployment"]["contract_address"] == contract_address
