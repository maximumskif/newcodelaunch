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
from solders.pubkey import Pubkey

from ..extensions import db
from ..models.candy_machine import CandyMachineDeployment
from ..models.nft import NFTCollection
from . import blockchain, ipfs

SOLANA_NETWORKS = ("solana_devnet", "solana")


class ValidationError(ValueError):
    pass


class NotFoundError(ValueError):
    pass


class NotEligibleError(ValueError):
    """A mint request the drop's current phase doesn't allow — not live yet,
    or allowlist-only and this wallet isn't on the list."""


class CandyMachineServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


# Mirrors services/candy-machine/src/routes/candyMachine.ts's own MAX_ITEMS —
# checked here too so a too-large collection fails fast with a clean 422
# before ever calling the sidecar, instead of surfacing as an opaque 502.
MAX_ITEMS = 20

# Mirrors the sidecar's ALLOWLIST_GROUP / PUBLIC_GROUP / MAX_ALLOWLIST.
ALLOWLIST_GROUP = "wl"
PUBLIC_GROUP = "pub"
MAX_ALLOWLIST = 2000
LAMPORTS_PER_SOL = 1_000_000_000

PHASE_UPCOMING = "upcoming"
PHASE_ALLOWLIST = "allowlist"
PHASE_PUBLIC = "public"


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


def _validate_launch_inputs(collection: NFTCollection, network: str, price_sol: float) -> list:
    """Shared validation for both launch steps below. Both steps re-run this
    even though only prepare_candy_machine_step's transaction actually needs
    price_sol/the item list — prepare_collection validates it too so a
    creator who's about to fail step 2 (too many items, non-positive price)
    finds out before paying gas for the collection transaction, not after.
    See docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md."""
    if network not in SOLANA_NETWORKS:
        raise ValidationError(f"network must be one of: {', '.join(SOLANA_NETWORKS)}")
    if price_sol <= 0:
        raise ValidationError("price_sol must be a positive number")

    published_items = [item for item in collection.items if item.ipfs_metadata_hash]
    if not published_items:
        raise ValidationError("Publish at least one item to IPFS before launching a Candy Machine")
    if len(published_items) > MAX_ITEMS:
        raise ValidationError(f"At most {MAX_ITEMS} published items are supported per candy machine right now")
    return published_items


def _parse_iso(value: Any, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a valid ISO 8601 datetime") from exc
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def _validate_allowlist(allowlist: Any, go_live_date: str) -> dict[str, Any] | None:
    """Normalizes an optional allowlist phase, or raises ValidationError.
    Checked in both launch steps (like price) so a bad list fails before
    the creator pays for the collection transaction, not after."""
    if allowlist is None:
        return None
    if not isinstance(allowlist, dict):
        raise ValidationError("allowlist must be an object with addresses, price_sol and start_date")
    addresses = allowlist.get("addresses")
    if not isinstance(addresses, list) or not addresses or not all(isinstance(a, str) for a in addresses):
        raise ValidationError("allowlist.addresses must be a non-empty list of wallet addresses")
    addresses = [a.strip() for a in addresses]
    if len(addresses) > MAX_ALLOWLIST:
        raise ValidationError(f"An allowlist can hold at most {MAX_ALLOWLIST} wallets")
    if len(set(addresses)) != len(addresses):
        raise ValidationError("allowlist.addresses must not contain duplicates")
    for address in addresses:
        try:
            Pubkey.from_string(address)
        except ValueError as exc:
            raise ValidationError(f"Not a valid Solana wallet address: {address[:60]}") from exc
    try:
        price_sol = float(allowlist.get("price_sol"))
    except (TypeError, ValueError) as exc:
        raise ValidationError("allowlist.price_sol must be a number") from exc
    if not 0.000001 <= price_sol <= 1_000_000:
        raise ValidationError("allowlist.price_sol must be between 0.000001 and 1,000,000")
    start = _parse_iso(allowlist.get("start_date"), "allowlist.start_date")
    if start >= _parse_iso(go_live_date, "go_live_date"):
        raise ValidationError("The allowlist phase must start before the public phase")
    return {"addresses": addresses, "price_sol": price_sol, "start_date": start.isoformat()}


def prepare_collection(
    collection: NFTCollection,
    network: str,
    creator_wallet: str,
    price_sol: float,
    go_live_date: str,
    seller_fee_bps: int = 500,
    allowlist: Any = None,
) -> dict[str, Any]:
    """Step 1 of the two-step launch flow (see
    docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md): builds only the
    Collection-creation transaction, with its own fresh ephemeral signer and
    blockhash. price_sol/go_live_date aren't used to build this specific
    transaction — only prepare_candy_machine_step's Candy Machine creation
    needs them — but are validated here anyway via _validate_launch_inputs
    as a pre-flight check. Doesn't persist anything; that only happens once
    the creator's wallet has signed and sent every transaction from both
    steps, via `record_candy_machine`."""
    _validate_launch_inputs(collection, network, price_sol)
    _validate_allowlist(allowlist, go_live_date)
    if not (0 <= seller_fee_bps <= 10000):
        # 0-10000 basis points (0-100%) is the Royalties plugin's own valid
        # range on the sidecar — validated here too so a creator finds out
        # before paying gas for the collection transaction, not after a
        # confusing on-chain failure.
        raise ValidationError("seller_fee_bps must be between 0 and 10000")

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
    }

    return _sidecar_request("POST", "/internal/candy-machine/prepare-collection", json=payload, timeout=30)


