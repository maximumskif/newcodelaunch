import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProjectType:
    TOKEN = "token"
    NFT_COLLECTION = "nft_collection"
    CONTRACT = "contract"

    ALL = (TOKEN, NFT_COLLECTION, CONTRACT)


class ProjectStatus:
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"

    ALL = (DRAFT, ACTIVE, ARCHIVED)


class Project(db.Model):
    __tablename__ = "projects"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    name = db.Column(db.String(128), nullable=False)
    project_type = db.Column(db.String(32), nullable=False)
    chain = db.Column(db.String(16), nullable=False)
    network = db.Column(db.String(32), nullable=True)
    status = db.Column(db.String(16), nullable=False, default=ProjectStatus.DRAFT)

    # Resumable in-progress form state for the step the user is on (e.g. the
    # last-selected contract template + parameter values). Not a copy of data
    # that already lives in a real record — once a deployment/collection is
    # linked below, that record is the source of truth, not this blob.
    draft_data = db.Column(db.JSON, nullable=False, default=dict)

    contract_deployment_id = db.Column(
        db.String(36), db.ForeignKey("contract_deployments.id"), nullable=True
    )
    nft_collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    contract_deployment = db.relationship("ContractDeployment")
    nft_collection = db.relationship("NFTCollection")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "project_type": self.project_type,
            "chain": self.chain,
            "network": self.network,
            "status": self.status,
            "draft_data": self.draft_data,
            "contract_deployment": self.contract_deployment.to_dict() if self.contract_deployment else None,
            "nft_collection": self.nft_collection.to_dict() if self.nft_collection else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
