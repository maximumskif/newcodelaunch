import uuid
from datetime import datetime, timezone

from ..extensions import db


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CandyMachineDeployment(db.Model):
    __tablename__ = "candy_machine_deployments"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    nft_collection_id = db.Column(db.String(36), db.ForeignKey("nft_collections.id"), nullable=False, index=True)

    network = db.Column(db.String(32), nullable=False)
    collection_mint = db.Column(db.String(64), nullable=False, index=True)
    # unique, not just indexed — record_candy_machine() relies on this to make a
    # client retry after a slow/dropped response idempotent instead of creating a
    # second row for the same on-chain address that _get_deployment_by_address()'s
    # .first() would then pick between non-deterministically.
    candy_machine = db.Column(db.String(64), nullable=False, unique=True, index=True)

    price_sol = db.Column(db.Float, nullable=False)
    items_available = db.Column(db.Integer, nullable=False)
    go_live_date = db.Column(db.DateTime(timezone=True), nullable=False)
    # Optional allowlist phase before go_live_date (a second guard group,
    # see services/candy-machine's /prepare-candy-machine):
    # {"addresses": [...], "price_sol": float, "start_date": iso}. price_sol
    # and go_live_date above are the public phase. Checked against the
    # on-chain guard at record time; the address list is never exposed by
    # to_dict (only its size) — on-chain there's only a merkle root.
    allowlist = db.Column(db.JSON, nullable=True)
    # Every per-mint price this drop has ever had (public and allowlist,
    # across phase edits). The chain doesn't record which price each past
    # mint paid, so the dashboard's revenue range spans all of these — an
    # edit mustn't make earlier sales look like they happened at the new
    # price. Null on rows from before phase editing: fall back to the
    # current prices, which were then the only ones.
    prices_seen = db.Column(db.JSON, nullable=True)
    # Optional per-wallet mint limit across all phases (the mintLimit guard,
    # in the default guard set). Checked against the chain like the rest.
    mint_limit = db.Column(db.Integer, nullable=True)

    creator_wallet = db.Column(db.String(64), nullable=False)
    transaction_signatures = db.Column(db.JSON, nullable=False, default=list)
    explorer_url = db.Column(db.String(256), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "nft_collection_id": self.nft_collection_id,
            "network": self.network,
            "collection_mint": self.collection_mint,
            "candy_machine": self.candy_machine,
            "price_sol": self.price_sol,
            "items_available": self.items_available,
            "go_live_date": self.go_live_date.isoformat(),
            "allowlist": (
                {
                    "price_sol": self.allowlist["price_sol"],
                    "start_date": self.allowlist["start_date"],
                    "size": len(self.allowlist["addresses"]),
                }
                if self.allowlist
                else None
            ),
            "mint_limit": self.mint_limit,
            "creator_wallet": self.creator_wallet,
            "transaction_signatures": self.transaction_signatures,
            "explorer_url": self.explorer_url,
            "created_at": self.created_at.isoformat(),
        }
