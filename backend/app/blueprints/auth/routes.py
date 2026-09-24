from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt, get_jwt_identity, jwt_required
from flask_limiter.util import get_remote_address

from ...extensions import db, limiter
from ...models.user import Chain, User, WalletNonce
from ...services import accounts
from ...services.auth import (
    SignatureVerificationError,
    build_sign_message,
    generate_nonce,
    normalize_address,
    verify_signature,
)
from ...validation import str_field

auth_bp = Blueprint("auth", __name__)


def _nonce_request_key() -> str:
    """Per-wallet rate-limit key, stacked alongside the blanket per-IP limit
    below. Without this, a requester spread across many IPs could still
    flood a single wallet's row count in wallet_nonces (only bounded by
    prune-nonces' TTL cleanup, not by request volume)."""
    data = request.get_json(silent=True) or {}
    wallet_address = str_field(data, "wallet_address").lower()
    chain = str_field(data, "chain").lower()
    if wallet_address and chain:
        return f"{chain}:{wallet_address}"
    # Malformed request with no wallet_address/chain to key on — fall back
    # to the per-IP limit below rather than pooling every malformed request
    # into one shared bucket.
    return get_remote_address()


@auth_bp.post("/nonce")
@limiter.limit("20/minute")
@limiter.limit("10/minute", key_func=_nonce_request_key)
def request_nonce():
    data = request.get_json(silent=True) or {}
    wallet_address = str_field(data, "wallet_address")
    chain = str_field(data, "chain").lower()

    if not wallet_address or chain not in Chain.ALL:
        return jsonify(error="wallet_address and a valid chain ('evm' or 'solana') are required"), 400

    wallet_address = normalize_address(wallet_address, chain)
    nonce = generate_nonce()

    db.session.add(WalletNonce(wallet_address=wallet_address, chain=chain, nonce=nonce))
    db.session.commit()

    return jsonify(message=build_sign_message(nonce), nonce=nonce)


class _ProofError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def _verify_wallet_proof(data: dict) -> tuple[str, str]:
    """Checks a signed nonce proves control of a wallet — shared by sign-in
    and linking a wallet to an account. Consumes the nonce on success and
    returns the normalized (wallet_address, chain)."""
    wallet_address = str_field(data, "wallet_address")
    chain = str_field(data, "chain").lower()
    signature = str_field(data, "signature")
    nonce = str_field(data, "nonce")

    if not all([wallet_address, chain, signature, nonce]) or chain not in Chain.ALL:
        raise _ProofError("wallet_address, chain, signature and nonce are required", 400)

    wallet_address = normalize_address(wallet_address, chain)

    ttl = current_app.config["WALLET_NONCE_TTL_SECONDS"]
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=ttl)

    nonce_row = (
        WalletNonce.query.filter_by(wallet_address=wallet_address, chain=chain, nonce=nonce, consumed=False)
        .filter(WalletNonce.created_at >= cutoff)
        .order_by(WalletNonce.created_at.desc())
        .first()
    )
    if nonce_row is None:
        raise _ProofError("Nonce not found, already used, or expired — request a new one", 400)

    message = build_sign_message(nonce)
    try:
        valid = verify_signature(chain, wallet_address, message, signature)
    except SignatureVerificationError as exc:
        raise _ProofError(f"Signature verification failed: {exc}", 400) from exc

    if not valid:
        raise _ProofError("Signature does not match wallet_address", 401)

    nonce_row.consumed = True
    return wallet_address, chain


def _session_wallet() -> tuple[str, str]:
    """The wallet this session signed in with (JWT claims). Tokens issued
    before wallet linking existed don't carry it — fall back to the
    account's creating wallet, which is what those sessions signed in with."""
    claims = get_jwt()
    if claims.get("wallet") and claims.get("chain"):
        return claims["wallet"], claims["chain"]
    user = db.session.get(User, get_jwt_identity())
    return user.wallet_address, user.chain


@auth_bp.post("/verify")
@limiter.limit("20/minute")
def verify():
    try:
        wallet_address, chain = _verify_wallet_proof(request.get_json(silent=True) or {})
    except _ProofError as exc:
        return jsonify(error=str(exc)), exc.status

    user = accounts.resolve_sign_in(wallet_address, chain)
    db.session.commit()

    access_token = create_access_token(identity=user.id, additional_claims={"wallet": wallet_address, "chain": chain})
    return jsonify(access_token=access_token, user=accounts.account_view(user, wallet_address, chain))


@auth_bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify(error="User not found"), 404
    return jsonify(user=accounts.account_view(user, *_session_wallet()))


@auth_bp.post("/wallets")
@jwt_required()
@limiter.limit("20/minute")
def link_wallet():
    """Link another wallet to the signed-in account, proven by that wallet
    signing a fresh nonce (request one from /nonce as for sign-in). If the
    wallet already has its own account, that account is merged into this
    one — the response says what moved."""
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify(error="User not found"), 404
    try:
        wallet_address, chain = _verify_wallet_proof(request.get_json(silent=True) or {})
    except _ProofError as exc:
        return jsonify(error=str(exc)), exc.status

    moved = accounts.link_wallet(user, wallet_address, chain)
    user = db.session.get(User, get_jwt_identity())
    return jsonify(user=accounts.account_view(user, *_session_wallet()), merged=moved)


@auth_bp.delete("/wallets/<chain>/<wallet_address>")
@jwt_required()
def unlink_wallet(chain, wallet_address):
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify(error="User not found"), 404
    try:
        accounts.unlink_wallet(user, normalize_address(wallet_address, chain), chain, *_session_wallet())
    except accounts.AccountError as exc:
        return jsonify(error=str(exc)), 422
    return jsonify(user=accounts.account_view(user, *_session_wallet()))
