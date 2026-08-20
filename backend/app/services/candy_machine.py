"""
Backend orchestration for the Candy Machine "creator flow" (Phase 6).

Talks to the services/candy-machine sidecar over a shared secret to build
real, partially-signed Umi transactions — see that service's
src/routes/candyMachine.ts for why they're only partially signed. The
creator's own connected wallet completes the missing signature and sends
each transaction client-side; this backend and the sidecar never hold the
creator's key or gain ongoing authority over the collection/candy machine.

This module covers both sides of the flow now: the creator launching a
drop from an already-published NFT collection, and the public storefront
(any visitor, no account needed) reading live status and building a mint
transaction for their own wallet. See docs/REBUILD_PROGRESS.md.
"""

from __future__ import annotations

from datetime import datetime, timezone
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


class NotFoundError(ValueError):
    pass


class CandyMachineServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


# Mirrors services/candy-machine/src/routes/candyMachine.ts's own MAX_ITEMS —
# checked here too so a too-large collection fails fast with a clean 422
# before ever calling the sidecar, instead of surfacing as an opaque 502.
MAX_ITEMS = 20


def _sidecar_headers() -> dict[str, str]:
    secret = current_app.config.get("CANDY_MACHINE_SHARED_SECRET")
    if not secret:
        raise CandyMachineServiceError("CANDY_MACHINE_SHARED_SECRET is not configured")
    return {"x-internal-secret": secret}


def _sidecar_request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
    timeout: int,
) -> dict[str, Any]:
    """Shared request/error-handling for every call into services/candy-machine
    — used to be duplicated identically across prepare_candy_machine,
    get_public_candy_machine_status, and prepare_mint. Dispatches to
    requests.get/requests.post specifically (not requests.request) so tests
    can keep monkeypatching candy_machine.requests.get/.post directly."""
    service_url = current_app.config["CANDY_MACHINE_SERVICE_URL"]
    url = f"{service_url}{path}"
    headers = _sidecar_headers()
    try:
        if method == "GET":
            response = requests.get(url, params=params, headers=headers, timeout=timeout)
        elif method == "POST":
            response = requests.post(url, json=json, headers=headers, timeout=timeout)
        else:
            raise ValueError(f"Unsupported sidecar request method: {method}")
    except requests.RequestException as exc:
        raise CandyMachineServiceError(f"Candy Machine service request failed: {exc}") from exc

    if response.status_code != 200:
        raise CandyMachineServiceError(
            f"Candy Machine service returned {response.status_code}: {response.text}",
            status_code=response.status_code,
        )

    return response.json()


def _derive_symbol(name: str) -> str:
    alnum = "".join(ch for ch in name.upper() if ch.isalnum())
    return (alnum or "NFT")[:10]


def _explorer_url(network: str, candy_machine: str) -> str:
    base = f"{blockchain.SOLANA_NETWORKS[network]['explorer_url']}/address/{candy_machine}"
    return f"{base}?cluster=devnet" if network == "solana_devnet" else base


# This backend/DB's network ids (solana_devnet/solana, matching the EVM
# side's naming convention) aren't the sidecar's own network ids
# (devnet/mainnet-beta — Solana CLI/RPC cluster names). Found while adding
# the public mint storefront: prepare_candy_machine was sending the
# backend's own id straight through unmapped, which the sidecar's
# isSolanaNetwork() would reject outright — every /prepare call against a
# real sidecar would have 400'd. Centralized the mapping here so it can't
# drift between the two calls that need it (prepare + the new status/mint
# calls added for the storefront).
_SIDECAR_NETWORK_IDS = {"solana_devnet": "devnet", "solana": "mainnet-beta"}


