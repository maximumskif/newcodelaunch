import os

from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.candy_machine import CandyMachineDeployment
from app.models.nft import NFTCollection, NFTLayer, NFTTrait
from app.models.user import Chain, User


def _make_user(wallet_address: str = "0xabc0000000000000000000000000000000000a") -> User:
    user = User(wallet_address=wallet_address, chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _auth_header(user: User) -> dict:
    token = create_access_token(identity=user.id)
    return {"Authorization": f"Bearer {token}"}


def _make_trait_file(upload_folder: str, relative_path: str) -> str:
    absolute_path = os.path.join(upload_folder, relative_path)
    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    with open(absolute_path, "wb") as f:
        f.write(b"fake-png-bytes")
    return relative_path


def _make_collection(upload_folder: str, user_id: str) -> tuple[NFTCollection, NFTLayer, NFTTrait]:
    collection = NFTCollection(user_id=user_id, name="Test Collection")
    _db.session.add(collection)
    _db.session.flush()

    layer = NFTLayer(collection_id=collection.id, name="Background", order_index=0)
    _db.session.add(layer)
    _db.session.flush()

    trait = NFTTrait(
        layer_id=layer.id,
        name="Blue",
        rarity_weight=50.0,
        image_path=_make_trait_file(upload_folder, os.path.join("traits", collection.id, layer.id, "blue.png")),
    )
    _db.session.add(trait)
    _db.session.commit()
    return collection, layer, trait


def test_update_trait_renames_and_reweights(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        _, _, trait = _make_collection(str(tmp_path), user.id)

        response = client.patch(
            f"/api/nft/traits/{trait.id}",
            json={"name": "Sky Blue", "rarity_weight": 75},
            headers=_auth_header(user),
        )

        assert response.status_code == 200
        body = response.get_json()["trait"]
        assert body["name"] == "Sky Blue"
        assert body["rarity_weight"] == 75.0


def test_update_trait_rejects_non_positive_rarity_weight(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        _, _, trait = _make_collection(str(tmp_path), user.id)

        response = client.patch(
            f"/api/nft/traits/{trait.id}", json={"rarity_weight": 0}, headers=_auth_header(user)
        )

        assert response.status_code == 400


def test_delete_trait_removes_the_row_and_the_file(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        _, _, trait = _make_collection(str(tmp_path), user.id)
        absolute_path = os.path.join(str(tmp_path), trait.image_path)
        assert os.path.exists(absolute_path)

        response = client.delete(f"/api/nft/traits/{trait.id}", headers=_auth_header(user))

        assert response.status_code == 204
        assert _db.session.get(NFTTrait, trait.id) is None
        assert not os.path.exists(absolute_path)


def test_update_layer_renames(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        _, layer, _ = _make_collection(str(tmp_path), user.id)

        response = client.patch(
            f"/api/nft/layers/{layer.id}", json={"name": "Backdrop"}, headers=_auth_header(user)
        )

        assert response.status_code == 200
        assert response.get_json()["layer"]["name"] == "Backdrop"


def test_delete_layer_cascades_to_its_traits_and_removes_its_directory(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        collection, layer, trait = _make_collection(str(tmp_path), user.id)
        layer_dir = os.path.join(str(tmp_path), "traits", collection.id, layer.id)
        assert os.path.isdir(layer_dir)

        response = client.delete(f"/api/nft/layers/{layer.id}", headers=_auth_header(user))

        assert response.status_code == 204
        assert _db.session.get(NFTLayer, layer.id) is None
        assert _db.session.get(NFTTrait, trait.id) is None
        assert not os.path.exists(layer_dir)


def test_reorder_layers_updates_order_index(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        collection, first_layer, _ = _make_collection(str(tmp_path), user.id)
        second_layer = NFTLayer(collection_id=collection.id, name="Foreground", order_index=1)
        _db.session.add(second_layer)
        _db.session.commit()

        response = client.post(
            f"/api/nft/collections/{collection.id}/layers/reorder",
            json={"layer_ids": [second_layer.id, first_layer.id]},
            headers=_auth_header(user),
        )

        assert response.status_code == 200
        by_id = {layer["id"]: layer["order_index"] for layer in response.get_json()["layers"]}
        assert by_id[second_layer.id] == 0
        assert by_id[first_layer.id] == 1


def test_reorder_layers_rejects_a_mismatched_id_set(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        collection, first_layer, _ = _make_collection(str(tmp_path), user.id)

        response = client.post(
            f"/api/nft/collections/{collection.id}/layers/reorder",
            json={"layer_ids": ["not-a-real-layer-id"]},
            headers=_auth_header(user),
        )

        assert response.status_code == 400
        assert _db.session.get(NFTLayer, first_layer.id).order_index == 0


def test_delete_collection_cascades_and_removes_upload_directories(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        collection, layer, trait = _make_collection(str(tmp_path), user.id)
        collection_traits_dir = os.path.join(str(tmp_path), "traits", collection.id)
        assert os.path.isdir(collection_traits_dir)

        response = client.delete(f"/api/nft/collections/{collection.id}", headers=_auth_header(user))

        assert response.status_code == 204
        assert _db.session.get(NFTCollection, collection.id) is None
        assert _db.session.get(NFTLayer, layer.id) is None
        assert _db.session.get(NFTTrait, trait.id) is None
        assert not os.path.exists(collection_traits_dir)


def test_delete_collection_rejects_when_a_candy_machine_was_launched_from_it(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        user = _make_user()
        collection, _, _ = _make_collection(str(tmp_path), user.id)
        _db.session.add(
            CandyMachineDeployment(
                user_id=user.id,
                nft_collection_id=collection.id,
                network="solana_devnet",
                collection_mint="CollectionMintAddress",
                candy_machine="CandyMachineAddress",
                price_sol=1.0,
                items_available=10,
                go_live_date=collection.created_at,
                creator_wallet="CreatorWalletAddress",
            )
        )
        _db.session.commit()

        response = client.delete(f"/api/nft/collections/{collection.id}", headers=_auth_header(user))

        assert response.status_code == 409
        assert _db.session.get(NFTCollection, collection.id) is not None


def test_cannot_delete_another_users_trait(app, client, tmp_path):
    with app.app_context():
        app.config["UPLOAD_FOLDER"] = str(tmp_path)
        owner = _make_user("0xowner000000000000000000000000000000001")
        attacker = _make_user("0xattacker0000000000000000000000000000002")
        _, _, trait = _make_collection(str(tmp_path), owner.id)

        response = client.delete(f"/api/nft/traits/{trait.id}", headers=_auth_header(attacker))

        assert response.status_code == 404
        assert _db.session.get(NFTTrait, trait.id) is not None
