from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...services import blockchain, contract_templates, contracts

contracts_bp = Blueprint("contracts", __name__)


@contracts_bp.get("/templates")
def list_templates():
    contract_type = request.args.get("type")
    templates = contract_templates.get_all_templates(contract_type)
    return jsonify(templates=[t.to_dict() for t in templates])


@contracts_bp.get("/templates/<template_id>")
def get_template(template_id):
    template = contract_templates.get_template(template_id)
    if template is None:
        return jsonify(error=f"Unknown template: {template_id}"), 404
    return jsonify(template=template.to_dict(include_source=True))


@contracts_bp.post("/compile")
def compile_template():
    data = request.get_json(silent=True) or {}
    template_id = data.get("template_id")
    parameters = data.get("parameters") or {}

    if not template_id:
        return jsonify(error="template_id is required"), 400

    try:
        result = contracts.compile_template(template_id, parameters)
    except contract_templates.UnknownTemplateError as exc:
        return jsonify(error=str(exc)), 404
    except contract_templates.MissingParametersError as exc:
        return jsonify(error=str(exc)), 400
    except contracts.CompilationFailedError as exc:
        return jsonify(error=f"Compilation failed: {exc}"), 422

    return jsonify(abi=result["abi"], bytecode=result["bytecode"], contract_name=result["contract_name"])


@contracts_bp.post("/estimate")
def estimate():
    data = request.get_json(silent=True) or {}
    template_id = data.get("template_id")
    parameters = data.get("parameters") or {}
    network = data.get("network")
    deployer_address = data.get("deployer_address")

    if not all([template_id, network, deployer_address]):
        return jsonify(error="template_id, network and deployer_address are required"), 400

    try:
        result = contracts.estimate_deployment(template_id, parameters, network, deployer_address)
    except contract_templates.UnknownTemplateError as exc:
        return jsonify(error=str(exc)), 404
    except contract_templates.MissingParametersError as exc:
        return jsonify(error=str(exc)), 400
    except contracts.CompilationFailedError as exc:
        return jsonify(error=f"Compilation failed: {exc}"), 422
    except Exception as exc:  # noqa: BLE001 — gas estimation can fail for many on-chain reasons
        return jsonify(error=f"Gas estimation failed: {exc}"), 422

    return jsonify(result)


@contracts_bp.post("/deployments")
@jwt_required()
def create_deployment():
    data = request.get_json(silent=True) or {}
    required_fields = ["template_id", "network", "contract_address", "transaction_hash", "deployer_address"]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify(error=f"Missing required fields: {', '.join(missing)}"), 400

    try:
        deployment = contracts.record_deployment(
            user_id=get_jwt_identity(),
            template_id=data["template_id"],
            network=data["network"],
            contract_address=data["contract_address"],
            transaction_hash=data["transaction_hash"],
            deployer_address=data["deployer_address"],
            parameters=data.get("parameters") or {},
        )
    except contract_templates.UnknownTemplateError as exc:
        return jsonify(error=str(exc)), 404
    except ValueError as exc:
        return jsonify(error=str(exc)), 422

    return jsonify(deployment=deployment.to_dict()), 201


@contracts_bp.get("/deployments")
@jwt_required()
def list_deployments():
    deployments = contracts.get_user_deployments(get_jwt_identity())
    return jsonify(deployments=[d.to_dict() for d in deployments])


@contracts_bp.get("/deployments/<contract_address>")
def get_deployment(contract_address):
    deployment = contracts.get_deployment_by_address(contract_address)
    if deployment is None:
        return jsonify(error="Deployment not found"), 404

    try:
        live_status = blockchain.get_transaction_status(deployment.network, deployment.transaction_hash)
    except Exception:  # noqa: BLE001 — live status is a nice-to-have, not required
        live_status = None

    return jsonify(deployment=deployment.to_dict(), live_status=live_status)
