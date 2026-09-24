"""
Token Launchpad's Solana side: SPL tokens with Metaplex Token Metadata.

Same shape as the Candy Machine creator flow (candy_machine.py): the
services/candy-machine sidecar builds a partially-signed transaction (see
its src/routes/token.ts), the creator's own connected wallet signs, pays
for, and sends it client-side, and only then is it recorded here — after
this backend independently confirms on-chain that it landed. Neither this
backend nor the sidecar ever holds the creator's key or keeps any authority
over the token.
"""

from __future__ import annotations

import io
from typing import Any, Optional

from PIL import Image, UnidentifiedImageError

from ..extensions import db
from ..models.solana_token import SolanaTokenLaunch
from . import blockchain, ipfs
from .candy_machine import SOLANA_NETWORKS, _sidecar_network, _sidecar_request

# Token Metadata's on-chain limits, mirrored in the sidecar — checked here
# first so bad input fails before anything is pinned to IPFS.
MAX_NAME_BYTES = 32
MAX_SYMBOL_BYTES = 10
MAX_DECIMALS = 9
U64_MAX = 2**64 - 1

MAX_LOGO_BYTES = 2 * 1024 * 1024
# Detected from the file's actual bytes (Pillow), not its extension — these
# are the formats wallets and explorers reliably render as a token logo.
ALLOWED_LOGO_FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp", "GIF": "gif"}


class ValidationError(ValueError):
    pass


class NotFoundError(ValueError):
    pass


def _utf8_len(value: str) -> int:
    return len(value.encode("utf-8"))


def _validate_network(network: str) -> None:
    if network not in SOLANA_NETWORKS:
        raise ValidationError(f"network must be one of: {', '.join(SOLANA_NETWORKS)}")


def _raw_amount(supply: str, decimals: int) -> int:
    """Whole-token supply -> raw base units (supply x 10^decimals), the
    number the SPL mint actually stores. Rejects anything that doesn't fit
    the mint's u64 — e.g. 20 billion tokens at 9 decimals doesn't."""
    if not isinstance(supply, str) or not supply.isdigit() or int(supply) <= 0:
        raise ValidationError("supply must be a positive whole number of tokens")
    amount = int(supply) * 10**decimals
    if amount > U64_MAX:
        max_supply = U64_MAX // 10**decimals
        raise ValidationError(f"supply is too large for {decimals} decimals (max {max_supply:,} tokens)")
    return amount


def _validate_logo(image_bytes: bytes) -> str:
    if len(image_bytes) > MAX_LOGO_BYTES:
        raise ValidationError(f"Logo must be at most {MAX_LOGO_BYTES // (1024 * 1024)} MB")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image_format = image.format
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValidationError("Logo isn't a readable image file") from exc
    if image_format not in ALLOWED_LOGO_FORMATS:
        raise ValidationError(f"Logo must be one of: {', '.join(sorted(ALLOWED_LOGO_FORMATS))}")
    return ALLOWED_LOGO_FORMATS[image_format]


def _pin_metadata(name: str, symbol: str, description: str, logo: Optional[bytes]) -> str:
    """Pins the off-chain metadata JSON wallets/explorers read a token's
    description and logo from. Gateway (https) URLs rather than ipfs:// for
    both the JSON and its image: unlike NFT marketplaces, plenty of wallets
    and token lists fetch a fungible token's URI over plain HTTP."""
    metadata: dict[str, Any] = {"name": name, "symbol": symbol, "description": description}
    slug = "".join(ch for ch in symbol if ch.isalnum()) or "token"
    if logo is not None:
        extension = _validate_logo(logo)
        metadata["image"] = ipfs.upload_file(logo, f"{slug}_logo.{extension}")["gateway_url"]
    return ipfs.upload_json(metadata, f"{slug}_token_metadata.json")["gateway_url"]


