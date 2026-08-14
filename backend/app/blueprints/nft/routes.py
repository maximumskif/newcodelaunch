from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_jwt_extended import get_jwt_identity, jwt_required

from ...services import ai_traits, ipfs, nft_collections, nft_generation, projects

nft_bp = Blueprint("nft", __name__)


@nft_bp.post("/collections")
@jwt_required()
def create_collection():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400

    collection = nft_collections.create_collection(
        user_id=get_jwt_identity(),
        name=name,
        description=data.get("description") or "",
        collection_size=int(data.get("collection_size") or 100),
        image_size=int(data.get("image_size") or 1024),
    )

    project_id = data.get("project_id")
    if project_id:
        # Best-effort: the collection already exists by this point, so a
        # stale/foreign project_id must not fail creating it.
        try:
            project = projects.get_owned_project(project_id, get_jwt_identity())
            projects.link_nft_collection(project, collection)
        except projects.NotFoundError:
            pass

    return jsonify(collection=collection.to_dict()), 201


@nft_bp.get("/collections")
@jwt_required()
def list_collections():
    collections = nft_collections.get_user_collections(get_jwt_identity())
    return jsonify(collections=[c.to_dict() for c in collections])


@nft_bp.get("/collections/<collection_id>")
@jwt_required()
def get_collection(collection_id):
    try:
        collection = nft_collections.get_owned_collection(collection_id, get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    return jsonify(collection=collection.to_dict(include_layers=True))


@nft_bp.post("/collections/<collection_id>/layers")
@jwt_required()
def add_layer(collection_id):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400

    try:
        collection = nft_collections.get_owned_collection(collection_id, get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    order_index = int(data.get("order_index", len(collection.layers)))
    layer = nft_collections.add_layer(collection, name, order_index)
    return jsonify(layer=layer.to_dict()), 201


@nft_bp.post("/layers/<layer_id>/traits")
@jwt_required()
def add_trait(layer_id):
    image_file = request.files.get("image")
    name = (request.form.get("name") or "").strip()
    if image_file is None or not name:
        return jsonify(error="name and an image file are required"), 400

    try:
        layer = nft_collections.get_owned_layer(layer_id, get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404

    try:
        rarity_weight = float(request.form.get("rarity_weight", 50.0))
        trait = nft_collections.add_trait(
            layer, name, rarity_weight, image_file, current_app.config["UPLOAD_FOLDER"]
        )
    except nft_collections.ValidationError as exc:
        return jsonify(error=str(exc)), 400

    return jsonify(trait=trait.to_dict()), 201


@nft_bp.post("/collections/<collection_id>/generate")
@jwt_required()
def generate(collection_id):
    data = request.get_json(silent=True) or {}
    count = int(data.get("count") or 0)
    if count <= 0:
        return jsonify(error="count must be a positive integer"), 400

    try:
        collection = nft_collections.get_owned_collection(collection_id, get_jwt_identity())
        items = nft_generation.generate_collection(collection, count, current_app.config["UPLOAD_FOLDER"])
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except nft_generation.GenerationError as exc:
        return jsonify(error=str(exc)), 422

    return jsonify(items=[item.to_dict() for item in items]), 201


@nft_bp.get("/collections/<collection_id>/items")
@jwt_required()
def list_items(collection_id):
    try:
        collection = nft_collections.get_owned_collection(collection_id, get_jwt_identity())
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    return jsonify(items=[item.to_dict() for item in collection.items])


@nft_bp.post("/items/<item_id>/publish")
@jwt_required()
def publish_item(item_id):
    try:
        item, collection = nft_collections.get_owned_item(item_id, get_jwt_identity())
        item = nft_collections.publish_item_to_ipfs(item, collection, current_app.config["UPLOAD_FOLDER"])
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except ipfs.IPFSNotConfiguredError as exc:
        return jsonify(error=str(exc)), 503
    except ipfs.IPFSUploadError as exc:
        return jsonify(error=str(exc)), 502

    return jsonify(item=item.to_dict())


@nft_bp.get("/items/<item_id>/metadata")
@jwt_required()
def get_item_metadata(item_id):
    try:
        item, collection = nft_collections.get_owned_item(item_id, get_jwt_identity())
        result = nft_collections.get_item_metadata(item, collection)
    except nft_collections.NotFoundError as exc:
        return jsonify(error=str(exc)), 404
    except nft_collections.MetadataFetchError as exc:
        return jsonify(error=str(exc)), 502

    return jsonify(result)


@nft_bp.get("/uploads/<path:relative_path>")
def serve_upload(relative_path):
    # No auth — <img src> can't attach a Bearer token. Paths embed unguessable
    # UUIDs, the same trust boundary an IPFS hash would give after publish.
    return send_from_directory(current_app.config["UPLOAD_FOLDER"], relative_path)


@nft_bp.post("/analyze")
@jwt_required()
def analyze_image():
    image_file = request.files.get("image")
    if image_file is None:
        return jsonify(error="image file is required"), 400

    result = ai_traits.analyze_single_image(
        image_file.read(), image_file.filename or "image.png", current_app.config["OPENAI_API_KEY"]
    )
    return jsonify(result)


@nft_bp.post("/analyze/batch")
@jwt_required()
def analyze_batch():
    files = request.files.getlist("images")
    if not files:
        return jsonify(error="at least one image file is required"), 400

    images = [{"filename": f.filename or f"image_{i + 1}.png", "data": f.read()} for i, f in enumerate(files)]
    result = ai_traits.batch_analyze_images(images, current_app.config["OPENAI_API_KEY"])
    return jsonify(result)
