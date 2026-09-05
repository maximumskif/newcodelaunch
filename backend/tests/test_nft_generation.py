import os

import pytest
from PIL import Image

from app.extensions import db as _db
from app.models.nft import NFTCollection, NFTGeneratedItem, NFTLayer, NFTTrait
from app.models.user import Chain, User
from app.services import nft_generation


def _make_user():
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _make_trait_image(upload_folder: str, relative_path: str, color) -> str:
    absolute_path = os.path.join(upload_folder, relative_path)
    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    Image.new("RGBA", (32, 32), color).save(absolute_path)
    return relative_path


def _make_collection(upload_folder: str, user_id: str, *, image_size: int = 32) -> NFTCollection:
    collection = NFTCollection(user_id=user_id, name="Test Collection", image_size=image_size)
    _db.session.add(collection)
    _db.session.flush()

    background = NFTLayer(collection_id=collection.id, name="Background", order_index=0)
    _db.session.add(background)
    _db.session.flush()
    _db.session.add(
        NFTTrait(
            layer_id=background.id,
            name="Blue",
            rarity_weight=50.0,
            image_path=_make_trait_image(upload_folder, "traits/bg_blue.png", (0, 0, 255, 255)),
        )
    )
    _db.session.add(
        NFTTrait(
            layer_id=background.id,
            name="Red",
            rarity_weight=50.0,
            image_path=_make_trait_image(upload_folder, "traits/bg_red.png", (255, 0, 0, 255)),
        )
    )
    _db.session.commit()
    return collection


def test_generate_collection_produces_real_composited_files_and_attributes(app, tmp_path):
    with app.app_context():
        upload_folder = str(tmp_path)
        user = _make_user()
        collection = _make_collection(upload_folder, user.id)

        items = nft_generation.generate_collection(collection, count=2, upload_folder=upload_folder)

        assert len(items) == 2
        assert {item.token_index for item in items} == {1, 2}

        for item in items:
            absolute_path = os.path.join(upload_folder, item.image_path)
            assert os.path.isfile(absolute_path)
            with Image.open(absolute_path) as generated:
                assert generated.size == (32, 32)
            assert item.attributes == [{"trait_type": "Background", "value": item.attributes[0]["value"]}]
            assert item.attributes[0]["value"] in {"Blue", "Red"}

        # Only 2 unique combinations exist (1 layer, 2 traits) — both must
        # have been used, proving dedupe picked distinct traits, not chance.
        assert {item.attributes[0]["value"] for item in items} == {"Blue", "Red"}
        assert NFTGeneratedItem.query.filter_by(collection_id=collection.id).count() == 2


def test_generate_collection_rejects_count_over_max_combinations(app, tmp_path):
    with app.app_context():
        upload_folder = str(tmp_path)
        user = _make_user()
        collection = _make_collection(upload_folder, user.id)  # max_possible_combinations == 2

        with pytest.raises(nft_generation.GenerationError):
            nft_generation.generate_collection(collection, count=3, upload_folder=upload_folder)


def test_generate_collection_rejects_count_over_the_hard_cap(app, tmp_path, monkeypatch):
    with app.app_context():
        upload_folder = str(tmp_path)
        user = _make_user()
        collection = _make_collection(upload_folder, user.id)
        monkeypatch.setattr(nft_generation, "MAX_ITEMS_PER_GENERATE_CALL", 1)

        with pytest.raises(nft_generation.GenerationError, match="at most 1"):
            nft_generation.generate_collection(collection, count=2, upload_folder=upload_folder)


def test_generate_collection_requires_every_layer_to_have_a_trait(app, tmp_path):
    with app.app_context():
        upload_folder = str(tmp_path)
        user = _make_user()
        collection = NFTCollection(user_id=user.id, name="Empty Layer Collection")
        _db.session.add(collection)
        _db.session.flush()
        _db.session.add(NFTLayer(collection_id=collection.id, name="Background", order_index=0))
        _db.session.commit()

        with pytest.raises(nft_generation.GenerationError):
            nft_generation.generate_collection(collection, count=1, upload_folder=upload_folder)


def test_max_possible_combinations_multiplies_across_layers(app, tmp_path):
    with app.app_context():
        upload_folder = str(tmp_path)
        user = _make_user()
        collection = _make_collection(upload_folder, user.id)  # 1 layer x 2 traits

        eyes = NFTLayer(collection_id=collection.id, name="Eyes", order_index=1)
        _db.session.add(eyes)
        _db.session.flush()
        for name in ("Open", "Closed", "Wink"):
            _db.session.add(
                NFTTrait(
                    layer_id=eyes.id,
                    name=name,
                    rarity_weight=10.0,
                    image_path=_make_trait_image(upload_folder, f"traits/eyes_{name}.png", (0, 255, 0, 255)),
                )
            )
        _db.session.commit()

        assert nft_generation.max_possible_combinations(collection) == 2 * 3
