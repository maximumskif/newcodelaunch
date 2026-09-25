import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LiquidityProvision(db.Model):
    """One add-liquidity transaction for a token deployed here, recorded
    after services/liquidity.py read it back from the chain: sent by one of
    the account's wallets to the network's DEX router, and minting LP tokens
    on this token's pool. Amounts are what the pool actually received (the
    pair's Mint event), in base units, as strings — uint256 doesn't fit a
    BigInteger."""

    __tablename__ = "liquidity_provisions"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", name="fk_liquidity_provisions_user_id"), nullable=False, index=True)
    deployment_id = db.Column(
        db.String(36),
        db.ForeignKey("contract_deployments.id", name="fk_liquidity_provisions_deployment_id"),
        nullable=False,
        index=True,
    )
    network = db.Column(db.String(32), nullable=False)
    dex_name = db.Column(db.String(64), nullable=False)
    pair_address = db.Column(db.String(64), nullable=False)
    provider_address = db.Column(db.String(64), nullable=False)
    transaction_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    token_amount = db.Column(db.String(80), nullable=False)
    native_amount = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "deployment_id": self.deployment_id,
            "network": self.network,
            "dex_name": self.dex_name,
            "pair_address": self.pair_address,
            "provider_address": self.provider_address,
            "transaction_hash": self.transaction_hash,
            "token_amount": self.token_amount,
            "native_amount": self.native_amount,
            "created_at": self.created_at.isoformat(),
        }
