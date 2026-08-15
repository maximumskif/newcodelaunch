"""
Backend orchestration for the Candy Machine "creator flow" (Phase 6).

Talks to the services/candy-machine sidecar over a shared secret to build
real, partially-signed Umi transactions — see that service's
src/routes/candyMachine.ts for why they're only partially signed. The
creator's own connected wallet completes the missing signature and sends
each transaction client-side; this backend and the sidecar never hold the
creator's key or gain ongoing authority over the collection/candy machine.

This module intentionally only covers the creator side (launching a drop
from an already-published NFT collection) — building a buyer's mint
transaction is a distinct, not-yet-built flow (the public mint-site
storefront), see docs/REBUILD_PROGRESS.md.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import requests
from flask import current_app

from ..extensions import db
from ..models.candy_machine import CandyMachineDeployment
from ..models.nft import NFTCollection
from . import blockchain, ipfs

SOLANA_NETWORKS = ("solana_devnet", "solana")


class ValidationError(ValueError):
    pass


class CandyMachineServiceError(RuntimeError):
    pass


def _sidecar_headers() -> dict[str, str]:
    secret = current_app.config.get("CANDY_MACHINE_SHARED_SECRET")
    if not secret:
        raise CandyMachineServiceError("CANDY_MACHINE_SHARED_SECRET is not configured")
    return {"x-internal-secret": secret}


def _derive_symbol(name: str) -> str:
    alnum = "".join(ch for ch in name.upper() if ch.isalnum())
    return (alnum or "NFT")[:10]


def _explorer_url(network: str, candy_machine: str) -> str:
    base = f"{blockchain.SOLANA_NETWORKS[network]['explorer_url']}/address/{candy_machine}"
    return f"{base}?cluster=devnet" if network == "solana_devnet" else base


def prepare_candy_machine(
    collection: NFTCollection,
    network: str,
    creator_wallet: str,
    price_sol: float,
    go_live_date: str,
    seller_fee_bps: int = 500,
) -> dict[str, Any]:
    """Builds the unsigned/partially-signed transactions for launching a
    drop from `collection`. Doesn't persist anything — that only happens
    once the creator's wallet has actually signed and sent them, via
    `record_candy_machine`."""
    if network not in SOLANA_NETWORKS:
        raise ValidationError(f"network must be one of: {', '.join(SOLANA_NETWORKS)}")
    if price_sol <= 0:
        raise ValidationError("price_sol must be a positive number")

    published_items = [item for item in collection.items if item.ipfs_metadata_hash]
    if not published_items:
        raise ValidationError("Publish at least one item to IPFS before launching a Candy Machine")

    collection_metadata = ipfs.upload_json(
        {
            "name": collection.name,
            "description": collection.description,
            "seller_fee_basis_points": seller_fee_bps,
        },
        f"{collection.name.replace(' ', '_')}_collection.json",
    )

    payload = {
        "network": network,
        "creatorPublicKey": creator_wallet,
        "collectionName": collection.name,
        "collectionSymbol": _derive_symbol(collection.name),
        "collectionMetadataUri": collection_metadata["url"],
        "sellerFeeBasisPoints": seller_fee_bps,
        "items": [
            {"name": f"{collection.name} #{item.token_index}", "uri": f"ipfs://{item.ipfs_metadata_hash}"}
            for item in published_items
        ],
        "priceSol": price_sol,
        "goLiveDate": go_live_date,
    }

    service_url = current_app.config["CANDY_MACHINE_SERVICE_URL"]
    try:
        response = requests.post(
            f"{service_url}/internal/candy-machine/prepare",
            json=payload,
            headers=_sidecar_headers(),
            timeout=30,
        )
    except requests.RequestException as exc:
        raise CandyMachineServiceError(f"Candy Machine service request failed: {exc}") from exc

    if response.status_code != 200:
        raise CandyMachineServiceError(f"Candy Machine service returned {response.status_code}: {response.text}")

    return response.json()


def record_candy_machine(
    collection: NFTCollection,
    network: str,
    collection_mint: str,
    candy_machine: str,
    transaction_signatures: list[str],
    price_sol: float,
    items_available: int,
    go_live_date: str,
    creator_wallet: str,
) -> CandyMachineDeployment:
    """Persist a candy machine the creator's own wallet already signed and
    sent, after independently confirming the last transaction actually
    landed — same pattern as contracts.record_deployment."""
    if network not in SOLANA_NETWORKS:
        raise ValidationError(f"network must be one of: {', '.join(SOLANA_NETWORKS)}")
    if not transaction_signatures:
        raise ValidationError("transaction_signatures must include at least one signature")

    last_signature = transaction_signatures[-1]
    tx_status = blockchain.get_transaction_status(network, last_signature)
    if tx_status.get("status") != "success":
        raise ValidationError(
            f"Transaction is not a confirmed success on-chain (status: {tx_status.get('status')})"
        )

    deployment = CandyMachineDeployment(
        user_id=collection.user_id,
        nft_collection_id=collection.id,
        network=network,
        collection_mint=collection_mint,
        candy_machine=candy_machine,
        price_sol=price_sol,
        items_available=items_available,
        go_live_date=datetime.fromisoformat(go_live_date),
        creator_wallet=creator_wallet,
        transaction_signatures=transaction_signatures,
        explorer_url=_explorer_url(network, candy_machine),
    )
    db.session.add(deployment)
    db.session.commit()
    return deployment


def get_user_candy_machines(user_id: str) -> list[CandyMachineDeployment]:
    return (
        CandyMachineDeployment.query.filter_by(user_id=user_id)
        .order_by(CandyMachineDeployment.created_at.desc())
        .all()
    )
