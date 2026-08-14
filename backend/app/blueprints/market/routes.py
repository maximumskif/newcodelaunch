from flask import Blueprint, jsonify, request

from ...services import market_intelligence

market_bp = Blueprint("market", __name__)


@market_bp.get("/tokens")
def list_tokens():
    limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    try:
        tokens = market_intelligence.get_top_tokens(limit)
    except market_intelligence.MarketDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(tokens=tokens)
