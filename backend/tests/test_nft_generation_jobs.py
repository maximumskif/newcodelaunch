import os

import pytest
from flask_jwt_extended import create_access_token
from PIL import Image

from app.extensions import db as _db
from app.models.nft import NFTCollection, NFTGeneratedItem, NFTGenerationJob, NFTGenerationJobStatus, NFTLayer, NFTTrait
from app.models.user import Chain, User
from app.services import nft_collections, nft_generation, nft_generation_jobs


def _make_user(wallet_address: str = "0xabc0000000000000000000000000000000000a") -> User:
    user = User(wallet_address=wallet_address, chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _auth_header(user: User) -> dict:
    token = create_access_token(identity=user.id)
    return {"Authorization": f"Bearer {token}"}


def _make_trait_image(upload_folder: str, relative_path: str, color) -> str:
    absolute_path = os.path.join(upload_folder, relative_path)
    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    Image.new("RGBA", (16, 16), color).save(absolute_path)
    return relative_path


def _make_collection(upload_folder: str, user_id: str) -> NFTCollection:
    collection = NFTCollection(user_id=user_id, name="Job Test Collection", image_size=16)
    _db.session.add(collection)
    _db.session.flush()

    layer = NFTLayer(collection_id=collection.id, name="Background", order_index=0)
    _db.session.add(layer)
    _db.session.flush()
    for name, color in (("Blue", (0, 0, 255, 255)), ("Red", (255, 0, 0, 255)), ("Green", (0, 255, 0, 255))):
        _db.session.add(
            NFTTrait(
                layer_id=layer.id,
                name=name,
                rarity_weight=10.0,
                image_path=_make_trait_image(upload_folder, f"traits/bg_{name.lower()}.png", color),
            )
        )
    _db.session.commit()
    return collection


class TestCreateJob:
    def test_runs_synchronously_under_testing_and_finishes_done(self, app, tmp_path):
        # app.testing is True (TestConfig) — create_job's thread-vs-inline
        # branch should take the inline path, so this job is already
        # finished by the time create_job returns, with no polling needed.
        with app.app_context():
            upload_folder = str(tmp_path)
            user = _make_user()
            collection = _make_collection(upload_folder, user.id)

            job = nft_generation_jobs.create_job(app, collection, count=2, upload_folder=upload_folder)

            assert job.status == NFTGenerationJobStatus.DONE
            assert job.items_generated == 2
            assert job.requested_count == 2
            assert job.error is None
            assert NFTGeneratedItem.query.filter_by(collection_id=collection.id).count() == 2

    def test_rejects_a_second_job_while_one_is_still_active_for_the_same_collection(self, app, tmp_path):
        # Regression coverage: two jobs racing on the same collection could
        # both compute the same starting token_index and dedup set from
        # collection.items before either committed, then both write items
        # under the same token_index — one silently overwriting the
        # other's on-disk image. Real risk once jobs run in the background
        # for a while (e.g. two tabs open on the same collection), not just
        # a same-millisecond double-click.
        with app.app_context():
            upload_folder = str(tmp_path)
            user = _make_user()
            collection = _make_collection(upload_folder, user.id)
            _db.session.add(
                NFTGenerationJob(collection_id=collection.id, requested_count=1, status=NFTGenerationJobStatus.RUNNING)
            )
            _db.session.commit()

            with pytest.raises(nft_collections.ConflictError, match="already running"):
                nft_generation_jobs.create_job(app, collection, count=1, upload_folder=upload_folder)

    def test_rejects_an_invalid_count_without_creating_a_job_row(self, app, tmp_path):
        # 3 traits on one layer -> at most 3 unique combinations possible.
        with app.app_context():
            upload_folder = str(tmp_path)
            user = _make_user()
            collection = _make_collection(upload_folder, user.id)

            with pytest.raises(nft_generation.GenerationError):
                nft_generation_jobs.create_job(app, collection, count=10, upload_folder=upload_folder)

            assert NFTGenerationJob.query.filter_by(collection_id=collection.id).count() == 0

    def test_a_mid_run_failure_marks_the_job_failed_but_keeps_already_generated_items(
        self, app, tmp_path, monkeypatch
    ):
        # Regression coverage for the per-item-commit design this job
        # wrapper relies on: if item N fails, items 1..N-1 must already be
        # persisted (both DB row and on-disk file), not rolled back along
        # with the failure.
        with app.app_context():
            upload_folder = str(tmp_path)
            user = _make_user()
            collection = _make_collection(upload_folder, user.id)

            real_composite = nft_generation.nft_compositing.composite_layers
            call_count = {"n": 0}

            def flaky_composite(*args, **kwargs):
                call_count["n"] += 1
                if call_count["n"] == 2:
                    raise RuntimeError("simulated compositing failure")
                return real_composite(*args, **kwargs)

            monkeypatch.setattr(nft_generation.nft_compositing, "composite_layers", flaky_composite)

            job = nft_generation_jobs.create_job(app, collection, count=3, upload_folder=upload_folder)

            assert job.status == NFTGenerationJobStatus.FAILED
            assert "simulated compositing failure" in job.error
            # The first item (before the simulated failure on the second)
            # must still be there — not thrown away by the later failure.
            assert NFTGeneratedItem.query.filter_by(collection_id=collection.id).count() == 1


class TestGenerateRoute:
    def test_post_generate_returns_a_finished_job_and_get_polls_the_same_one(self, app, client, tmp_path):
        with app.app_context():
            app.config["UPLOAD_FOLDER"] = str(tmp_path)
            user = _make_user()
            collection = _make_collection(str(tmp_path), user.id)
            headers = _auth_header(user)

            response = client.post(
                f"/api/nft/collections/{collection.id}/generate", json={"count": 2}, headers=headers
            )
            assert response.status_code == 202
            job_payload = response.get_json()["job"]
            assert job_payload["status"] == "done"
            assert job_payload["items_generated"] == 2

            poll_response = client.get(f"/api/nft/generation-jobs/{job_payload['id']}", headers=headers)
            assert poll_response.status_code == 200
            assert poll_response.get_json()["job"]["id"] == job_payload["id"]
            assert poll_response.get_json()["job"]["status"] == "done"

    def test_generate_returns_409_when_a_job_is_already_running(self, app, client, tmp_path):
        with app.app_context():
            app.config["UPLOAD_FOLDER"] = str(tmp_path)
            user = _make_user()
            collection = _make_collection(str(tmp_path), user.id)
            headers = _auth_header(user)
            _db.session.add(
                NFTGenerationJob(collection_id=collection.id, requested_count=1, status=NFTGenerationJobStatus.RUNNING)
            )
            _db.session.commit()

            response = client.post(
                f"/api/nft/collections/{collection.id}/generate", json={"count": 1}, headers=headers
            )
            assert response.status_code == 409

    def test_generate_rejects_a_non_positive_count(self, app, client, tmp_path):
        with app.app_context():
            app.config["UPLOAD_FOLDER"] = str(tmp_path)
            user = _make_user()
            collection = _make_collection(str(tmp_path), user.id)
            headers = _auth_header(user)

            response = client.post(
                f"/api/nft/collections/{collection.id}/generate", json={"count": 0}, headers=headers
            )
            assert response.status_code == 400

    def test_cannot_poll_another_users_generation_job(self, app, client, tmp_path):
        with app.app_context():
            app.config["UPLOAD_FOLDER"] = str(tmp_path)
            owner = _make_user("0xaaaa000000000000000000000000000000aaaa")
            collection = _make_collection(str(tmp_path), owner.id)
            job = nft_generation_jobs.create_job(app, collection, count=1, upload_folder=str(tmp_path))
            job_id = job.id

            intruder = _make_user("0xbbbb000000000000000000000000000000bbbb")
            intruder_headers = _auth_header(intruder)

        response = client.get(f"/api/nft/generation-jobs/{job_id}", headers=intruder_headers)
        assert response.status_code == 404