def prepare_token_launch(
    network: str,
    creator_wallet: str,
    name: str,
    symbol: str,
    decimals: int,
    supply: str,
    description: str = "",
    logo: Optional[bytes] = None,
    revoke_mint_authority: bool = True,
    revoke_freeze_authority: bool = True,
) -> dict[str, Any]:
    """Validates, pins metadata (only if there's a description or logo to
    pin — a bare name/symbol token needs no IPFS at all), and asks the
    sidecar for the partially-signed creation transaction. Persists
    nothing: that's record_token_launch, after the wallet has sent it."""
    _validate_network(network)
    name = (name or "").strip()
    symbol = (symbol or "").strip()
    description = (description or "").strip()
    if not name or _utf8_len(name) > MAX_NAME_BYTES:
        raise ValidationError(f"name is required and must be at most {MAX_NAME_BYTES} bytes")
    if not symbol or _utf8_len(symbol) > MAX_SYMBOL_BYTES:
        raise ValidationError(f"symbol is required and must be at most {MAX_SYMBOL_BYTES} bytes")
    if not isinstance(decimals, int) or isinstance(decimals, bool) or not 0 <= decimals <= MAX_DECIMALS:
        raise ValidationError(f"decimals must be a whole number between 0 and {MAX_DECIMALS}")
    amount = _raw_amount(supply, decimals)
    if logo is not None:
        # Validate before pinning anything, so a bad logo doesn't leave an
        # orphaned pin behind.
        _validate_logo(logo)

    metadata_uri = _pin_metadata(name, symbol, description, logo) if (description or logo is not None) else ""

    result = _sidecar_request(
        "POST",
        "/internal/token/prepare",
        json={
            "network": _sidecar_network(network),
            "creatorPublicKey": creator_wallet,
            "name": name,
            "symbol": symbol,
            "metadataUri": metadata_uri,
            "decimals": decimals,
            "amount": str(amount),
            "revokeMintAuthority": revoke_mint_authority,
            "revokeFreezeAuthority": revoke_freeze_authority,
        },
        timeout=30,
    )
    return {"mint": result["mint"], "transaction": result["transaction"], "metadata_uri": metadata_uri}


def _explorer_url(network: str, mint_address: str) -> str:
    base = f"{blockchain.SOLANA_NETWORKS[network]['explorer_url']}/address/{mint_address}"
    return f"{base}?cluster=devnet" if network == "solana_devnet" else base


def record_token_launch(
    user_id: str,
    network: str,
    mint_address: str,
    transaction_signature: str,
    creator_wallet: str,
    name: str,
    symbol: str,
    metadata_uri: str = "",
) -> SolanaTokenLaunch:
    """Persists a token launch only after confirming on-chain that the
    transaction succeeded, was paid for by `creator_wallet` (the fee payer
    is always account key 0), and touched `mint_address` — then reads the
    mint account itself for decimals/supply/authorities, rather than
    trusting the request for any of those."""
    _validate_network(network)

    tx_status = blockchain.get_transaction_status(network, transaction_signature)
    if tx_status.get("status") != "success":
        raise ValidationError(f"Transaction is not a confirmed success on-chain (status: {tx_status.get('status')})")
    account_keys = tx_status.get("account_keys") or []
    if not account_keys or account_keys[0] != creator_wallet:
        raise ValidationError("The confirmed transaction was not paid for by the given creator_wallet")
    if mint_address not in account_keys:
        raise ValidationError("The confirmed transaction does not reference the given mint_address")

    # Idempotent retry, scoped to the same owner — same reasoning as
    # candy_machine.record_candy_machine: a mint address is public.
    existing = SolanaTokenLaunch.query.filter_by(mint_address=mint_address).first()
    if existing is not None:
        if existing.user_id != user_id:
            raise ValidationError("This mint_address has already been recorded under a different account")
        return existing

    mint = blockchain.get_solana_mint_info(network, mint_address)
    if mint.get("status") != "success":
        raise ValidationError(f"mint_address is not a readable SPL mint on-chain (status: {mint.get('status')})")

    launch = SolanaTokenLaunch(
        user_id=user_id,
        network=network,
        mint_address=mint_address,
        transaction_signature=transaction_signature,
        creator_wallet=creator_wallet,
        name=(name or "").strip()[:64],
        symbol=(symbol or "").strip()[:16],
        decimals=mint["decimals"],
        supply_raw=mint["supply"],
        metadata_uri=metadata_uri or None,
        mint_authority_revoked=mint["mint_authority"] is None,
        freeze_authority_revoked=mint["freeze_authority"] is None,
        explorer_url=_explorer_url(network, mint_address),
    )
    db.session.add(launch)
    db.session.commit()
    return launch


