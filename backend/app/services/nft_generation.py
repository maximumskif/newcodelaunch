"""
Orchestrates rarity-weighted collection generation: pick one trait per layer
weighted by its rarity_weight, avoid duplicate attribute combinations up to
the collection's max possible combinations (the old app's combination-count
validation was correct, kept here), composite via nft_compositing, and
persist the result.

The old app's `generate_nft_collection` collected each trait's `rarity` field
but never used it (picked traits round-robin via `i % len(traits)`), and
never composited an actual image at all. This is genuinely new logic, not a
port of anything.
"""

from __future__ import annotations

import os
import random
from typing import Any

from ..extensions import db
from ..models.nft import NFTCollection, NFTCollectionStatus, NFTGeneratedItem
from . import nft_compositing

MAX_ITEMS_PER_GENERATE_CALL = 200
MAX_UNIQUE_ATTEMPTS_PER_ITEM = 50


class GenerationError(ValueError):
    pass


def max_possible_combinations(collection: NFTCollection) -> int:
    combinations = 1
    for layer in collection.layers:
        if not layer.traits:
            return 0
        combinations *= len(layer.traits)
    return combinations


def generate_collection(collection: NFTCollection, count: int, upload_folder: str) -> list[NFTGeneratedItem]:
    if not collection.layers or any(not layer.traits for layer in collection.layers):
        raise GenerationError("Every layer needs at least one trait before generating")

    max_combinations = max_possible_combinations(collection)
    if count > max_combinations:
        raise GenerationError(
            f"Requested {count} items but only {max_combinations} unique combinations are possible"
        )
    if count > MAX_ITEMS_PER_GENERATE_CALL:
        raise GenerationError(
            f"Generate at most {MAX_ITEMS_PER_GENERATE_CALL} items per call (requested {count}); "
            "larger collections need a background job, which is future work"
        )

    output_dir = os.path.join(upload_folder, "generated", collection.id)
    os.makedirs(output_dir, exist_ok=True)

    # Continue after whatever's already been generated, rather than always
    # restarting at 1 — a second generate_collection() call used to reuse
    # earlier items' token_index (and therefore their on-disk filename,
    # "generated/<collection_id>/<token_index>.png"), silently overwriting
    # an earlier item's image with a new one while its DB row's `attributes`
    # kept describing the now-destroyed original. Existing items' attribute
    # combinations are also seeded into `used_combinations` below so the
    # dedup guarantee holds across calls, not just within one.
    existing_items = collection.items
    start_index = max((item.token_index for item in existing_items), default=0)
    used_combinations: set[tuple[tuple[str, str], ...]] = {
        tuple((attr["trait_type"], attr["value"]) for attr in item.attributes) for item in existing_items
    }
    items: list[NFTGeneratedItem] = []

    for offset in range(1, count + 1):
        token_index = start_index + offset
        selection = None
        for _ in range(MAX_UNIQUE_ATTEMPTS_PER_ITEM):
            candidate = [
                random.choices(layer.traits, weights=[t.rarity_weight for t in layer.traits], k=1)[0]
                for layer in collection.layers
            ]
            signature = tuple((layer.name, trait.name) for layer, trait in zip(collection.layers, candidate))
            if signature not in used_combinations:
                selection = candidate
                used_combinations.add(signature)
                break

        if selection is None:
            raise GenerationError(
                f"Couldn't find a unique trait combination for item {token_index} after "
                f"{MAX_UNIQUE_ATTEMPTS_PER_ITEM} attempts — try a smaller collection size"
            )

        image_bytes = nft_compositing.composite_layers(
            [os.path.join(upload_folder, trait.image_path) for trait in selection], collection.image_size
        )

        relative_path = os.path.join("generated", collection.id, f"{token_index}.png")
        absolute_path = os.path.join(upload_folder, relative_path)
        with open(absolute_path, "wb") as f:
            f.write(image_bytes)

        attributes: list[dict[str, Any]] = [
            {"trait_type": layer.name, "value": trait.name} for layer, trait in zip(collection.layers, selection)
        ]

        item = NFTGeneratedItem(
            collection_id=collection.id,
            token_index=token_index,
            attributes=attributes,
            image_path=relative_path,
        )
        db.session.add(item)
        items.append(item)

    collection.status = NFTCollectionStatus.GENERATED
    db.session.commit()
    return items
