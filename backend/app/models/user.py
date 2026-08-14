import uuid
from datetime import datetime, timezone

from ..extensions import db


class Chain:
    EVM = "evm"
    SOLANA = "solana"

    ALL = (EVM, SOLANA)


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    wallet_address = db.Column(db.String(128), nullable=False, index=True)
    chain = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("wallet_address", "chain", name="uq_users_wallet_chain"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "wallet_address": self.wallet_address,
            "chain": self.chain,
            "created_at": self.created_at.isoformat(),
        }


class WalletNonce(db.Model):
    __tablename__ = "wallet_nonces"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    wallet_address = db.Column(db.String(128), nullable=False, index=True)
    chain = db.Column(db.String(16), nullable=False)
    nonce = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    consumed = db.Column(db.Boolean, default=False, nullable=False)
