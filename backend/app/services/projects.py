"""
CRUD for the `Project` wrapper entity introduced in Phase 3.

A project does not duplicate what the token/contract/NFT flows already
persist — it's a lightweight, resumable pointer created up front (name,
type, chain/network, draft form state) that gets linked to the real
`ContractDeployment` or `NFTCollection` once one actually exists. Linking a
project is deliberately best-effort from the caller's side (see the
contracts/nft routes) — a broken or stale project_id must never block
recording a deployment or creating a collection that already succeeded.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ..extensions import db
from ..models.candy_machine import CandyMachineDeployment
from ..models.deployment import ContractDeployment
from ..models.nft import NFTCollection
from ..models.project import Project, ProjectStatus, ProjectType
from ..models.solana_token import SolanaTokenLaunch
from ..models.user import Chain
from . import blockchain

_UPDATABLE_FIELDS = {"name", "draft_data", "network", "status"}


class NotFoundError(ValueError):
    pass


class ValidationError(ValueError):
    pass


def _validate_network(chain: str, network: Optional[str]) -> None:
    """A project's network must belong to its chain — e.g. a Solana token
    project can't be saved with an EVM network by an autosave. Both used to
    be accepted as any string."""
    if network is None:
        return
    networks = blockchain.EVM_NETWORKS if chain == Chain.EVM else blockchain.SOLANA_NETWORKS
    if network not in networks:
        raise ValidationError(f"network must be one of: {', '.join(networks)} for a {chain} project")


def create_project(
    user_id: str,
    name: str,
    project_type: str,
    chain: str,
    network: Optional[str] = None,
    draft_data: Optional[dict[str, Any]] = None,
) -> Project:
    if project_type not in ProjectType.ALL:
        raise ValidationError(f"Unknown project_type: {project_type}")
    if chain not in Chain.ALL:
        raise ValidationError(f"chain must be one of: {', '.join(Chain.ALL)}")
    _validate_network(chain, network)

    project = Project(
        user_id=user_id,
        name=name,
        project_type=project_type,
        chain=chain,
        network=network,
        draft_data=draft_data or {},
    )
    db.session.add(project)
    db.session.commit()
    return project


def get_user_projects(user_id: str, status: Optional[str] = None) -> list[Project]:
    query = Project.query.filter_by(user_id=user_id)
    if status:
        query = query.filter_by(status=status)
    return query.order_by(Project.updated_at.desc()).all()


def get_owned_project(project_id: str, user_id: str) -> Project:
    project = Project.query.filter_by(id=project_id, user_id=user_id).first()
    if project is None:
        raise NotFoundError(f"Project not found: {project_id}")
    return project


def update_project(project: Project, **fields: Any) -> Project:
    for key, value in fields.items():
        if key not in _UPDATABLE_FIELDS or value is None:
            continue
        if key == "status" and value not in ProjectStatus.ALL:
            raise ValidationError(f"Unknown status: {value}")
        if key == "network":
            _validate_network(project.chain, value)
        setattr(project, key, value)
    db.session.commit()
    return project


def delete_project(project: Project) -> None:
    db.session.delete(project)
    db.session.commit()


def link_deployment(project: Project, deployment: ContractDeployment) -> Project:
    # First link wins — a project represents one deploy target. Without this
    # guard, deploying a second time from the same resumed project (nothing
    # stops that; the Deploy button re-enables after a successful deploy)
    # would silently repoint the project at the new deployment and orphan
    # the first one with no way to recover the link via the UI.
    if project.contract_deployment_id and project.contract_deployment_id != deployment.id:
        return project
    project.contract_deployment_id = deployment.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project


def link_nft_collection(project: Project, collection: NFTCollection) -> Project:
    if project.nft_collection_id and project.nft_collection_id != collection.id:
        return project
    project.nft_collection_id = collection.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project


def link_candy_machine(project: Project, deployment: CandyMachineDeployment) -> Project:
    if project.candy_machine_deployment_id and project.candy_machine_deployment_id != deployment.id:
        return project
    project.candy_machine_deployment_id = deployment.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project


def link_solana_token(project: Project, launch: SolanaTokenLaunch) -> Project:
    # Same first-link-wins rule as the other link_* helpers.
    if project.solana_token_launch_id and project.solana_token_launch_id != launch.id:
        return project
    project.solana_token_launch_id = launch.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project


def link_if_owned(project_id: str, user_id: str, link_fn: Callable[[Project], Project]) -> None:
    """Best-effort project link shared by the contracts/nft create routes —
    swallows NotFoundError so a stale/foreign project_id never blocks
    recording a deployment or collection that already succeeded."""
    try:
        project = get_owned_project(project_id, user_id)
    except NotFoundError:
        return
    link_fn(project)
