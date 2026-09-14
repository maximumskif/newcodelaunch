import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class NFTCollectionStatus:
    DRAFT = "draft"
    GENERATED = "generated"
    PUBLISHED = "published"


class NFTCollection(db.Model):
    __tablename__ = "nft_collections"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    name = db.Column(db.String(128), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    collection_size = db.Column(db.Integer, nullable=False, default=100)
    image_size = db.Column(db.Integer, nullable=False, default=1024)
    status = db.Column(db.String(16), nullable=False, default=NFTCollectionStatus.DRAFT)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    layers = db.relationship(
        "NFTLayer", backref="collection", cascade="all, delete-orphan", order_by="NFTLayer.order_index"
    )
    items = db.relationship(
        "NFTGeneratedItem", backref="collection", cascade="all, delete-orphan",
        order_by="NFTGeneratedItem.token_index",
    )
    # Without this, deleting a collection that has ever had a generation job
    # run against it (essentially every non-empty collection) leaves
    # nft_generation_jobs.collection_id pointing at nothing — invisible on
    # SQLite (no FK enforcement by default) but a real IntegrityError on
    # Postgres, the actual deploy target. Same bug class `delete_collection`
    # already guards against explicitly for CandyMachineDeployment/Project
    # (see nft_collections.py) — those two are blocked outright instead of
    # cascaded because they represent live external state; a generation
    # job is just a historical record of a run, safe to delete along with
    # the collection it describes.
    generation_jobs = db.relationship("NFTGenerationJob", backref="collection", cascade="all, delete-orphan")

    def to_dict(self, include_layers: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "collection_size": self.collection_size,
            "image_size": self.image_size,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
        }
        if include_layers:
            data["layers"] = [layer.to_dict() for layer in self.layers]
        return data


class NFTLayer(db.Model):
    __tablename__ = "nft_layers"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=False, index=True)
    name = db.Column(db.String(64), nullable=False)
    order_index = db.Column(db.Integer, nullable=False, default=0)

    traits = db.relationship("NFTTrait", backref="layer", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "order_index": self.order_index,
            "traits": [trait.to_dict() for trait in self.traits],
        }


class NFTTrait(db.Model):
    __tablename__ = "nft_traits"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    layer_id = db.Column(db.String(36), db.ForeignKey("nft_layers.id"), nullable=False, index=True)
    name = db.Column(db.String(64), nullable=False)
    rarity_weight = db.Column(db.Float, nullable=False, default=50.0)
    image_path = db.Column(db.String(256), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "rarity_weight": self.rarity_weight,
            "image_path": self.image_path,
        }


class NFTGeneratedItem(db.Model):
    __tablename__ = "nft_generated_items"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=False, index=True)
    token_index = db.Column(db.Integer, nullable=False)
    attributes = db.Column(db.JSON, nullable=False, default=list)
    image_path = db.Column(db.String(256), nullable=False)
    ipfs_image_hash = db.Column(db.String(128), nullable=True)
    ipfs_metadata_hash = db.Column(db.String(128), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "token_index": self.token_index,
            "attributes": self.attributes,
            "image_path": self.image_path,
            "ipfs_image_hash": self.ipfs_image_hash,
            "ipfs_metadata_hash": self.ipfs_metadata_hash,
        }


class NFTGenerationJobStatus:
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    ALL = (QUEUED, RUNNING, DONE, FAILED)


class NFTGenerationJob(db.Model):
    __tablename__ = "nft_generation_jobs"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=False, index=True)
    requested_count = db.Column(db.Integer, nullable=False)
    items_generated = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(16), nullable=False, default=NFTGenerationJobStatus.QUEUED)
    error = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "collection_id": self.collection_id,
            "requested_count": self.requested_count,
            "items_generated": self.items_generated,
            "status": self.status,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
