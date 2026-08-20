import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CandyMachineDeployment(db.Model):
    __tablename__ = "candy_machine_deployments"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    nft_collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=False, index=True)

    network = db.Column(db.String(32), nullable=False)
    collection_mint = db.Column(db.String(64), nullable=False, index=True)
    # unique, not just indexed — record_candy_machine() relies on this to make a
    # client retry after a slow/dropped response idempotent instead of creating a
    # second row for the same on-chain address that _get_deployment_by_address()'s
    # .first() would then pick between non-deterministically.
    candy_machine = db.Column(db.String(64), nullable=False, unique=True, index=True)

    price_sol = db.Column(db.Float, nullable=False)
    items_available = db.Column(db.Integer, nullable=False)
    go_live_date = db.Column(db.DateTime(timezone=True), nullable=False)

    creator_wallet = db.Column(db.String(64), nullable=False)
    transaction_signatures = db.Column(db.JSON, nullable=False, default=list)
    explorer_url = db.Column(db.String(256), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "nft_collection_id": self.nft_collection_id,
            "network": self.network,
            "collection_mint": self.collection_mint,
            "candy_machine": self.candy_machine,
            "price_sol": self.price_sol,
            "items_available": self.items_available,
            "go_live_date": self.go_live_date.isoformat(),
            "creator_wallet": self.creator_wallet,
            "transaction_signatures": self.transaction_signatures,
            "explorer_url": self.explorer_url,
            "created_at": self.created_at.isoformat(),
        }
