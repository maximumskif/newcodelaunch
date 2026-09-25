"""
Raydium liquidity for SPL tokens launched here: the token's CPMM pool
against SOL — create it, add to it, withdraw from it. The sidecar
(services/candy-machine/src/routes/raydium.ts) builds each transaction for
the owner's wallet to sign and reads confirmed transactions back from the
chain; this module decides who may ask and what counts as a liquidity
change worth recording. Nothing here holds keys or funds.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from ..extensions import db
from ..models.solana_token import SolanaPoolAction, SolanaTokenLaunch
from ..models.user import Chain, User, WalletIdentity
from .candy_machine import _sidecar_network, _sidecar_request
from .solana_tokens import ValidationError

ACTIONS = ("create", "deposit", "withdraw", "lock")
U64_MAX = (1 << 64) - 1
_SIGNATURE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{64,90}$")


def _account_solana_wallets(user_id: str) -> set[str]:
    wallets = {row.wallet_address for row in WalletIdentity.query.filter_by(user_id=user_id, chain=Chain.SOLANA).all()}
    user = db.session.get(User, user_id)
    if user is not None and user.chain == Chain.SOLANA:
        wallets.add(user.wallet_address)
    return wallets


def _raw_amount(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.isdigit() or not 0 < int(value) <= U64_MAX:
        raise ValidationError(f"{name} must be a positive whole number of base units")
    return str(int(value))


def get_pool(launch: SolanaTokenLaunch, owner: Optional[str] = None) -> dict[str, Any]:
    """The token's pool as the chain has it (fee tier, reserves, the
    owner's LP balance), plus this app's record of liquidity changes."""
    params = {"network": _sidecar_network(launch.network), "mint": launch.mint_address}
    if owner:
        params["owner"] = owner
    state = _sidecar_request("GET", "/internal/raydium/pool", params=params, timeout=30)
    history = (
        SolanaPoolAction.query.filter_by(launch_id=launch.id).order_by(SolanaPoolAction.created_at.desc()).all()
    )
    return {**state, "history": [row.to_dict() for row in history]}


def prepare(
    launch: SolanaTokenLaunch,
    user_id: str,
    action: str,
    owner: str,
    token_amount: Any = None,
    sol_amount: Any = None,
    lp_amount: Any = None,
) -> dict[str, Any]:
    """Builds a create/deposit/withdraw/lock transaction for one of this
    account's own Solana wallets to sign. A lock is permanent (Raydium's
    Burn & Earn has no unlock); the frontend confirms that explicitly."""
    if action not in ACTIONS:
        raise ValidationError(f"action must be one of: {', '.join(ACTIONS)}")
    if owner not in _account_solana_wallets(user_id):
        raise ValidationError("owner must be one of this account's Solana wallets")
    payload: dict[str, Any] = {"network": _sidecar_network(launch.network), "owner": owner, "mint": launch.mint_address}
    if action == "create":
        payload["tokenAmount"] = _raw_amount(token_amount, "token_amount")
        payload["solAmount"] = _raw_amount(sol_amount, "sol_amount")
    elif action == "deposit":
        payload["tokenAmount"] = _raw_amount(token_amount, "token_amount")
    else:  # withdraw / lock
        payload["lpAmount"] = _raw_amount(lp_amount, "lp_amount")
    return _sidecar_request("POST", f"/internal/raydium/pool/prepare-{action}", json=payload, timeout=60)


def record(launch: SolanaTokenLaunch, user_id: str, signature: Any) -> SolanaPoolAction:
    """Records a liquidity change after reading its transaction back: a
    confirmed success, paid for by one of this account's Solana wallets, in
    which Raydium's CPMM program ran and this token's own pool (derived from
    its mint, never taken from the client) gained both sides (create /
    deposit) or lost both (withdraw) — or, with Raydium's lock program, in
    which the lock authority newly holds this pool's LP tokens (lock).
    Amounts are the pool vaults' own changes (and the LP locked). A swap moves the two sides in opposite directions and isn't
    recorded."""
    if not isinstance(signature, str) or not _SIGNATURE.match(signature):
        raise ValidationError("signature must be a transaction signature")

    existing = SolanaPoolAction.query.filter_by(signature=signature).first()
    if existing is not None:
        if existing.user_id != user_id or existing.launch_id != launch.id:
            raise ValidationError("This transaction has already been recorded for a different token or account")
        return existing

    facts = _sidecar_request(
        "GET",
        f"/internal/raydium/transaction/{signature}",
        params={"network": _sidecar_network(launch.network), "mint": launch.mint_address},
        timeout=30,
    )
    if facts.get("status") != "success":
        raise ValidationError(f"Transaction is not a confirmed success on-chain (status: {facts.get('status')})")
    if facts.get("feePayer") not in _account_solana_wallets(user_id):
        raise ValidationError("The transaction wasn't paid for by a wallet on this account")

    token_delta, sol_delta = int(facts["tokenDelta"]), int(facts["solDelta"])
    locked_delta = int(facts.get("lockedDelta") or 0)
    lp_amount = None
    if locked_delta > 0:
        # LP newly held by Raydium's lock authority for this pool — and the
        # lock program ran — is a Burn & Earn lock.
        if not facts.get("lockInvoked"):
            raise ValidationError("The transaction didn't use Raydium's lock program")
        kind, lp_amount = "lock", str(locked_delta)
    elif not facts.get("cpmmInvoked"):
        raise ValidationError("The transaction didn't use Raydium's pool program")
    elif token_delta > 0 and sol_delta > 0:
        kind = "create" if facts.get("poolCreated") else "deposit"
    elif token_delta < 0 and sol_delta < 0:
        kind = "withdraw"
    else:
        raise ValidationError("The transaction didn't add, withdraw or lock liquidity in this token's pool")

    action = SolanaPoolAction(
        user_id=user_id,
        launch_id=launch.id,
        network=launch.network,
        pool_id=facts["poolId"],
        kind=kind,
        signature=signature,
        wallet=facts["feePayer"],
        token_amount=str(abs(token_delta)),
        sol_amount=str(abs(sol_delta)),
        lp_amount=lp_amount,
    )
    db.session.add(action)
    db.session.commit()
    return action
