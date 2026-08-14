from flask import Blueprint, jsonify, request

from ...services import market_intelligence

market_bp = Blueprint("market", __name__)


@market_bp.get("/tokens")
def list_tokens():
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    except ValueError:
        return jsonify(error="limit must be an integer"), 400

    try:
        tokens = market_intelligence.get_top_tokens(limit)
    except market_intelligence.MarketDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(tokens=tokens)
