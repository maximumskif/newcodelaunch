from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...services import candy_machine, ipfs, projects, solana_pools, solana_tokens

solana_tokens_bp = Blueprint("solana_tokens", __name__)


def _form_bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() not in ("false", "0", "no", "off")


@solana_tokens_bp.post("/prepare")
@jwt_required()
def prepare_token_launch():
    # multipart/form-data, not JSON — the optional logo is a real file
    # upload (pinned to IPFS alongside the metadata JSON). The frontend
    # signs+sends the returned transaction with the creator's own wallet,
    # then calls POST /api/solana-tokens below to record it.
    form = request.form
    required_fields = ["network", "creator_wallet", "name", "symbol", "decimals", "supply"]
    missing = [f for f in required_fields if not form.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400

    try:
        decimals = int(form["decimals"])
    except ValueError:
        return jsonify(error="decimals must be a whole number"), 400

    logo_file = request.files.get("logo")
    logo = logo_file.read() if logo_file and logo_file.filename else None

    try:
        result = solana_tokens.prepare_token_launch(
            network=form["network"],
            creator_wallet=form["creator_wallet"],
            name=form["name"],
            symbol=form["symbol"],
            decimals=decimals,
            supply=form["supply"].strip(),
            description=form.get("description", ""),
            logo=logo,
            revoke_mint_authority=_form_bool(form.get("revoke_mint_authority"), True),
            revoke_freeze_authority=_form_bool(form.get("revoke_freeze_authority"), True),
        )
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except ipfs.IPFSNotConfiguredError as exc:
        return jsonify(error=f"{exc} — or launch without a description/logo, which needs no IPFS."), 503
    except ipfs.IPFSUploadError as exc:
        return jsonify(error=str(exc)), 502
    except candy_machine.CandyMachineServiceError as exc:
        # A 4xx from the sidecar is an input problem, not an outage — same
        # passthrough as mint/routes.py's _handle_candy_machine_service_error.
        status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status

    return jsonify(result)


@solana_tokens_bp.post("")
@jwt_required()
def record_token_launch():
    data = request.get_json(silent=True) or {}
    required_fields = ["network", "mint_address", "transaction_signature", "creator_wallet", "name", "symbol"]
    missing = [f for f in required_fields if not isinstance(data.get(f), str) or not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400
    metadata_uri = data.get("metadata_uri") or ""
    if not isinstance(metadata_uri, str):
        return jsonify(error="metadata_uri must be a string"), 400

    try:
        launch = solana_tokens.record_token_launch(
            user_id=get_jwt_identity(),
            network=data["network"],
            mint_address=data["mint_address"],
            transaction_signature=data["transaction_signature"],
            creator_wallet=data["creator_wallet"],
            name=data["name"],
            symbol=data["symbol"],
            metadata_uri=metadata_uri,
        )
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422

    project_id = data.get("project_id")
    if isinstance(project_id, str) and project_id:
        # Best-effort, like every other deployment type: the token already
        # exists on-chain, so a stale/foreign project_id mustn't fail this.
        projects.link_if_owned(project_id, get_jwt_identity(), lambda p: projects.link_solana_token(p, launch))

    return jsonify(token=launch.to_dict()), 201


@solana_tokens_bp.get("")
@jwt_required()
def list_token_launches():
    launches = solana_tokens.get_user_token_launches(get_jwt_identity())
    return jsonify(tokens=[launch.to_dict() for launch in launches])


def _owned_launch_or_404(launch_id):
    try:
        return solana_tokens.get_owned_launch(launch_id, get_jwt_identity()), None
    except solana_tokens.NotFoundError as exc:
        return None, (jsonify(error=str(exc)), 404)


@solana_tokens_bp.post("/<launch_id>/prepare-action")
@jwt_required()
def prepare_token_action(launch_id):
    """Owner tools: mint more, or revoke the mint/freeze authority. The
    returned transaction must be signed by the current on-chain authority
    (returned alongside it); then POST .../refresh re-reads the chain."""
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    data = request.get_json(silent=True) or {}
    amount = data.get("amount")
    if amount is not None and not isinstance(amount, str):
        return jsonify(error="amount must be a string of whole tokens"), 400
    try:
        return jsonify(solana_tokens.prepare_token_action(launch, str(data.get("action", "")), amount))
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status


@solana_tokens_bp.post("/<launch_id>/refresh")
@jwt_required()
def refresh_token_launch(launch_id):
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    try:
        return jsonify(solana_tokens.refresh_token_launch(launch))
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 502


@solana_tokens_bp.get("/<launch_id>/metadata")
@jwt_required()
def get_token_metadata(launch_id):
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    try:
        return jsonify(solana_tokens.get_token_metadata(launch))
    except candy_machine.CandyMachineServiceError as exc:
        return jsonify(error=str(exc)), 502


@solana_tokens_bp.post("/<launch_id>/prepare-metadata-update")
@jwt_required()
def prepare_metadata_update(launch_id):
    """multipart/form-data like /prepare (an optional new logo file). The
    transaction must be signed by the returned update authority; then POST
    .../refresh re-reads the token from the chain."""
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    form = request.form
    logo_file = request.files.get("logo")
    try:
        return jsonify(
            solana_tokens.prepare_metadata_update(
                launch,
                name=form.get("name", ""),
                symbol=form.get("symbol", ""),
                description=form.get("description", ""),
                logo=logo_file.read() if logo_file and logo_file.filename else None,
                lock=_form_bool(form.get("lock"), False),
            )
        )
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except ipfs.IPFSNotConfiguredError as exc:
        return jsonify(error=str(exc)), 503
    except ipfs.IPFSUploadError as exc:
        return jsonify(error=str(exc)), 502
    except candy_machine.CandyMachineServiceError as exc:
        status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
        return jsonify(error=str(exc)), status


# --- Raydium liquidity ------------------------------------------------------------


def _sidecar_error(exc):
    status = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
    return jsonify(error=str(exc)), status


@solana_tokens_bp.get("/<launch_id>/pool")
@jwt_required()
def get_token_pool(launch_id):
    """The token's Raydium pool as the chain has it, with this app's record
    of liquidity changes. ?owner= adds that wallet's LP balance."""
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    try:
        return jsonify(solana_pools.get_pool(launch, request.args.get("owner") or None))
    except candy_machine.CandyMachineServiceError as exc:
        return _sidecar_error(exc)


@solana_tokens_bp.post("/<launch_id>/pool/prepare")
@jwt_required()
def prepare_pool_action(launch_id):
    """Builds a create / deposit / withdraw for the owner's wallet to sign;
    then POST .../pool/record with the confirmed signature."""
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(
            solana_pools.prepare(
                launch,
                get_jwt_identity(),
                str(data.get("action", "")),
                str(data.get("owner", "")),
                token_amount=data.get("token_amount"),
                sol_amount=data.get("sol_amount"),
                lp_amount=data.get("lp_amount"),
            )
        )
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _sidecar_error(exc)


@solana_tokens_bp.post("/<launch_id>/pool/record")
@jwt_required()
def record_pool_action(launch_id):
    launch, error = _owned_launch_or_404(launch_id)
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        action = solana_pools.record(launch, get_jwt_identity(), data.get("signature"))
    except solana_tokens.ValidationError as exc:
        return jsonify(error=str(exc)), 422
    except candy_machine.CandyMachineServiceError as exc:
        return _sidecar_error(exc)
    return jsonify(action=action.to_dict()), 201
