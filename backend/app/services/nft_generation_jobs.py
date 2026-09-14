"""
Background execution wrapper around nft_generation.generate_collection —
lets a request return immediately with a pollable job instead of blocking
for however long compositing `count` real images takes. Before this, the
generate route ran the whole batch inline and capped it at 200 items/call
specifically to bound how long one request could block (see
nft_generation.py's MAX_ITEMS_PER_GENERATE_CALL) — raising that cap without
something like this would just make the timeout risk worse.

Runs generation in a plain Python thread within this same process, not a
separate broker-backed worker (Celery/RQ/etc). There's no Redis (or other
message broker) instance available to actually run and verify one against
in this project's dev sandboxes, and shipping that untested would violate
the standard the rest of this codebase holds itself to — see
docs/REBUILD_PROGRESS.md, "real execution, not just typechecked." A thread
is enough to solve the actual problem (don't block the request), coordinates
across gunicorn worker *processes* via the job row in the database (every
worker can read/poll the same job regardless of which one is running the
thread), and this module's two functions are the natural seam to swap in a
real distributed queue later if load ever actually demands one.

Known limitation, worth being upfront about rather than silent on: if the
worker process running a job's thread is killed or restarts mid-run (a
deploy, an OOM), that job is left stuck at "running" with no more progress
— there's no separate supervisor to notice and requeue it. A real
broker-backed queue doesn't have this gap; this trade-off is what buys
"actually shippable and verified today" instead of "correct in theory, run
against nothing real."
"""

from __future__ import annotations

import threading

from flask import Flask

from ..extensions import db
from ..models.nft import NFTCollection, NFTGenerationJob, NFTGenerationJobStatus
from . import nft_generation
from .nft_collections import ConflictError


def create_job(app: Flask, collection: NFTCollection, count: int, upload_folder: str) -> NFTGenerationJob:
    """Validates synchronously (same checks generate_collection would make
    anyway) so a request with an invalid count fails immediately with a
    clear error instead of creating a job that's guaranteed to fail — then
    hands the actual generation off to a background thread (or runs it
    inline, deterministically, under TESTING; see _run_job)."""
    # generate_collection computes its starting token_index and dedup set
    # from collection.items *once*, at the start of a run — two jobs racing
    # on the same collection could both read the same starting point before
    # either commits, then both write items under the same token_index
    # (the second silently overwriting the first's on-disk image while the
    # DB rows describe two different attribute sets for one file). This was
    # already possible with the old synchronous endpoint (two rapid
    # double-clicks), but background jobs can now run for a long time,
    # turning a narrow timing accident into an easy-to-hit window — one tab
    # generating 5,000 items while a second tab (or a retried request)
    # starts another run on the same collection. Block it outright instead.
    has_active_job = (
        NFTGenerationJob.query.filter(
            NFTGenerationJob.collection_id == collection.id,
            NFTGenerationJob.status.in_((NFTGenerationJobStatus.QUEUED, NFTGenerationJobStatus.RUNNING)),
        ).first()
        is not None
    )
    if has_active_job:
        raise ConflictError("A generation job is already running for this collection")

    if not collection.layers or any(not layer.traits for layer in collection.layers):
        raise nft_generation.GenerationError("Every layer needs at least one trait before generating")

    max_combinations = nft_generation.max_possible_combinations(collection)
    if count > max_combinations:
        raise nft_generation.GenerationError(
            f"Requested {count} items but only {max_combinations} unique combinations are possible"
        )
    if count > nft_generation.MAX_ITEMS_PER_GENERATE_CALL:
        raise nft_generation.GenerationError(
            f"Generate at most {nft_generation.MAX_ITEMS_PER_GENERATE_CALL} items per call (requested {count})"
        )

    job = NFTGenerationJob(collection_id=collection.id, requested_count=count)
    db.session.add(job)
    db.session.commit()

    if app.testing:
        # Deterministic, synchronous execution in tests — same _run_job_body
        # code path as production, just not backgrounded, so a test can
        # assert on the finished job without polling or sleeping. Runs
        # directly in the caller's already-active app context/session —
        # see _run_job (the threaded entry point) for why this must NOT
        # also push a fresh app_context of its own here.
        _run_job_body(job.id, upload_folder)
    else:
        thread = threading.Thread(target=_run_job, args=(app, job.id, upload_folder), daemon=True)
        thread.start()

    return job


def _run_job(app: Flask, job_id: str, upload_folder: str) -> None:
    # Entry point for the real background thread only — pushes its own
    # fresh app context (Flask-SQLAlchemy's default scoped session is keyed
    # by thread id, so a new thread needs its own). create_job's inline
    # (app.testing) path calls _run_job_body directly instead of this,
    # deliberately *without* an extra app_context: since that path runs on
    # the SAME thread as the caller's already-active context, nesting a
    # second one here and letting it exit would fire Flask-SQLAlchemy's
    # teardown (db.session.remove()) on function return — which tears down
    # the *shared* thread-keyed session the outer (caller's) context is
    # still using too, detaching every object it already fetched. Confirmed
    # via a real DetachedInstanceError before this split existed.
    with app.app_context():
        _run_job_body(job_id, upload_folder)


def _run_job_body(job_id: str, upload_folder: str) -> None:
    job = db.session.get(NFTGenerationJob, job_id)
    if job is None:
        return
    job.status = NFTGenerationJobStatus.RUNNING
    db.session.commit()

    def _record_progress(items_generated: int) -> None:
        progress_job = db.session.get(NFTGenerationJob, job_id)
        progress_job.items_generated = items_generated
        db.session.commit()

    try:
        collection = db.session.get(NFTCollection, job.collection_id)
        items = nft_generation.generate_collection(
            collection, job.requested_count, upload_folder, on_item=_record_progress
        )
        job = db.session.get(NFTGenerationJob, job_id)
        job.items_generated = len(items)
        job.status = NFTGenerationJobStatus.DONE
        db.session.commit()
    except Exception as exc:  # noqa: BLE001 — recorded on the job; nothing else observes this thread
        db.session.rollback()
        job = db.session.get(NFTGenerationJob, job_id)
        job.status = NFTGenerationJobStatus.FAILED
        job.error = str(exc)
        db.session.commit()
