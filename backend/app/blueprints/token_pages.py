from flask import Blueprint, current_app, jsonify

from ..extensions import limiter
from ..services import token_pages

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
