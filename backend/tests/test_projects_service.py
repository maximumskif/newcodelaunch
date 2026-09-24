import pytest

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.user import Chain, User
from app.services import projects


def _make_user():
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _make_deployment(user_id, contract_address):
    deployment = ContractDeployment(
        user_id=user_id,
        template_id="erc20_basic",
        template_name="Basic ERC-20 Token",
        contract_type="erc20",
        network="sepolia",
        contract_address=contract_address,
        transaction_hash=f"0xhash-{contract_address}",
        deployer_address="0xdeployer",
        parameters={},
    )
    _db.session.add(deployment)
    _db.session.commit()
    return deployment


def test_create_project_rejects_unknown_type(app):
    with app.app_context():
        user = _make_user()
        with pytest.raises(projects.ValidationError):
            projects.create_project(user.id, "My Project", "not_a_real_type", "evm")


def test_get_owned_project_scopes_to_the_owning_user(app):
    with app.app_context():
        owner = _make_user()
        other = User(wallet_address="0xdef0000000000000000000000000000000000b", chain=Chain.EVM)
        _db.session.add(other)
        _db.session.commit()

        project = projects.create_project(owner.id, "My Project", projects.ProjectType.TOKEN, "evm")

        assert projects.get_owned_project(project.id, owner.id).id == project.id
        with pytest.raises(projects.NotFoundError):
            projects.get_owned_project(project.id, other.id)


def test_link_deployment_first_link_wins(app):
    with app.app_context():
        user = _make_user()
        project = projects.create_project(user.id, "My Project", projects.ProjectType.TOKEN, "evm", network="sepolia")
        first = _make_deployment(user.id, "0x1111111111111111111111111111111111111a")
        second = _make_deployment(user.id, "0x2222222222222222222222222222222222222b")

        projects.link_deployment(project, first)
        assert project.contract_deployment_id == first.id
        assert project.status == projects.ProjectStatus.ACTIVE

        # Regression test: this used to silently overwrite the link on a
        # second deploy from the same project (nothing stops the Deploy
        # button being clicked twice), orphaning the first deployment with
        # no way to recover it via the UI.
        projects.link_deployment(project, second)
        assert project.contract_deployment_id == first.id


def test_link_deployment_is_idempotent_for_the_same_deployment(app):
    with app.app_context():
        user = _make_user()
        project = projects.create_project(user.id, "My Project", projects.ProjectType.TOKEN, "evm")
        deployment = _make_deployment(user.id, "0x3333333333333333333333333333333333333c")

        projects.link_deployment(project, deployment)
        projects.link_deployment(project, deployment)
        assert project.contract_deployment_id == deployment.id


def test_link_if_owned_swallows_not_found_without_raising(app):
    with app.app_context():
        user = _make_user()
        deployment = _make_deployment(user.id, "0x4444444444444444444444444444444444444d")
        # Should not raise even though this project_id doesn't exist — a
        # stale/foreign project_id must never block recording a deployment
        # that already succeeded on-chain.
        projects.link_if_owned("nonexistent-project-id", user.id, lambda p: projects.link_deployment(p, deployment))


def test_a_token_project_can_be_on_solana_with_a_solana_network(app):
    user = User(wallet_address="SoLProj1111111111111111111111111111111111111", chain=Chain.SOLANA)
    _db.session.add(user)
    _db.session.commit()
    project = projects.create_project(user.id, "SPL", "token", "solana", network="solana_devnet")
    assert (project.chain, project.network) == ("solana", "solana_devnet")


@pytest.mark.parametrize(
    "chain, network, message",
    [
        ("bitcoin", None, "chain must be one of"),
        ("evm", "solana_devnet", "network must be one of"),
        ("solana", "sepolia", "network must be one of"),
    ],
)
def test_create_rejects_a_chain_network_mismatch(app, chain, network, message):
    user = User(wallet_address="0xabc0000000000000000000000000000000000c", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    with pytest.raises(projects.ValidationError, match=message):
        projects.create_project(user.id, "P", "token", chain, network=network)


def test_update_keeps_the_network_on_the_projects_chain(app):
    user = User(wallet_address="0xabc0000000000000000000000000000000000d", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    project = projects.create_project(user.id, "P", "token", "solana", network="solana_devnet")
    projects.update_project(project, network="solana")
    assert project.network == "solana"
    with pytest.raises(projects.ValidationError, match="network must be one of"):
        projects.update_project(project, network="sepolia")
