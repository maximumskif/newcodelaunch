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
from typing import Any, Callable, Optional

from ..extensions import db
from ..models.nft import NFTCollection, NFTCollectionStatus, NFTGeneratedItem
from . import nft_compositing

# A hard sanity cap, not a "must fit in one HTTP request/response" limit —
# generation always runs through a background job now (see
# nft_generation_jobs.py), so a large collection no longer risks a
# gunicorn/proxy timeout the way it did when this ran synchronously inside
# the request. Still capped well short of "unbounded" as cheap protection
# against a single request kicking off a runaway job.
MAX_ITEMS_PER_GENERATE_CALL = 10_000
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


def generate_collection(
    collection: NFTCollection,
    count: int,
    upload_folder: str,
    on_item: Optional[Callable[[int], None]] = None,
) -> list[NFTGeneratedItem]:
    """`on_item`, when given, is called with the running count of items
    generated so far after each one is composited and committed — the
    background job wrapper (nft_generation_jobs.py) uses this to persist
    live progress a client can poll mid-run, rather than only learning the
    result once the whole batch finishes."""
    if not collection.layers or any(not layer.traits for layer in collection.layers):
        raise GenerationError("Every layer needs at least one trait before generating")

    max_combinations = max_possible_combinations(collection)
    if count > max_combinations:
        raise GenerationError(
            f"Requested {count} items but only {max_combinations} unique combinations are possible"
        )
    if count > MAX_ITEMS_PER_GENERATE_CALL:
        raise GenerationError(f"Generate at most {MAX_ITEMS_PER_GENERATE_CALL} items per call (requested {count})")

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
        collection.status = NFTCollectionStatus.GENERATED
        # Committed per item, not once after the whole loop: a background
        # job (nft_generation_jobs.py) may run this for thousands of items,
        # and this is what makes each one's progress actually visible to a
        # client polling the job mid-run, and what keeps already-generated
        # items on disk *and* in the DB if a later item in the same run hits
        # the "couldn't find a unique combination" error below instead of
        # losing the whole batch to one late failure.
        db.session.commit()
        items.append(item)
        if on_item is not None:
            on_item(len(items))

    return items
