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

from typing import Any, Optional

from ..extensions import db
from ..models.deployment import ContractDeployment
from ..models.nft import NFTCollection
from ..models.project import Project, ProjectStatus, ProjectType

_UPDATABLE_FIELDS = {"name", "draft_data", "network", "status"}


class NotFoundError(ValueError):
    pass


class ValidationError(ValueError):
    pass


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
        setattr(project, key, value)
    db.session.commit()
    return project


def delete_project(project: Project) -> None:
    db.session.delete(project)
    db.session.commit()


def link_deployment(project: Project, deployment: ContractDeployment) -> Project:
    project.contract_deployment_id = deployment.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project


def link_nft_collection(project: Project, collection: NFTCollection) -> Project:
    project.nft_collection_id = collection.id
    project.status = ProjectStatus.ACTIVE
    db.session.commit()
    return project
