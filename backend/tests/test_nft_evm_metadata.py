import json

from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.nft import NFTCollection, NFTGeneratedItem
from app.models.user import Chain, User
from app.services import ipfs


def _collection_with_items(published_indexes, unpublished_indexes=()):
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    collection = NFTCollection(user_id=user.id, name="Cool Apes", description="Apes.", collection_size=10, image_size=64)
    _db.session.add(collection)
    _db.session.commit()
    for index in published_indexes:
        _db.session.add(
            NFTGeneratedItem(
                collection_id=collection.id,
                token_index=index,
                attributes=[{"trait_type": "Fur", "value": f"v{index}"}],
                image_path=f"generated/{index}.png",
                ipfs_image_hash=f"QmImage{index}",
                ipfs_metadata_hash=f"QmMeta{index}",
            )
        )
    for index in unpublished_indexes:
        _db.session.add(
            NFTGeneratedItem(collection_id=collection.id, token_index=index, attributes=[], image_path=f"generated/{index}.png")
        )
    _db.session.commit()
    return user, collection


def _capture_directory_upload(monkeypatch):
    captured = {}

    def fake_upload_directory(files, folder_name):
        captured["files"] = files
        captured["folder"] = folder_name
        return {"hash": "QmDir", "url": "ipfs://QmDir/", "gateway_url": "https://gw.example/ipfs/QmDir/"}

    monkeypatch.setattr(ipfs, "upload_directory", fake_upload_directory)
    return captured


def test_pins_published_items_as_token_ids_1_to_n_in_generation_order(app, client, monkeypatch):
    captured = _capture_directory_upload(monkeypatch)
    user, collection = _collection_with_items(published_indexes=[5, 2, 9], unpublished_indexes=[3])

    response = client.post(
        f"/api/nft/collections/{collection.id}/evm-metadata",
        headers={"Authorization": f"Bearer {create_access_token(identity=user.id)}"},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "base_uri": "ipfs://QmDir/",
        "gateway_url": "https://gw.example/ipfs/QmDir/",
        "item_count": 3,
    }
    # Unpublished item 3 is left out; token ids are sequential over the rest,
    # in token_index order — matching the contract's tokenURI(id) = base + id + ".json".
    assert sorted(captured["files"]) == ["1.json", "2.json", "3.json"]
    token_1 = json.loads(captured["files"]["1.json"])
    token_3 = json.loads(captured["files"]["3.json"])
    assert token_1 == {
        "name": "Cool Apes #1",
        "description": "Apes.",
        "image": "ipfs://QmImage2",
        "attributes": [{"trait_type": "Fur", "value": "v2"}],
    }
    assert token_3["image"] == "ipfs://QmImage9"
    assert captured["folder"] == "Cool_Apes_metadata"


def test_nothing_published_is_a_clean_422(app, client, monkeypatch):
    captured = _capture_directory_upload(monkeypatch)
    user, collection = _collection_with_items(published_indexes=[], unpublished_indexes=[1])

    response = client.post(
        f"/api/nft/collections/{collection.id}/evm-metadata",
        headers={"Authorization": f"Bearer {create_access_token(identity=user.id)}"},
    )
    assert response.status_code == 422
    assert captured == {}


def test_someone_elses_collection_is_a_404(app, client, monkeypatch):
    _capture_directory_upload(monkeypatch)
    _, collection = _collection_with_items(published_indexes=[1])
    stranger = User(wallet_address="0xabc000000000000000000000000000000000000b", chain=Chain.EVM)
    _db.session.add(stranger)
    _db.session.commit()

    response = client.post(
        f"/api/nft/collections/{collection.id}/evm-metadata",
        headers={"Authorization": f"Bearer {create_access_token(identity=stranger.id)}"},
    )
    assert response.status_code == 404


def test_upload_directory_sends_every_file_under_one_folder(app, monkeypatch):
    sent = {}

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return {"IpfsHash": "QmDir"}

    def fake_post(url, files, headers, timeout):
        sent["url"] = url
        sent["files"] = files
        return _Response()

    monkeypatch.setattr(ipfs.requests, "post", fake_post)
    app.config["PINATA_JWT"] = "jwt"

    result = ipfs.upload_directory({"1.json": b"{}", "2.json": b"{}"}, "apes")

    assert sent["url"].endswith("/pinning/pinFileToIPFS")
    assert [part[1][0] for part in sent["files"]] == ["apes/1.json", "apes/2.json"]
    assert result["url"] == "ipfs://QmDir/"