def prepare_candy_machine_step(
    collection: NFTCollection,
    network: str,
    creator_wallet: str,
    collection_mint: str,
    price_sol: float,
    go_live_date: str,
    allowlist: Any = None,
) -> dict[str, Any]:
    """Step 2: builds the Candy Machine creation (+ config lines)
    transaction(s) against an already-created `collection_mint` (the result
    of `prepare_collection` above, only after the creator's wallet has
    signed, sent, and confirmed that transaction) — with their OWN fresh
    ephemeral signer and blockhash, generated now rather than back when
    `prepare_collection` ran. This gap is the actual fix for the
    blockhash-expiry issue: see docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md."""
    published_items = _validate_launch_inputs(collection, network, price_sol)
    phase = _validate_allowlist(allowlist, go_live_date)

    payload = {
        "network": _sidecar_network(network),
        "creatorPublicKey": creator_wallet,
        "collectionMint": collection_mint,
        "items": [
            {"name": f"{collection.name} #{item.token_index}", "uri": f"ipfs://{item.ipfs_metadata_hash}"}
            for item in published_items
        ],
        "priceSol": price_sol,
        "goLiveDate": go_live_date,
    }
    if phase:
        payload["allowlist"] = {
            "addresses": phase["addresses"],
            "priceSol": phase["price_sol"],
            "startDate": phase["start_date"],
        }

    return _sidecar_request("POST", "/internal/candy-machine/prepare-candy-machine", json=payload, timeout=30)


