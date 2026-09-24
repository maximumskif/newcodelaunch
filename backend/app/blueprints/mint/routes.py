from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...extensions import limiter
from ...services import candy_machine, ipfs, nft_collections, projects

mint_bp = Blueprint("mint", __name__)


def _handle_candy_machine_service_error(exc: candy_machine.CandyMachineServiceError):
    # A 4xx from the sidecar (e.g. "too many items") is the caller's input
    # problem, not a service outage — pass that status through instead of
    # always reporting 502.
    status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
    return jsonify(error=str(exc)), status


@mint_bp.post("/prepare-collection")
@jwt_required()
def prepare_collection():
    # Step 1 of 2 (see docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md). The
    # frontend calls this, gets the creator's wallet to sign+send+confirm
    # the single returned transaction, THEN calls /prepare-candy-machine
    # below with the collection_mint this returns — never both steps at
    # once, which is what let a stale blockhash slip through before.
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
        result = candy_machine.prepare_collection(
            collection=collection,
            network=data["network"],
            creator_wallet=data["creator_wallet"],
            price_sol=price_sol,
            go_live_date=data["go_live_date"],
            seller_fee_bps=seller_fee_bps,
            allowlist=data.get("allowlist"),
            mint_limit=data.get("mint_limit"),
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    # prepare_collection pins the collection's metadata JSON to IPFS before
    # ever calling the sidecar — a Pinata outage or missing config used to
    # escape as an unhandled 500. Same mapping as nft/routes.py's publish.
    except ipfs.IPFSNotConfiguredError as exc:
        return jsonify(error=str(exc)), 503
    except ipfs.IPFSUploadError as exc:
        return jsonify(error=str(exc)), 502
    except candy_machine.CandyMachineServiceError as exc:
        return _handle_candy_machine_service_error(exc)

    return jsonify(result)


@mint_bp.post("/prepare-candy-machine")
@jwt_required()
def prepare_candy_machine_step():
    # Step 2 of 2 — only call this after step 1's transaction is confirmed
    # on-chain. collection_mint here is that transaction's result, not a
    # value this route derives itself.
    data = request.get_json(silent=True) or {}
    required_fields = ["collection_id", "network", "creator_wallet", "collection_mint", "price_sol", "go_live_date"]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400

    try:
        collection = nft_collections.get_owned_collection(data["collection_id"], get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    try:
        price_sol = float(data["price_sol"])
    except (TypeError, ValueError):
        return jsonify(error="price_sol must be a number"), 400

    try:
        result = candy_machine.prepare_candy_machine_step(
            collection=collection,
            network=data["network"],
            creator_wallet=data["creator_wallet"],
            collection_mint=data["collection_mint"],
            price_sol=price_sol,
            go_live_date=data["go_live_date"],
            allowlist=data.get("allowlist"),
            mint_limit=data.get("mint_limit"),
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _handle_candy_machine_service_error(exc)

    return jsonify(result)


@mint_bp.post("/prepare-config-lines")
@jwt_required()
def prepare_config_lines():
    # Step 3 (after the Candy Machine exists): load the rest of its items, a
    # batch of transactions per wallet prompt, until none are returned.
    data = request.get_json(silent=True) or {}
    missing = [f for f in ("collection_id", "network", "creator_wallet", "candy_machine") if not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400
    try:
        collection = nft_collections.get_owned_collection(data["collection_id"], get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    try:
        return jsonify(
            candy_machine.prepare_config_lines(collection, data["network"], data["creator_wallet"], data["candy_machine"])
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _handle_candy_machine_service_error(exc)


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
            allowlist=data.get("allowlist"),
            mint_limit=data.get("mint_limit"),
        )
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        # Reading the guard configuration back from the chain failed — the
        # drop exists on-chain, so this is retryable, not an input error.
        return _handle_candy_machine_service_error(exc)

    project_id = data.get("project_id")
    if project_id:
        # Best-effort: the candy machine already exists on-chain by this
        # point, so a stale/foreign project_id must not fail recording it.
        projects.link_if_owned(project_id, get_jwt_identity(), lambda p: projects.link_candy_machine(p, deployment))

    return jsonify(candy_machine=deployment.to_dict()), 201


def _phase_edit_fields(data: dict):
    missing = [f for f in ("price_sol", "go_live_date") if data.get(f) in (None, "")]
    if missing:
        return None, (jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400)
    return (data["price_sol"], data["go_live_date"], data.get("allowlist"), data.get("mint_limit")), None


@mint_bp.post("/candy-machines/<deployment_id>/prepare-update")
@jwt_required()
def prepare_phase_update(deployment_id):
    """Step 1 of editing a live drop's phases: the creator-signed guard
    update transaction. Step 2 (POST .../phases) records it once sent."""
    data = request.get_json(silent=True) or {}
    fields, error = _phase_edit_fields(data)
    if error:
        return error
    try:
        deployment = candy_machine.get_owned_deployment(deployment_id, get_jwt_identity())
        return jsonify(candy_machine.prepare_phase_update(deployment, *fields))
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _handle_candy_machine_service_error(exc)


@mint_bp.get("/candy-machines/<deployment_id>/allowlist")
@jwt_required()
def get_allowlist(deployment_id):
    """The full wallet list, for the creator's own phase editor only — every
    public response carries just its size (on-chain there's only a root)."""
    try:
        deployment = candy_machine.get_owned_deployment(deployment_id, get_jwt_identity())
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    return jsonify(addresses=deployment.allowlist["addresses"] if deployment.allowlist else [])


@mint_bp.post("/candy-machines/<deployment_id>/phases")
@jwt_required()
def apply_phase_update(deployment_id):
    data = request.get_json(silent=True) or {}
    fields, error = _phase_edit_fields(data)
    if error:
        return error
    signature = data.get("transaction_signature")
    if not isinstance(signature, str) or not signature:
        return jsonify(error="Missing required fields: transaction_signature"), 400
    try:
        deployment = candy_machine.get_owned_deployment(deployment_id, get_jwt_identity())
        updated = candy_machine.apply_phase_update(deployment, signature, *fields)
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _handle_candy_machine_service_error(exc)
    return jsonify(candy_machine=updated.to_dict())


@mint_bp.get("/dashboard")
@jwt_required()
def creator_dashboard():
    return jsonify(candy_machine.get_creator_dashboard(get_jwt_identity()))


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


def _public_service_error_response(exc: candy_machine.CandyMachineServiceError):
    # Unlike the authenticated routes above (where str(exc) reaching the
    # caller is fine — it's the creator debugging their own deploy), these
    # two routes are reachable by anyone with a candy_machine_address, so the
    # raw exception text — which can include the sidecar's own response body,
    # or an internal-config message like "CANDY_MACHINE_SHARED_SECRET is not
    # configured" — must not go out verbatim. Log the real detail, return a
    # generic message.
    current_app.logger.error("Candy Machine service error on a public route: %s", exc)
    status_code = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
    return jsonify(error="This drop's mint service is temporarily unavailable. Try again shortly."), status_code


@mint_bp.get("/public/<candy_machine_address>")
@limiter.limit("60/minute")
def get_public_candy_machine(candy_machine_address: str):
    try:
        # ?wallet= adds whether that wallet is on the drop's allowlist and
        # what it would pay right now.
        status = candy_machine.get_public_candy_machine_status(candy_machine_address, request.args.get("wallet"))
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.CandyMachineServiceError as exc:
        return _public_service_error_response(exc)

    return jsonify(status)


@mint_bp.post("/public/<candy_machine_address>/mint")
@limiter.limit("20/minute")
def prepare_public_mint(candy_machine_address: str):
    data = request.get_json(silent=True) or {}
    minter_wallet = data.get("minter_wallet")
    if not minter_wallet:
        return jsonify(error="minter_wallet is required"), 400

    try:
        result = candy_machine.prepare_mint(candy_machine_address, minter_wallet)
    except candy_machine.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except candy_machine.NotEligibleError as exc:
        return jsonify(error=str(exc)), 403
    except candy_machine.CandyMachineServiceError as exc:
        return _public_service_error_response(exc)

    return jsonify(result)
