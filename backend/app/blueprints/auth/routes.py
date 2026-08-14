from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from ...extensions import db, limiter
from ...models.user import Chain, User, WalletNonce
from ...services.auth import (
    SignatureVerificationError,
    build_sign_message,
    generate_nonce,
    normalize_address,
    verify_signature,
)

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/nonce")
@limiter.limit("20/minute")
def request_nonce():
    data = request.get_json(silent=True) or {}
    wallet_address = (data.get("wallet_address") or "").strip()
    chain = (data.get("chain") or "").strip().lower()

    if not wallet_address or chain not in Chain.ALL:
        return jsonify(error="wallet_address and a valid chain ('evm' or 'solana') are required"), 400

    wallet_address = normalize_address(wallet_address, chain)
    nonce = generate_nonce()

    db.session.add(WalletNonce(wallet_address=wallet_address, chain=chain, nonce=nonce))
    db.session.commit()

    return jsonify(message=build_sign_message(nonce), nonce=nonce)


@auth_bp.post("/verify")
@limiter.limit("20/minute")
def verify():
    data = request.get_json(silent=True) or {}
    wallet_address = (data.get("wallet_address") or "").strip()
    chain = (data.get("chain") or "").strip().lower()
    signature = (data.get("signature") or "").strip()
    nonce = (data.get("nonce") or "").strip()

    if not all([wallet_address, chain, signature, nonce]) or chain not in Chain.ALL:
        return jsonify(error="wallet_address, chain, signature and nonce are required"), 400

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
        return jsonify(error="Nonce not found, already used, or expired — request a new one"), 400

    message = build_sign_message(nonce)
    try:
        valid = verify_signature(chain, wallet_address, message, signature)
    except SignatureVerificationError as exc:
        return jsonify(error=f"Signature verification failed: {exc}"), 400

    if not valid:
        return jsonify(error="Signature does not match wallet_address"), 401

    nonce_row.consumed = True

    user = User.query.filter_by(wallet_address=wallet_address, chain=chain).first()
    if user is None:
        user = User(wallet_address=wallet_address, chain=chain)
        db.session.add(user)

    db.session.commit()

    access_token = create_access_token(identity=user.id)
    return jsonify(access_token=access_token, user=user.to_dict())


@auth_bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify(error="User not found"), 404
    return jsonify(user=user.to_dict())