def _verify_guards_on_chain(
    network: str,
    candy_machine: str,
    creator_wallet: str,
    price_sol: float,
    go_live: datetime,
    allowlist: dict[str, Any] | None,
) -> None:
    """Reads the drop's guard configuration back from the chain and checks
    it's what's about to be recorded — prices, dates, where the proceeds go,
    and for an allowlist phase the merkle root of the claimed wallet list.
    Before this, record trusted the client's word for price and go-live
    date; with phases, a wrong stored allowlist would also hand buyers
    proofs that fail on-chain."""
    guards = _sidecar_request(
        "GET",
        f"/internal/candy-machine/{candy_machine}/guards",
        params={"network": _sidecar_network(network)},
        timeout=15,
    )

    def check(guard_set: dict[str, Any], label: str, price: float, start: datetime, end: datetime | None) -> None:
        def mismatch(field: str) -> ValidationError:
            return ValidationError(f"On-chain {label} guard doesn't match the launch being recorded: {field}")

        if guard_set.get("price_lamports") != str(round(price * LAMPORTS_PER_SOL)):
            raise mismatch("price")
        if guard_set.get("payment_destination") != creator_wallet:
            raise mismatch("payment destination")
        on_chain_start = guard_set.get("start_date")
        if on_chain_start is None or int(_parse_iso(on_chain_start, "start_date").timestamp()) != int(start.timestamp()):
            raise mismatch("start date")
        on_chain_end = guard_set.get("end_date")
        if end is None:
            if on_chain_end is not None:
                raise mismatch("end date")
        elif on_chain_end is None or int(_parse_iso(on_chain_end, "end_date").timestamp()) != int(end.timestamp()):
            raise mismatch("end date")

    groups = {group.get("label"): group for group in guards.get("groups", [])}
    if allowlist is None:
        if groups:
            raise ValidationError("On-chain guard has phases, but the launch being recorded has none")
        check(guards.get("default", {}), "public", price_sol, go_live, None)
        return

    if set(groups) != {ALLOWLIST_GROUP, PUBLIC_GROUP}:
        raise ValidationError("On-chain guard doesn't have the expected allowlist and public phases")
    check(groups[ALLOWLIST_GROUP], "allowlist", allowlist["price_sol"], _parse_iso(allowlist["start_date"], "start_date"), go_live)
    check(groups[PUBLIC_GROUP], "public", price_sol, go_live, None)
    expected_root = _sidecar_request(
        "POST", "/internal/candy-machine/merkle-root", json={"addresses": allowlist["addresses"]}, timeout=15
    )["merkle_root"]
    if groups[ALLOWLIST_GROUP].get("merkle_root") != expected_root:
        raise ValidationError("On-chain allowlist doesn't match the wallet list being recorded")


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
    allowlist: Any = None,
) -> CandyMachineDeployment:
    """Persist a candy machine the creator's own wallet already signed and
    sent, after independently confirming the last transaction actually
    landed — same pattern as contracts.record_deployment — and that its
    on-chain guard configuration is the one being recorded."""
    if network not in SOLANA_NETWORKS:
        raise ValidationError(f"network must be one of: {', '.join(SOLANA_NETWORKS)}")
    if not transaction_signatures:
        raise ValidationError("transaction_signatures must include at least one signature")
    try:
        parsed_go_live_date = datetime.fromisoformat(go_live_date)
    except (TypeError, ValueError) as exc:
        # Validated up front, before the on-chain re-verification call below —
        # a plain ValueError here used to reach mint/routes.py's
        # `except candy_machine.ValidationError`, which doesn't catch it,
        # producing an unhandled 500 *after* a real successful transaction
        # had already been independently confirmed. Same "fail fast on bad
        # input before doing real work" principle prepare_candy_machine_step
        # already applies to price/item-count.
        raise ValidationError(f"go_live_date must be a valid ISO 8601 datetime: {exc}") from exc

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
    #
    # Scoped to the SAME owner, though (same reasoning, and same bug class,
    # as contracts.record_deployment's transaction_hash check) — a Candy
    # Machine's on-chain address is public, so without this check, a caller
    # who happens to submit an address already recorded under a different
    # collection/user would get back — and could link into their own
    # project — a deployment row that isn't theirs.
    existing = CandyMachineDeployment.query.filter_by(candy_machine=candy_machine).first()
    if existing is not None:
        if existing.user_id != collection.user_id:
            raise ValidationError("This candy_machine has already been recorded under a different account")
        return existing

    phase = _validate_allowlist(allowlist, go_live_date)
    _verify_guards_on_chain(network, candy_machine, creator_wallet, price_sol, _parse_iso(go_live_date, "go_live_date"), phase)

    deployment = CandyMachineDeployment(
        user_id=collection.user_id,
        nft_collection_id=collection.id,
        network=network,
        collection_mint=collection_mint,
        candy_machine=candy_machine,
        price_sol=price_sol,
        items_available=items_available,
        go_live_date=parsed_go_live_date,
        allowlist=phase,
        prices_seen=_prices(price_sol, phase),
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


def _prices(price_sol: float, allowlist: dict[str, Any] | None) -> list[float]:
    return sorted({price_sol, *([allowlist["price_sol"]] if allowlist else [])})


def get_owned_deployment(deployment_id: str, user_id: str) -> CandyMachineDeployment:
    deployment = db.session.get(CandyMachineDeployment, deployment_id)
    if deployment is None or deployment.user_id != user_id:
        raise NotFoundError(f"Candy machine not found: {deployment_id}")
    return deployment


def _validate_phase_edit(price_sol: Any, go_live_date: Any, allowlist: Any) -> tuple[float, datetime, dict[str, Any] | None]:
    try:
        price = float(price_sol)
    except (TypeError, ValueError) as exc:
        raise ValidationError("price_sol must be a number") from exc
    if not 0.000001 <= price <= 1_000_000:
        raise ValidationError("price_sol must be between 0.000001 and 1,000,000")
    go_live = _parse_iso(go_live_date, "go_live_date")
    return price, go_live, _validate_allowlist(allowlist, go_live.isoformat())


def prepare_phase_update(
    deployment: CandyMachineDeployment, price_sol: Any, go_live_date: Any, allowlist: Any = None
) -> dict[str, Any]:
    """Builds the creator-signed transaction that replaces a live drop's
    phases (public price/start, and adding, changing or removing the
    allowlist phase). Persists nothing — apply_phase_update does, once the
    chain shows the new configuration."""
    price, go_live, phase = _validate_phase_edit(price_sol, go_live_date, allowlist)
    payload: dict[str, Any] = {
        "network": _sidecar_network(deployment.network),
        # The guard's authority — the only wallet whose signature the
        # program accepts for this (anyone else fails on-chain).
        "creatorPublicKey": deployment.creator_wallet,
        "priceSol": price,
        "goLiveDate": go_live.isoformat(),
    }
    if phase:
        payload["allowlist"] = {"addresses": phase["addresses"], "priceSol": phase["price_sol"], "startDate": phase["start_date"]}
    return _sidecar_request(
        "POST", f"/internal/candy-machine/{deployment.candy_machine}/prepare-update", json=payload, timeout=30
    )


def apply_phase_update(
    deployment: CandyMachineDeployment, transaction_signature: str, price_sol: Any, go_live_date: Any, allowlist: Any = None
) -> CandyMachineDeployment:
    """Records an edit the creator's wallet already sent — only once the
    transaction succeeded, was paid for by the creator, and the guard
    configuration now on-chain is exactly the claimed one (the same
    read-back check a launch goes through)."""
    price, go_live, phase = _validate_phase_edit(price_sol, go_live_date, allowlist)

    tx_status = blockchain.get_transaction_status(deployment.network, transaction_signature)
    if tx_status.get("status") != "success":
        raise ValidationError(f"Transaction is not a confirmed success on-chain (status: {tx_status.get('status')})")
    account_keys = tx_status.get("account_keys") or []
    if not account_keys or account_keys[0] != deployment.creator_wallet:
        raise ValidationError("The update transaction wasn't sent by this drop's creator wallet")

    _verify_guards_on_chain(deployment.network, deployment.candy_machine, deployment.creator_wallet, price, go_live, phase)

    previous = deployment.prices_seen or _prices(deployment.price_sol, deployment.allowlist)
    deployment.price_sol = price
    deployment.go_live_date = go_live
    deployment.allowlist = phase
    deployment.prices_seen = sorted({*previous, *_prices(price, phase)})
    # New list objects, not in-place appends: SQLAlchemy's plain JSON type
    # doesn't track mutation inside a list.
    deployment.transaction_signatures = [*deployment.transaction_signatures, transaction_signature]
    db.session.commit()
    return deployment


def current_phase(deployment: CandyMachineDeployment, now: datetime | None = None) -> str:
    """Which phase a drop is in right now — the same windows its on-chain
    guard groups enforce (allowlist: its start until go-live; public: from
    go-live on)."""
    now = now or datetime.now(timezone.utc)
    if now >= _as_utc(deployment.go_live_date):
        return PHASE_PUBLIC
    if deployment.allowlist and now >= _parse_iso(deployment.allowlist["start_date"], "start_date"):
        return PHASE_ALLOWLIST
    return PHASE_UPCOMING


def _as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes from timezone-aware columns — see
    # get_public_candy_machine_status's comment; every value here was
    # written as UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _live_counts(deployment: CandyMachineDeployment) -> dict[str, Any] | None:
    """On-chain minted/remaining for one drop, or None if the read failed —
    one unreachable drop mustn't take the whole dashboard down."""
    try:
        on_chain = _sidecar_request(
            "GET",
            f"/internal/candy-machine/{deployment.candy_machine}/status",
            params={"network": _sidecar_network(deployment.network)},
            timeout=15,
        )
    except CandyMachineServiceError:
        return None
    if not {"items_available", "items_redeemed", "items_remaining"} <= on_chain.keys():
        return None
    return on_chain


def get_creator_dashboard(user_id: str) -> dict[str, Any]:
    """Every drop the user launched, with live on-chain sales. Revenue is
    minted x price: the solPayment guard sends exactly the phase's price to
    the creator's wallet per mint, and there's no update-guard feature. A
    drop with an allowlist phase has two prices, and the chain doesn't
    record which phase each mint came through, so its revenue is a
    min-max range (equal ends for a single-price drop). Totals are per
    network — devnet SOL and mainnet SOL aren't the same money."""
    now = datetime.now(timezone.utc)
    drops = []
    totals: dict[str, dict[str, Any]] = {}
    for deployment in get_user_candy_machines(user_id):
        collection = db.session.get(NFTCollection, deployment.nft_collection_id)
        live = _live_counts(deployment)
        go_live = _as_utc(deployment.go_live_date)
        prices = deployment.prices_seen or _prices(deployment.price_sol, deployment.allowlist)
        redeemed = live["items_redeemed"] if live else None
        drop = {
            **deployment.to_dict(),
            "collection_name": collection.name if collection else None,
            "is_live": now >= go_live,
            "phase": current_phase(deployment, now),
            "live_status_available": live is not None,
            "items_redeemed": redeemed,
            "items_remaining": live["items_remaining"] if live else None,
            "revenue_min_sol": round(redeemed * min(prices), 9) if live else None,
            "revenue_max_sol": round(redeemed * max(prices), 9) if live else None,
        }
        drops.append(drop)
        if live:
            network_totals = totals.setdefault(
                deployment.network, {"drops": 0, "items_redeemed": 0, "revenue_min_sol": 0.0, "revenue_max_sol": 0.0}
            )
            network_totals["drops"] += 1
            network_totals["items_redeemed"] += redeemed
            network_totals["revenue_min_sol"] = round(network_totals["revenue_min_sol"] + drop["revenue_min_sol"], 9)
            network_totals["revenue_max_sol"] = round(network_totals["revenue_max_sol"] + drop["revenue_max_sol"], 9)
    return {"drops": drops, "totals_by_network": totals}


def _get_deployment_by_address(candy_machine_address: str) -> CandyMachineDeployment:
    deployment = CandyMachineDeployment.query.filter_by(candy_machine=candy_machine_address).first()
    if deployment is None:
        raise NotFoundError(f"No candy machine found for address: {candy_machine_address}")
    return deployment


def get_public_candy_machine_status(candy_machine_address: str, wallet: str | None = None) -> dict[str, Any]:
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
        **_phase_view(deployment, wallet),
        "explorer_url": deployment.explorer_url,
        "items_available": on_chain["items_available"],
        "items_redeemed": on_chain["items_redeemed"],
        "items_remaining": on_chain["items_remaining"],
    }


