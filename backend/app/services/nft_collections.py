"""
CRUD orchestration for NFT collections/layers/traits, plus publish-to-IPFS.

Generation itself lives in nft_generation.py; this module owns everything
around it — creating the collection/layer/trait tree, storing uploaded trait
images to disk, and pushing generated items to Pinata once the user is happy
with a batch.
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Optional

import requests
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from ..extensions import db
from ..models.nft import NFTCollection, NFTGeneratedItem, NFTLayer, NFTTrait
from . import ipfs

ALLOWED_IMAGE_EXTENSIONS = {"png", "webp"}


class NotFoundError(ValueError):
    pass


class ValidationError(ValueError):
    pass


class MetadataFetchError(RuntimeError):
    pass


def create_collection(
    user_id: str, name: str, description: str, collection_size: int, image_size: int
) -> NFTCollection:
    collection = NFTCollection(
        user_id=user_id,
        name=name,
        description=description,
        collection_size=collection_size,
        image_size=image_size,
    )
    db.session.add(collection)
    db.session.commit()
    return collection


def get_user_collections(user_id: str) -> list[NFTCollection]:
    return NFTCollection.query.filter_by(user_id=user_id).order_by(NFTCollection.created_at.desc()).all()


def get_owned_collection(collection_id: str, user_id: str) -> NFTCollection:
    collection = NFTCollection.query.filter_by(id=collection_id, user_id=user_id).first()
    if collection is None:
        raise NotFoundError(f"Collection not found: {collection_id}")
    return collection


def add_layer(collection: NFTCollection, name: str, order_index: int) -> NFTLayer:
    layer = NFTLayer(collection_id=collection.id, name=name, order_index=order_index)
    db.session.add(layer)
    db.session.commit()
    return layer


def get_owned_layer(layer_id: str, user_id: str) -> NFTLayer:
    layer = (
        NFTLayer.query.join(NFTCollection)
        .filter(NFTLayer.id == layer_id, NFTCollection.user_id == user_id)
        .first()
    )
    if layer is None:
        raise NotFoundError(f"Layer not found: {layer_id}")
    return layer


def add_trait(
    layer: NFTLayer, name: str, rarity_weight: float, image_file: FileStorage, upload_folder: str
) -> NFTTrait:
    extension = _validate_image_extension(image_file.filename)
    relative_dir = os.path.join("traits", layer.collection_id, layer.id)
    os.makedirs(os.path.join(upload_folder, relative_dir), exist_ok=True)

    filename = f"{uuid.uuid4()}.{extension}"
    relative_path = os.path.join(relative_dir, filename)
    image_file.save(os.path.join(upload_folder, relative_path))

    trait = NFTTrait(layer_id=layer.id, name=name, rarity_weight=rarity_weight, image_path=relative_path)
    db.session.add(trait)
    db.session.commit()
    return trait


def _validate_image_extension(filename: Optional[str]) -> str:
    if not filename or "." not in filename:
        raise ValidationError("Trait image must have a file extension")
    extension = secure_filename(filename).rsplit(".", 1)[-1].lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValidationError(
            f"Unsupported image type: .{extension} (allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))})"
        )
    return extension


def get_owned_item(item_id: str, user_id: str) -> tuple[NFTGeneratedItem, NFTCollection]:
    result = (
        db.session.query(NFTGeneratedItem, NFTCollection)
        .join(NFTCollection, NFTGeneratedItem.collection_id == NFTCollection.id)
        .filter(NFTGeneratedItem.id == item_id, NFTCollection.user_id == user_id)
        .first()
    )
    if result is None:
        raise NotFoundError(f"Generated item not found: {item_id}")
    return result


def publish_item_to_ipfs(item: NFTGeneratedItem, collection: NFTCollection, upload_folder: str) -> NFTGeneratedItem:
    if item.ipfs_image_hash and item.ipfs_metadata_hash:
        return item  # already published, no-op

    with open(os.path.join(upload_folder, item.image_path), "rb") as f:
        image_bytes = f.read()

    image_result = ipfs.upload_file(image_bytes, f"{collection.name}_{item.token_index}.png")
    metadata_result = ipfs.upload_nft_metadata(
        name=f"{collection.name} #{item.token_index}",
        description=collection.description,
        image_ipfs_hash=image_result["hash"],
        attributes=item.attributes,
    )

    item.ipfs_image_hash = image_result["hash"]
    item.ipfs_metadata_hash = metadata_result["hash"]
    db.session.commit()
    return item


def get_item_metadata(item: NFTGeneratedItem, collection: NFTCollection) -> dict[str, Any]:
    """Metadata preview/export (Phase 5) — a distinct read separate from the
    publish action itself.

    For an already-published item, this fetches the literal JSON pinned to
    IPFS rather than reconstructing it locally: the metadata's `created_at`
    is only known at the moment it was actually uploaded, so recomputing it
    here would silently fabricate a new timestamp that doesn't match what's
    really on IPFS. For an unpublished item there's nothing to fetch — the
    preview honestly reflects only what's already decided (name, description,
    attributes) and leaves `image`/`created_at` null rather than guessing.
    """
    name = f"{collection.name} #{item.token_index}"

    if item.ipfs_metadata_hash:
        try:
            response = requests.get(f"{ipfs.PINATA_GATEWAY}{item.ipfs_metadata_hash}", timeout=15)
            response.raise_for_status()
            return {"published": True, "metadata": response.json(), "metadata_ipfs_hash": item.ipfs_metadata_hash}
        except requests.RequestException as exc:
            raise MetadataFetchError(f"Could not fetch published metadata from IPFS: {exc}") from exc

    return {
        "published": False,
        "metadata": {
            "name": name,
            "description": collection.description,
            "image": None,
            "attributes": item.attributes,
        },
    }
