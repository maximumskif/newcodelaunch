import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SolanaTokenLaunch(db.Model):
    """An SPL token the creator's own wallet created and paid for (Token
    Launchpad's Solana side). decimals/supply/authority fields are read back
    from the chain at record time (solana_tokens.record_token_launch), not
    taken from the client's request."""

    __tablename__ = "solana_token_launches"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    network = db.Column(db.String(32), nullable=False)
    # unique — same idempotent-retry guarantee as
    # candy_machine_deployments.candy_machine.
    mint_address = db.Column(db.String(64), nullable=False, unique=True, index=True)
    transaction_signature = db.Column(db.String(128), nullable=False, unique=True)
    creator_wallet = db.Column(db.String(64), nullable=False)

    name = db.Column(db.String(64), nullable=False)
    symbol = db.Column(db.String(16), nullable=False)
    decimals = db.Column(db.Integer, nullable=False)
    # Raw base units, as a string: a u64 doesn't fit a signed BIGINT.
    supply_raw = db.Column(db.String(32), nullable=False)
    metadata_uri = db.Column(db.String(256), nullable=True)
    mint_authority_revoked = db.Column(db.Boolean, nullable=False)
    freeze_authority_revoked = db.Column(db.Boolean, nullable=False)
    explorer_url = db.Column(db.String(256), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "network": self.network,
            "mint_address": self.mint_address,
            "transaction_signature": self.transaction_signature,
            "creator_wallet": self.creator_wallet,
            "name": self.name,
            "symbol": self.symbol,
            "decimals": self.decimals,
            "supply_raw": self.supply_raw,
            "metadata_uri": self.metadata_uri,
            "mint_authority_revoked": self.mint_authority_revoked,
            "freeze_authority_revoked": self.freeze_authority_revoked,
            "explorer_url": self.explorer_url,
            "created_at": self.created_at.isoformat(),
        }