def _phase_view(deployment: CandyMachineDeployment, wallet: str | None) -> dict[str, Any]:
    """What a storefront visitor needs to know about the drop's phases —
    never the allowlist itself (on-chain there's only its merkle root), just
    its size and, for a given wallet, whether that wallet is on it."""
    phase = current_phase(deployment)
    allowlisted = wallet in deployment.allowlist["addresses"] if (deployment.allowlist and wallet) else None
    if phase == PHASE_ALLOWLIST:
        mint_price = deployment.allowlist["price_sol"] if allowlisted else None
    elif phase == PHASE_PUBLIC:
        mint_price = deployment.price_sol
    else:
        mint_price = None
    return {
        "phase": phase,
        "allowlist": deployment.to_dict()["allowlist"],
        "allowlisted": allowlisted,
        # The price this wallet would pay right now, or None if it can't mint now.
        "mint_price_sol": mint_price,
    }


def prepare_mint(candy_machine_address: str, minter_wallet: str) -> dict[str, Any]:
    """Builds a buyer's (unsigned/partially-signed) mint transaction. Like
    prepare_collection/prepare_candy_machine_step above, this doesn't
    persist anything — the buyer's own
    connected wallet signs and sends it directly; there's no backend
    record of individual mints, the candy machine's own on-chain
    items_redeemed count is the source of truth (see get_public_candy_machine_status)."""
    deployment = _get_deployment_by_address(candy_machine_address)

    payload: dict[str, Any] = {
        "network": _sidecar_network(deployment.network),
        "minterPublicKey": minter_wallet,
        "collectionMint": deployment.collection_mint,
        "creatorPublicKey": deployment.creator_wallet,
    }

    # Refuse up front what the on-chain guards would reject anyway, with a
    # message a visitor can act on instead of a failed wallet simulation.
    phase = current_phase(deployment)
    if phase == PHASE_UPCOMING:
        opens = deployment.allowlist["start_date"] if deployment.allowlist else _as_utc(deployment.go_live_date).isoformat()
        raise NotEligibleError(f"This drop isn't open yet — minting starts {opens}")
    if deployment.allowlist:
        if phase == PHASE_ALLOWLIST:
            if minter_wallet not in deployment.allowlist["addresses"]:
                raise NotEligibleError(
                    f"This drop is allowlist-only until {_as_utc(deployment.go_live_date).isoformat()}, "
                    "and this wallet isn't on the allowlist"
                )
            payload["group"] = ALLOWLIST_GROUP
            payload["allowlist"] = deployment.allowlist["addresses"]
        else:
            payload["group"] = PUBLIC_GROUP

    return _sidecar_request(
        "POST", f"/internal/candy-machine/{candy_machine_address}/mint", json=payload, timeout=30
    )
