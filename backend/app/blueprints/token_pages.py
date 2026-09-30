from flask import Blueprint, current_app, jsonify, request

from ..extensions import limiter
from ..services import holder_snapshot, token_checker, token_pages

token_pages_bp = Blueprint("token_pages", __name__)


def _chain_error(exc):
    # Public route: log the RPC/sidecar detail, don't send it out.
    current_app.logger.error("Token page chain read failed: %s", exc)
    return jsonify(error="Couldn't read this token from the chain right now. Try again shortly."), 502


@token_pages_bp.get("/evm/<network>/<address>")
@limiter.limit("60/minute")
def evm_token_page(network: str, address: str):
    """Public: a token launched with this app, as the chain has it."""
    try:
        return jsonify(token_pages.evm_token_page(network, address))
    except token_pages.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except token_pages.ChainReadError as exc:
        return _chain_error(exc)


@token_pages_bp.get("/solana/<mint>")
@limiter.limit("60/minute")
def solana_token_page(mint: str):
    try:
        return jsonify(token_pages.solana_token_page(mint))
    except token_pages.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except token_pages.ChainReadError as exc:
        return _chain_error(exc)


@token_pages_bp.get("/check/<network>/<address>")
@limiter.limit("30/minute")
def check_token(network: str, address: str):
    """Public: the token checker — any token, not only ones launched here."""
    try:
        if network.startswith("solana"):
            return jsonify(token_checker.check_solana(network, address))
        return jsonify(token_checker.check_evm(network, address))
    except token_checker.CheckError as exc:
        return jsonify(error=str(exc)), 400
    except token_checker.ChainReadError as exc:
        return _chain_error(exc)


@token_pages_bp.get("/holders/<network>/<address>")
@limiter.limit("10/minute")
def token_holders(network: str, address: str):
    """Public: every holder of a token (EVM: launched here; ?block= for a
    past block). Holder lists are public on-chain data."""
    block = request.args.get("block")
    if block is not None and not block.isdigit():
        return jsonify(error="block must be a block number"), 400
    try:
        if network.startswith("solana"):
            if block is not None:
                return jsonify(error="Solana snapshots are always of now"), 400
            return jsonify(holder_snapshot.snapshot_solana(network, address))
        return jsonify(holder_snapshot.snapshot_evm(network, address, int(block) if block else None))
    except holder_snapshot.SnapshotError as exc:
        return jsonify(error=str(exc)), 400
    except holder_snapshot.ChainReadError as exc:
        return _chain_error(exc)
