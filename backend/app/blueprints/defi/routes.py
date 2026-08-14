from flask import Blueprint, jsonify, request

from ...services import defi_scanner

defi_bp = Blueprint("defi", __name__)


@defi_bp.get("/protocols")
def list_protocols():
    limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    try:
        protocols = defi_scanner.get_top_protocols(limit)
    except defi_scanner.DefiDataError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(protocols=protocols)
