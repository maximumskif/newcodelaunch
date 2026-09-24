import os

import pytest
from flask_jwt_extended import create_access_token
from PIL import Image

from app.extensions import db as _db
from app.models.nft import NFTCollection, NFTLayer, NFTTrait, NFTTraitRule
from app.models.user import Chain, User
from app.services import nft_collections, nft_generation


def _image(upload_folder, name):
    path = os.path.join(upload_folder, "traits", f"{name}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGBA", (4, 4), (10, 20, 30, 255)).save(path)
    return os.path.join("traits", f"{name}.png")


def _collection(upload_folder, layers=(("Background", ["Blue", "Red", "Green"]), ("Hat", ["Cap", "Crown", "None"]))):
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    collection = NFTCollection(user_id=user.id, name="Rules", description="", collection_size=9, image_size=8)
    _db.session.add(collection)
    _db.session.commit()
    traits = {}
    for index, (layer_name, trait_names) in enumerate(layers):
        layer = NFTLayer(collection_id=collection.id, name=layer_name, order_index=index)
        _db.session.add(layer)
        _db.session.commit()
        for trait_name in trait_names:
            trait = NFTTrait(layer_id=layer.id, name=trait_name, rarity_weight=1.0, image_path=_image(upload_folder, f"{layer_name}-{trait_name}"))
            _db.session.add(trait)
            _db.session.commit()
            traits[trait_name] = trait
    _db.session.refresh(collection)
    return user, collection, traits


def _combos(items):
    return {tuple(attribute["value"] for attribute in item.attributes) for item in items}


def test_generation_never_breaks_an_exclude_rule(app, tmp_path):
    _, collection, t = _collection(str(tmp_path))
    nft_collections.add_trait_rule(collection, "exclude", t["Red"].id, t["Crown"].id)
    assert nft_generation.max_possible_combinations(collection) == 8

    items = nft_generation.generate_collection(collection, 8, str(tmp_path))

    assert ("Red", "Crown") not in _combos(items)
    assert len(_combos(items)) == 8  # every other combination, each once


def test_generation_always_honors_a_require_rule_in_either_layer_order(app, tmp_path):
    _, collection, t = _collection(str(tmp_path))
    # Later layer requires an earlier one (Crown -> Red), and the reverse
    # direction (Green -> Cap).
    nft_collections.add_trait_rule(collection, "require", t["Crown"].id, t["Red"].id)
    nft_collections.add_trait_rule(collection, "require", t["Green"].id, t["Cap"].id)
    possible = nft_generation.max_possible_combinations(collection)
    # Blue: Cap/None (no Crown) = 2; Red: Cap/Crown/None = 3; Green: only Cap = 1.
    assert possible == 6

    combos = _combos(nft_generation.generate_collection(collection, possible, str(tmp_path)))

    assert all(bg == "Red" for bg, hat in combos if hat == "Crown")
    assert all(hat == "Cap" for bg, hat in combos if bg == "Green")
    assert len(combos) == 6


def test_asking_for_more_than_the_rules_allow_fails_up_front(app, tmp_path):
    _, collection, t = _collection(str(tmp_path))
    nft_collections.add_trait_rule(collection, "exclude", t["Red"].id, t["Crown"].id)
    with pytest.raises(nft_generation.GenerationError, match="only 8 unique combinations"):
        nft_generation.generate_collection(collection, 9, str(tmp_path))
    assert collection.items == []


def test_two_requirements_on_one_layer_are_counted_as_impossible(app, tmp_path):
    _, collection, t = _collection(
        str(tmp_path),
        layers=(("Background", ["Blue", "Red"]), ("Body", ["Tall", "Short"]), ("Hat", ["Cap", "Crown"])),
    )
    nft_collections.add_trait_rule(collection, "require", t["Blue"].id, t["Cap"].id)
    nft_collections.add_trait_rule(collection, "require", t["Tall"].id, t["Crown"].id)
    combos = _combos(nft_generation.generate_collection(collection, nft_generation.max_possible_combinations(collection), str(tmp_path)))
    assert ("Blue", "Tall", "Cap") not in combos and ("Blue", "Tall", "Crown") not in combos
    assert all(hat == "Cap" for bg, _, hat in combos if bg == "Blue")


@pytest.mark.parametrize(
    "rule, message",
    [
        (("maybe", "Red", "Crown"), "kind must be one of"),
        (("exclude", "Red", "Blue"), "two different layers"),
        (("exclude", "Red", "nope"), "belong to this collection"),
    ],
)
def test_rule_validation(app, tmp_path, rule, message):
    _, collection, t = _collection(str(tmp_path))
    kind, a, b = rule
    with pytest.raises(nft_collections.ValidationError, match=message):
        nft_collections.add_trait_rule(collection, kind, t[a].id, t[b].id if b in t else b)


def test_duplicate_and_contradictory_rules_are_refused(app, tmp_path):
    _, collection, t = _collection(str(tmp_path))
    nft_collections.add_trait_rule(collection, "exclude", t["Red"].id, t["Crown"].id)
    with pytest.raises(nft_collections.ValidationError, match="already exists"):
        nft_collections.add_trait_rule(collection, "exclude", t["Crown"].id, t["Red"].id)
    with pytest.raises(nft_collections.ValidationError, match="contradicts"):
        nft_collections.add_trait_rule(collection, "require", t["Red"].id, t["Crown"].id)
    # A require in each direction is fine — they mean different things.
    nft_collections.add_trait_rule(collection, "require", t["Blue"].id, t["Cap"].id)
    nft_collections.add_trait_rule(collection, "require", t["Cap"].id, t["Blue"].id)


def test_deleting_a_trait_or_layer_removes_its_rules(app, tmp_path):
    _, collection, t = _collection(str(tmp_path))
    nft_collections.add_trait_rule(collection, "exclude", t["Red"].id, t["Crown"].id)
    nft_collections.add_trait_rule(collection, "require", t["Blue"].id, t["Cap"].id)
    nft_collections.delete_trait(t["Crown"], str(tmp_path))
    assert [rule.trait_id for rule in NFTTraitRule.query.all()] == [t["Blue"].id]
    nft_collections.delete_layer(t["Cap"].layer, str(tmp_path))
    assert NFTTraitRule.query.count() == 0


def test_rule_routes_are_owner_only(app, client, tmp_path):
    owner, collection, t = _collection(str(tmp_path))
    stranger = User(wallet_address="0xabc000000000000000000000000000000000000b", chain=Chain.EVM)
    _db.session.add(stranger)
    _db.session.commit()
    auth = lambda user: {"Authorization": f"Bearer {create_access_token(identity=user.id)}"}  # noqa: E731
    body = {"kind": "exclude", "trait_id": t["Red"].id, "other_trait_id": t["Crown"].id}

    assert client.post(f"/api/nft/collections/{collection.id}/rules", headers=auth(stranger), json=body).status_code == 404
    created = client.post(f"/api/nft/collections/{collection.id}/rules", headers=auth(owner), json=body)
    assert created.status_code == 201
    rule_id = created.get_json()["rule"]["id"]
    assert client.post(f"/api/nft/collections/{collection.id}/rules", headers=auth(owner), json=body).status_code == 422
    listed = client.get(f"/api/nft/collections/{collection.id}", headers=auth(owner)).get_json()["collection"]
    assert [rule["id"] for rule in listed["rules"]] == [rule_id]
    assert client.delete(f"/api/nft/rules/{rule_id}", headers=auth(stranger)).status_code == 404
    assert client.delete(f"/api/nft/rules/{rule_id}", headers=auth(owner)).status_code == 204
