from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...services import candy_machine, nft_collections, projects

mint_bp = Blueprint("mint", __name__)


@mint_bp.post("/prepare")
@jwt_required()
def prepare():
    data = request.get_json(silent=True) or {}
    required_fields = ["collection_id", "network", "creator_wallet", "price_sol", "go_live_date"]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400

    try:
        collection = nft_collections.get_owned_collection(data["collection_id"], get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    try:
        result = candy_machine.prepare_candy_machine(
            collection=collection,
            network=data["network"],
            creator_wallet=data["creator_wallet"],
            price_sol=float(data["price_sol"]),
            go_live_date=data["go_live_date"],
            seller_fee_bps=int(data.get("seller_fee_bps") or 500),
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return jsonify(error=str(exc)), 502

    return jsonify(result)


@mint_bp.post("/candy-machines")
@jwt_required()
def create_candy_machine():
    data = request.get_json(silent=True) or {}
    required_fields = [
        "collection_id",
        "network",
        "collection_mint",
        "candy_machine",
        "transaction_signatures",
        "price_sol",
        "items_available",
        "go_live_date",
        "creator_wallet",
    ]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400

    try:
        collection = nft_collections.get_owned_collection(data["collection_id"], get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    try:
        deployment = candy_machine.record_candy_machine(
            collection=collection,
            network=data["network"],
            collection_mint=data["collection_mint"],
            candy_machine=data["candy_machine"],
            transaction_signatures=data["transaction_signatures"],
            price_sol=float(data["price_sol"]),
            items_available=int(data["items_available"]),
            go_live_date=data["go_live_date"],
            creator_wallet=data["creator_wallet"],
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422

    project_id = data.get("project_id")
    if project_id:
        # Best-effort: the candy machine already exists on-chain by this
        # point, so a stale/foreign project_id must not fail recording it.
        projects.link_if_owned(project_id, get_jwt_identity(), lambda p: projects.link_candy_machine(p, deployment))

    return jsonify(candy_machine=deployment.to_dict()), 201


@mint_bp.get("/candy-machines")
@jwt_required()
def list_candy_machines():
    deployments = candy_machine.get_user_candy_machines(get_jwt_identity())
    return jsonify(candy_machines=[d.to_dict() for d in deployments])
