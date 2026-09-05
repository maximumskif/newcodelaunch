"""Flask CLI commands — maintenance tasks with no HTTP surface of their own."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import click
from flask import current_app
from flask.cli import with_appcontext

from .extensions import db
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


def register_cli(app) -> None:
    app.cli.add_command(prune_nonces_command)
