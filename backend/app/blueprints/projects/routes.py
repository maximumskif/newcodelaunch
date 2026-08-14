from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...services import projects

projects_bp = Blueprint("projects", __name__)


@projects_bp.post("")
@jwt_required()
def create_project():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    project_type = data.get("project_type")
    chain = data.get("chain")

    if not name or not project_type or not chain:
        return jsonify(error="name, project_type and chain are required"), 400

    try:
        project = projects.create_project(
            user_id=get_jwt_identity(),
            name=name,
            project_type=project_type,
            chain=chain,
            network=data.get("network"),
            draft_data=data.get("draft_data") or {},
        )
    except projects.ValidationError as exc:
        return jsonify(error=str(exc)), 400

    return jsonify(project=project.to_dict()), 201


@projects_bp.get("")
@jwt_required()
def list_projects():
    status = request.args.get("status")
    items = projects.get_user_projects(get_jwt_identity(), status=status)
    return jsonify(projects=[p.to_dict() for p in items])


@projects_bp.get("/<project_id>")
@jwt_required()
def get_project(project_id):
    try:
        project = projects.get_owned_project(project_id, get_jwt_identity())
    except projects.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    return jsonify(project=project.to_dict())


@projects_bp.patch("/<project_id>")
@jwt_required()
def patch_project(project_id):
    data = request.get_json(silent=True) or {}
    try:
        project = projects.get_owned_project(project_id, get_jwt_identity())
        project = projects.update_project(
            project,
            name=(data.get("name") or "").strip() or None,
            draft_data=data.get("draft_data"),
            network=data.get("network"),
            status=data.get("status"),
        )
    except projects.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except projects.ValidationError as exc:
        return jsonify(error=str(exc)), 400

    return jsonify(project=project.to_dict())


@projects_bp.delete("/<project_id>")
@jwt_required()
def remove_project(project_id):
    try:
        project = projects.get_owned_project(project_id, get_jwt_identity())
    except projects.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    projects.delete_project(project)
    return "", 204
