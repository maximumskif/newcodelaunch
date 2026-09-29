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
        source, tokens = market_intelligence.get_top_tokens_with_source(limit)
    except market_intelligence.MarketDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(tokens=tokens, source=source)


@market_bp.get("/lookup")
def lookup_token():
    try:
        pairs = market_intelligence.lookup_token(request.args.get("address", ""))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except market_intelligence.MarketDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(pairs=pairs)


@market_bp.get("/trending")
def trending_tokens():
    try:
        tokens = market_intelligence.trending_tokens()
    except market_intelligence.MarketDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(tokens=tokens)
