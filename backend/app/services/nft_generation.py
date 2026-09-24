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
from ..models.nft import NFTCollection, NFTCollectionStatus, NFTGeneratedItem, NFTLayer, NFTTrait, NFTTraitRuleKind
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


# Above this many raw combinations, counting only the rule-abiding ones
# (a full enumeration) isn't worth it — the plain product is used as an
# upper bound instead, and the per-item attempt limit catches the rest.
MAX_ENUMERATED_COMBINATIONS = 200_000


class _Rules:
    """A collection's trait rules, indexed for sampling."""

    def __init__(self, collection: NFTCollection):
        self.layer_of = {trait.id: position for position, layer in enumerate(collection.layers) for trait in layer.traits}
        self.excludes: dict[str, set[str]] = {}
        self.requires: dict[str, set[str]] = {}
        for rule in collection.trait_rules:
            if rule.kind == NFTTraitRuleKind.EXCLUDE:
                self.excludes.setdefault(rule.trait_id, set()).add(rule.other_trait_id)
                self.excludes.setdefault(rule.other_trait_id, set()).add(rule.trait_id)
            else:
                self.requires.setdefault(rule.trait_id, set()).add(rule.other_trait_id)

    def allowed(self, layer: NFTLayer, position: int, chosen_ids: set[str]) -> list[NFTTrait]:
        """This layer's traits that keep the item valid given the traits
        already picked on earlier layers."""
        # A trait picked earlier that requires one on this layer forces it.
        forced = {
            required
            for chosen in chosen_ids
            for required in self.requires.get(chosen, ())
            if self.layer_of.get(required) == position
        }
        if len(forced) > 1:
            return []  # two different traits required on one layer: impossible
        allowed = []
        for trait in layer.traits:
            if forced and trait.id not in forced:
                continue
            if self.excludes.get(trait.id, set()) & chosen_ids:
                continue
            # It requires a trait on an earlier layer that wasn't picked.
            if any(
                required not in chosen_ids and self.layer_of.get(required, position + 1) < position
                for required in self.requires.get(trait.id, ())
            ):
                continue
            allowed.append(trait)
        return allowed


def _sample(collection: NFTCollection, rules: _Rules) -> list[NFTTrait] | None:
    """One rarity-weighted combination that satisfies every rule, built
    layer by layer from only the traits still allowed — or None if this
    attempt ran into a dead end (the caller retries)."""
    chosen: list[NFTTrait] = []
    chosen_ids: set[str] = set()
    for position, layer in enumerate(collection.layers):
        allowed = rules.allowed(layer, position, chosen_ids)
        if not allowed:
            return None
        pick = random.choices(allowed, weights=[trait.rarity_weight for trait in allowed], k=1)[0]
        chosen.append(pick)
        chosen_ids.add(pick.id)
    return chosen


def max_possible_combinations(collection: NFTCollection) -> int:
    """How many distinct items the collection can produce — counting only
    combinations that satisfy its trait rules, when that's cheap enough to
    enumerate (otherwise the plain product, an upper bound)."""
    combinations = 1
    for layer in collection.layers:
        if not layer.traits:
            return 0
        combinations *= len(layer.traits)
    if not collection.trait_rules or combinations > MAX_ENUMERATED_COMBINATIONS:
        return combinations

    rules = _Rules(collection)

    def count(position: int, chosen_ids: set[str]) -> int:
        if position == len(collection.layers):
            return 1
        return sum(
            count(position + 1, chosen_ids | {trait.id})
            for trait in rules.allowed(collection.layers[position], position, chosen_ids)
        )

    return count(0, set())


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

    rules = _Rules(collection)
    for offset in range(1, count + 1):
        token_index = start_index + offset
        selection = None
        for _ in range(MAX_UNIQUE_ATTEMPTS_PER_ITEM):
            candidate = _sample(collection, rules)
            if candidate is None:
                continue
            signature = tuple((layer.name, trait.name) for layer, trait in zip(collection.layers, candidate))
            if signature not in used_combinations:
                selection = candidate
                used_combinations.add(signature)
                break

        if selection is None:
            raise GenerationError(
                f"Couldn't find a unique trait combination for item {token_index} after "
                f"{MAX_UNIQUE_ATTEMPTS_PER_ITEM} attempts — try a smaller collection size, or loosen its trait rules"
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