def _sidecar_network(network: str) -> str:
    try:
        return _SIDECAR_NETWORK_IDS[network]
    except KeyError:
        # Every caller today validates `network` against SOLANA_NETWORKS before
        # it reaches here (prepare_candy_machine, record_candy_machine) or reads
        # it back from a row that was already validated at write time — so this
        # is currently unreachable. Kept as a clean CandyMachineServiceError
        # (502, matches every other sidecar-facing failure in this module)
        # rather than an uncaught KeyError, in case a future network is ever
        # added to one list and not the other, or a row is written by a path
        # that bypasses validation.
        raise CandyMachineServiceError(f"No sidecar network mapping for '{network}'") from None


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
    if len(published_items) > MAX_ITEMS:
        raise ValidationError(f"At most {MAX_ITEMS} published items are supported per candy machine right now")

    collection_metadata = ipfs.upload_json(
        {
            "name": collection.name,
            "description": collection.description,
            "seller_fee_basis_points": seller_fee_bps,
        },
        f"{collection.name.replace(' ', '_')}_collection.json",
    )

    payload = {
        "network": _sidecar_network(network),
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

    return _sidecar_request("POST", "/internal/candy-machine/prepare", json=payload, timeout=30)


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

    # A successful signature alone isn't enough — confirm it's actually a
    # transaction that touched the claimed `candy_machine` account, not an
    # unrelated successful signature paired with an arbitrary address. Only
    # candy_machine is checked (not collection_mint): the last transaction
    # in the sequence is always one that references the candy machine
    # (create, or a later config-lines-insert if split into its own tx), but
    # collection_mint only appears in the earlier collection-creation
    # transaction, which may not be the last one signed.
    account_keys = tx_status.get("account_keys") or []
    if candy_machine not in account_keys:
        raise ValidationError("The confirmed transaction does not reference the given candy_machine address")

    # Idempotent: a client retry after a slow/dropped response to a request that
    # actually succeeded server-side must not create a second row for the same
    # on-chain candy_machine — return the existing record rather than relying on
    # the DB's unique constraint to reject it as an unhandled 500.
    existing = CandyMachineDeployment.query.filter_by(candy_machine=candy_machine).first()
    if existing is not None:
        return existing

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


def _get_deployment_by_address(candy_machine_address: str) -> CandyMachineDeployment:
    deployment = CandyMachineDeployment.query.filter_by(candy_machine=candy_machine_address).first()
    if deployment is None:
        raise NotFoundError(f"No candy machine found for address: {candy_machine_address}")
    return deployment


def get_public_candy_machine_status(candy_machine_address: str) -> dict[str, Any]:
    """Public (unauthenticated) storefront data for an already-launched
    candy machine. Combines what the creator's own launch already recorded
    — price, go-live date, collection name/description/preview — with a
    fresh on-chain read of items_redeemed, which only exists on-chain and
    changes with every mint, unlike everything else here (there's no
    update-guard feature, so price/go-live/creator can't have drifted)."""
    deployment = _get_deployment_by_address(candy_machine_address)
    collection = db.session.get(NFTCollection, deployment.nft_collection_id)

    on_chain = _sidecar_request(
        "GET",
        f"/internal/candy-machine/{candy_machine_address}/status",
        params={"network": _sidecar_network(deployment.network)},
        timeout=15,
    )
    missing_keys = {"items_available", "items_redeemed", "items_remaining"} - on_chain.keys()
    if missing_keys:
        raise CandyMachineServiceError(
            f"Candy Machine service /status response is missing expected field(s): {', '.join(sorted(missing_keys))}"
        )

    preview_image = None
    if collection is not None:
        published = next((item for item in collection.items if item.ipfs_image_hash), None)
        if published is not None:
            preview_image = f"{ipfs.PINATA_GATEWAY}{published.ipfs_image_hash}"

    # SQLite (this test suite's DB) returns a naive datetime.datetime from a
    # `DateTime(timezone=True)` column even though it was written aware —
    # SQLite has no native tz-aware storage, so SQLAlchemy's sqlite dialect
    # silently drops tzinfo on the way back out (Postgres, this app's real
    # target, doesn't have this problem). A naive value here was always
    # written as UTC (see models/candy_machine.py's `_utcnow` and
    # `record_candy_machine`'s `datetime.fromisoformat`), so it's safe to
    # assume UTC rather than let a naive/aware comparison raise TypeError.
    go_live_date = deployment.go_live_date
    if go_live_date.tzinfo is None:
        go_live_date = go_live_date.replace(tzinfo=timezone.utc)

    return {
        "candy_machine": deployment.candy_machine,
        "collection_mint": deployment.collection_mint,
        "network": deployment.network,
        "collection_name": collection.name if collection else None,
        "collection_description": collection.description if collection else None,
        "preview_image": preview_image,
        "price_sol": deployment.price_sol,
        "go_live_date": go_live_date.isoformat(),
        "is_live": datetime.now(timezone.utc) >= go_live_date,
        "explorer_url": deployment.explorer_url,
        "items_available": on_chain["items_available"],
        "items_redeemed": on_chain["items_redeemed"],
        "items_remaining": on_chain["items_remaining"],
    }


def prepare_mint(candy_machine_address: str, minter_wallet: str) -> dict[str, Any]:
    """Builds a buyer's (unsigned/partially-signed) mint transaction. Like
    prepare_candy_machine, this doesn't persist anything — the buyer's own
    connected wallet signs and sends it directly; there's no backend
    record of individual mints, the candy machine's own on-chain
    items_redeemed count is the source of truth (see get_public_candy_machine_status)."""
    deployment = _get_deployment_by_address(candy_machine_address)

    payload = {
        "network": _sidecar_network(deployment.network),
        "minterPublicKey": minter_wallet,
        "collectionMint": deployment.collection_mint,
        "creatorPublicKey": deployment.creator_wallet,
    }

    return _sidecar_request(
        "POST", f"/internal/candy-machine/{candy_machine_address}/mint", json=payload, timeout=30
    )
