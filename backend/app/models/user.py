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

    # No longer unique: wallet_address/chain are just the wallet that
    # created the account. Which account a wallet signs in to is decided by
    # wallet_identities (unique per wallet) — a wallet unlinked from one
    # account can then start a new account of its own.

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


class WalletIdentity(db.Model):
    """One wallet that can sign in to an account. An account (User) can hold
    one per chain family or several — sign in with any of them and it's the
    same account, with the same projects, collections, and launches. The
    User row's own wallet_address/chain stay as the wallet that created the
    account; every sign-in lookup goes through this table."""

    __tablename__ = "wallet_identities"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    wallet_address = db.Column(db.String(128), nullable=False)
    chain = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    # A wallet belongs to at most one account.
    __table_args__ = (db.UniqueConstraint("wallet_address", "chain", name="uq_wallet_identities_wallet_chain"),)

    def to_dict(self) -> dict:
        return {"wallet_address": self.wallet_address, "chain": self.chain, "linked_at": self.created_at.isoformat()}
