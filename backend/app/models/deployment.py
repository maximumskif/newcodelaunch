import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ContractDeployment(db.Model):
    __tablename__ = "contract_deployments"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)

    template_id = db.Column(db.String(64), nullable=False)
    template_name = db.Column(db.String(128), nullable=False)
    contract_type = db.Column(db.String(32), nullable=False)  # 'erc20' | 'erc721'

    network = db.Column(db.String(32), nullable=False)
    contract_address = db.Column(db.String(128), nullable=False, index=True)
    transaction_hash = db.Column(db.String(128), nullable=False)
    deployer_address = db.Column(db.String(128), nullable=False)

    parameters = db.Column(db.JSON, nullable=False, default=dict)
    gas_used = db.Column(db.BigInteger, nullable=True)
    deployment_cost_native = db.Column(db.Float, nullable=True)
    explorer_url = db.Column(db.String(256), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "template_id": self.template_id,
            "template_name": self.template_name,
            "contract_type": self.contract_type,
            "network": self.network,
            "contract_address": self.contract_address,
            "transaction_hash": self.transaction_hash,
            "deployer_address": self.deployer_address,
            "parameters": self.parameters,
            "gas_used": self.gas_used,
            "deployment_cost_native": self.deployment_cost_native,
            "explorer_url": self.explorer_url,
            "created_at": self.created_at.isoformat(),
        }
