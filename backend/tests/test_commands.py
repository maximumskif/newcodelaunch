from datetime import datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models.nft import NFTCollection, NFTGenerationJob, NFTGenerationJobStatus
from app.models.user import Chain, User, WalletNonce


def _make_nonce(wallet_address: str, *, consumed: bool, age_seconds: int) -> WalletNonce:
    nonce = WalletNonce(
        wallet_address=wallet_address,
        chain="evm",
        nonce="deadbeef",
        consumed=consumed,
        created_at=datetime.now(timezone.utc) - timedelta(seconds=age_seconds),
    )
    db.session.add(nonce)
    return nonce


def test_prune_nonces_deletes_consumed_and_expired_but_keeps_fresh(app):
    with app.app_context():
        ttl = app.config["WALLET_NONCE_TTL_SECONDS"]
        _make_nonce("0xconsumed", consumed=True, age_seconds=5)
        _make_nonce("0xexpired", consumed=False, age_seconds=ttl + 60)
        fresh = _make_nonce("0xfresh", consumed=False, age_seconds=5)
        db.session.commit()

        result = app.test_cli_runner().invoke(args=["prune-nonces"])

        assert result.exit_code == 0
        assert "Deleted 2" in result.output
        remaining = WalletNonce.query.all()
        assert [row.id for row in remaining] == [fresh.id]


def test_prune_nonces_no_op_when_nothing_is_stale(app):
    with app.app_context():
        _make_nonce("0xfresh", consumed=False, age_seconds=1)
        db.session.commit()

        result = app.test_cli_runner().invoke(args=["prune-nonces"])

        assert result.exit_code == 0
        assert "Deleted 0" in result.output
        assert WalletNonce.query.count() == 1


def _make_collection() -> NFTCollection:
    user = User(wallet_address="0xreaper000000000000000000000000000000aa", chain=Chain.EVM)
    db.session.add(user)
    db.session.commit()
    collection = NFTCollection(user_id=user.id, name="Reaper Test Collection")
    db.session.add(collection)
    db.session.commit()
    return collection


def _make_job(collection_id: str, *, status: str, updated_seconds_ago: int) -> NFTGenerationJob:
    # updated_at has onupdate=_utcnow, but that only fires on an UPDATE
    # statement — an explicit value passed at construction is used as-is
    # for the initial INSERT, which is exactly what's needed to simulate a
    # job whose last real progress was N seconds ago.
    job = NFTGenerationJob(
        collection_id=collection_id,
        requested_count=5,
        status=status,
        updated_at=datetime.now(timezone.utc) - timedelta(seconds=updated_seconds_ago),
    )
    db.session.add(job)
    db.session.commit()
    return job


def test_reap_stale_generation_jobs_fails_jobs_with_no_recent_progress(app):
    with app.app_context():
        stale_seconds = app.config["NFT_GENERATION_JOB_STALE_SECONDS"]
        collection = _make_collection()
        stuck_running = _make_job(collection.id, status=NFTGenerationJobStatus.RUNNING, updated_seconds_ago=stale_seconds + 60)
        stuck_queued = _make_job(collection.id, status=NFTGenerationJobStatus.QUEUED, updated_seconds_ago=stale_seconds + 60)

        result = app.test_cli_runner().invoke(args=["reap-stale-generation-jobs"])

        assert result.exit_code == 0
        assert "Reaped 2" in result.output
        db.session.refresh(stuck_running)
        db.session.refresh(stuck_queued)
        assert stuck_running.status == NFTGenerationJobStatus.FAILED
        assert stuck_queued.status == NFTGenerationJobStatus.FAILED
        assert "worker running this job likely died" in stuck_running.error


def test_reap_stale_generation_jobs_leaves_recent_and_finished_jobs_alone(app):
    with app.app_context():
        collection = _make_collection()
        recent_running = _make_job(collection.id, status=NFTGenerationJobStatus.RUNNING, updated_seconds_ago=5)
        old_but_done = _make_job(collection.id, status=NFTGenerationJobStatus.DONE, updated_seconds_ago=999_999)

        result = app.test_cli_runner().invoke(args=["reap-stale-generation-jobs"])

        assert result.exit_code == 0
        assert "Reaped 0" in result.output
        db.session.refresh(recent_running)
        db.session.refresh(old_but_done)
        assert recent_running.status == NFTGenerationJobStatus.RUNNING
        assert old_but_done.status == NFTGenerationJobStatus.DONE


def test_reap_stale_generation_jobs_unblocks_new_job_creation_on_that_collection(app, tmp_path):
    from app.services import nft_generation, nft_generation_jobs

    with app.app_context():
        stale_seconds = app.config["NFT_GENERATION_JOB_STALE_SECONDS"]
        collection = _make_collection()
        _make_job(collection.id, status=NFTGenerationJobStatus.RUNNING, updated_seconds_ago=stale_seconds + 60)

        app.test_cli_runner().invoke(args=["reap-stale-generation-jobs"])

        # create_job's own active-job guard (see nft_generation_jobs.py) must
        # no longer see the reaped job as active. This collection has no
        # layers/traits, so create_job is expected to reject it anyway — but
        # via GenerationError ("needs at least one trait"), not the
        # ConflictError ("already running") it would have raised before the
        # reap. Getting past the active-job check to a different, later
        # error is exactly the proof this test needs.
        with pytest.raises(nft_generation.GenerationError, match="at least one trait"):
            nft_generation_jobs.create_job(app, collection, count=1, upload_folder=str(tmp_path))
