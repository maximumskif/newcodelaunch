"""Flask CLI commands — maintenance tasks with no HTTP surface of their own."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import click
from flask import current_app
from flask.cli import with_appcontext

from .extensions import db
from .models.nft import NFTGenerationJob, NFTGenerationJobStatus
from .models.user import WalletNonce


@click.command("prune-nonces")
@with_appcontext
def prune_nonces_command() -> None:
    """Delete WalletNonce rows that can never authenticate again.

    /api/auth/verify only filters expired/consumed nonces out of its query
    — nothing in the request path ever deletes a row, so without running
    this on a schedule (e.g. a daily cron calling `flask prune-nonces`),
    the table grows forever under normal use.
    """
    ttl = current_app.config["WALLET_NONCE_TTL_SECONDS"]
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=ttl)
    deleted = WalletNonce.query.filter(
        db.or_(WalletNonce.consumed.is_(True), WalletNonce.created_at < cutoff)
    ).delete(synchronize_session=False)
    db.session.commit()
    click.echo(f"Deleted {deleted} expired/consumed wallet nonce(s).")


@click.command("reap-stale-generation-jobs")
@with_appcontext
def reap_stale_generation_jobs_command() -> None:
    """Fail any NFT generation job stuck "queued"/"running" with no progress.

    nft_generation_jobs.py runs generation in a plain thread within one
    gunicorn worker process, not a broker-backed queue — documented there as
    a real trade-off: if that worker is killed or restarts mid-run (a
    deploy, an OOM), the job's row is left at "running" forever with nothing
    to notice and requeue it. `updated_at` (bumped on every per-item commit,
    see nft_generation_jobs._run_job_body's on_item callback) is the
    liveness signal; a job that hasn't moved in
    NFT_GENERATION_JOB_STALE_SECONDS is almost certainly an abandoned one,
    not just a slow one. Marking it failed (rather than silently deleting
    it) also clears nft_generation_jobs.create_job's one-active-job-per-
    collection guard, so the collection isn't permanently stuck. Intended to
    run on a schedule (e.g. every few minutes via cron), same as
    prune-nonces above.
    """
    stale_seconds = current_app.config["NFT_GENERATION_JOB_STALE_SECONDS"]
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_seconds)
    stuck_jobs = NFTGenerationJob.query.filter(
        NFTGenerationJob.status.in_((NFTGenerationJobStatus.QUEUED, NFTGenerationJobStatus.RUNNING)),
        NFTGenerationJob.updated_at < cutoff,
    ).all()
    for job in stuck_jobs:
        job.status = NFTGenerationJobStatus.FAILED
        job.error = (
            f"No progress for over {stale_seconds}s — the worker running this job likely died "
            "mid-run. Marked failed so this collection can be regenerated."
        )
    db.session.commit()
    click.echo(f"Reaped {len(stuck_jobs)} stale generation job(s).")


def register_cli(app) -> None:
    app.cli.add_command(prune_nonces_command)
    app.cli.add_command(reap_stale_generation_jobs_command)
