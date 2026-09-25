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
    # Token Metadata's is_mutable, inverted: once locked, name/symbol/URI can
    # never change again. Read from the chain (refresh_token_launch).
    metadata_locked = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
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
            "metadata_locked": self.metadata_locked,
            "explorer_url": self.explorer_url,
            "created_at": self.created_at.isoformat(),
        }


class SolanaPoolAction(db.Model):
    """One liquidity change on a launched token's Raydium pool (create,
    deposit or withdraw), recorded after services/solana_pools.py read the
    transaction back from the chain. Amounts are what the pool's own vaults
    gained or lost in that transaction, in base units (strings — u64)."""

    __tablename__ = "solana_pool_actions"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", name="fk_solana_pool_actions_user_id"), nullable=False, index=True)
    launch_id = db.Column(
        db.String(36),
        db.ForeignKey("solana_token_launches.id", name="fk_solana_pool_actions_launch_id"),
        nullable=False,
        index=True,
    )
    network = db.Column(db.String(32), nullable=False)
    pool_id = db.Column(db.String(64), nullable=False)
    kind = db.Column(db.String(16), nullable=False)  # 'create' | 'deposit' | 'withdraw'
    signature = db.Column(db.String(128), nullable=False, unique=True, index=True)
    wallet = db.Column(db.String(64), nullable=False)
    token_amount = db.Column(db.String(32), nullable=False)
    sol_amount = db.Column(db.String(32), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "launch_id": self.launch_id,
            "network": self.network,
            "pool_id": self.pool_id,
            "kind": self.kind,
            "signature": self.signature,
            "wallet": self.wallet,
            "token_amount": self.token_amount,
            "sol_amount": self.sol_amount,
            "created_at": self.created_at.isoformat(),
        }
