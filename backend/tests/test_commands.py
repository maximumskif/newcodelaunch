from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.models.user import WalletNonce


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