def get_user_token_launches(user_id: str) -> list[SolanaTokenLaunch]:
    return (
        SolanaTokenLaunch.query.filter_by(user_id=user_id).order_by(SolanaTokenLaunch.created_at.desc()).all()
    )


# --- owner tools for a launched token ----------------------------------------

TOKEN_ACTIONS = ("mint", "revokeMint", "revokeFreeze")


def get_owned_launch(launch_id: str, user_id: str) -> SolanaTokenLaunch:
    launch = db.session.get(SolanaTokenLaunch, launch_id)
    if launch is None or launch.user_id != user_id:
        raise NotFoundError(f"Token launch not found: {launch_id}")
    return launch


def _live_mint(launch: SolanaTokenLaunch) -> dict[str, Any]:
    mint = blockchain.get_solana_mint_info(launch.network, launch.mint_address)
    if mint.get("status") != "success":
        raise ValidationError(f"Couldn't read the mint on-chain right now (status: {mint.get('status')})")
    return mint


def refresh_token_launch(launch: SolanaTokenLaunch) -> dict[str, Any]:
    """Re-reads the mint account and updates what's shown — supply and
    whether each authority still exists. No client input involved: the
    chain is the source of truth, so this is safe to call any time (the
    Manage panel calls it after every owner action). Also returns the
    current authority addresses, which may differ from the launch-time
    creator if an authority was transferred outside this app."""
    mint = _live_mint(launch)
    launch.decimals = mint["decimals"]
    launch.supply_raw = mint["supply"]
    launch.mint_authority_revoked = mint["mint_authority"] is None
    launch.freeze_authority_revoked = mint["freeze_authority"] is None
    db.session.commit()
    return {"token": launch.to_dict(), "mint_authority": mint["mint_authority"], "freeze_authority": mint["freeze_authority"]}


def prepare_token_action(launch: SolanaTokenLaunch, action: str, amount: Optional[str] = None) -> dict[str, Any]:
    """Builds an owner action for the current on-chain authority's wallet to
    sign: mint more (whole tokens, into that wallet), or revoke the mint or
    freeze authority for good. Persists nothing — refresh_token_launch
    re-reads the chain once the transaction has landed."""
    if action not in TOKEN_ACTIONS:
        raise ValidationError(f"action must be one of: {', '.join(TOKEN_ACTIONS)}")
    mint = _live_mint(launch)
    authority = mint["freeze_authority"] if action == "revokeFreeze" else mint["mint_authority"]
    if authority is None:
        raise ValidationError(
            "This token's supply is already fixed — its mint authority was revoked"
            if action != "revokeFreeze"
            else "This token's freeze authority is already revoked"
        )

    payload: dict[str, Any] = {"network": _sidecar_network(launch.network), "authorityPublicKey": authority, "action": action}
    if action == "mint":
        raw = _raw_amount(amount or "", mint["decimals"])
        if int(mint["supply"]) + raw > U64_MAX:
            max_more = (U64_MAX - int(mint["supply"])) // 10 ** mint["decimals"]
            raise ValidationError(f"That would overflow the mint's u64 supply — at most {max_more:,} more tokens")
        payload["amount"] = str(raw)

    result = _sidecar_request(
        "POST", f"/internal/token/{launch.mint_address}/prepare-action", json=payload, timeout=30
    )
    return {"transaction": result["transaction"], "authority": authority}
