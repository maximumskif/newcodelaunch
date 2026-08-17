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
        price_sol = float(data["price_sol"])
        # `or 500` would silently replace an intentional 0 (no royalty) with
        # the default, since 0 is falsy — only fall back when the field is
        # actually absent.
        seller_fee_bps = 500 if data.get("seller_fee_bps") is None else int(data["seller_fee_bps"])
    except (TypeError, ValueError):
        return jsonify(error="price_sol and seller_fee_bps must be numbers"), 400

    try:
        result = candy_machine.prepare_candy_machine(
            collection=collection,
            network=data["network"],
            creator_wallet=data["creator_wallet"],
            price_sol=price_sol,
            go_live_date=data["go_live_date"],
            seller_fee_bps=seller_fee_bps,
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        # A 4xx from the sidecar (e.g. "too many items") is the caller's
        # input problem, not a service outage — pass that status through
        # instead of always reporting 502.
        status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status

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
        price_sol = float(data["price_sol"])
        items_available = int(data["items_available"])
    except (TypeError, ValueError):
        return jsonify(error="price_sol and items_available must be numbers"), 400

    try:
        deployment = candy_machine.record_candy_machine(
            collection=collection,
            network=data["network"],
            collection_mint=data["collection_mint"],
            candy_machine=data["candy_machine"],
            transaction_signatures=data["transaction_signatures"],
            price_sol=price_sol,
            items_available=items_available,
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


# Public storefront routes below — deliberately no @jwt_required(). A buyer
# visiting a shared drop link has no account with this app; the candy
# machine address itself is already public on Solana, and everything
# returned here (collection name/description, price, live on-chain
# item counts) is exactly what a wallet explorer would already show.


@mint_bp.get("/public/<candy_machine_address>")
def get_public_candy_machine(candy_machine_address: str):
    try:
        status = candy_machine.get_public_candy_machine_status(candy_machine_address)
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.CandyMachineServiceError as exc:
        status_code = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status_code

    return jsonify(status)


@mint_bp.post("/public/<candy_machine_address>/mint")
def prepare_public_mint(candy_machine_address: str):
    data = request.get_json(silent=True) or {}
    minter_wallet = data.get("minter_wallet")
    if not minter_wallet:
        return jsonify(error="minter_wallet is required"), 400

    try:
        result = candy_machine.prepare_mint(candy_machine_address, minter_wallet)
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.CandyMachineServiceError as exc:
        status_code = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status_code

    return jsonify(result)
