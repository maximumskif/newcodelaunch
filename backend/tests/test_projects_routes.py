from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.user import Chain, User


def _make_user() -> User:
    user = User(wallet_address="0xabc0000000000000000000000000000000000a", chain=Chain.EVM)
    _db.session.add(user)
    _db.session.commit()
    return user


def _auth_header(user: User) -> dict:
    token = create_access_token(identity=user.id)
    return {"Authorization": f"Bearer {token}"}


def test_create_project_rejects_a_non_string_name_instead_of_crashing(app, client):
    # Regression: name was read as `(data.get("name") or "").strip()` — a
    # truthy non-string JSON value (e.g. an int) is not caught by `or ""`,
    # so `.strip()` raised an unhandled 500 instead of a clean 400.
    with app.app_context():
        user = _make_user()

        response = client.post(
            "/api/projects",
            json={"name": 123, "project_type": "token", "chain": "evm"},
            headers=_auth_header(user),
        )
        assert response.status_code == 400


def test_patch_project_ignores_a_non_string_name_instead_of_crashing(app, client):
    # patch_project() treats a name that reduces to "" (empty/missing/non-string)
    # as "leave the name alone" (same as any other optional field here), so a
    # non-string name is safely ignored rather than raising the old unhandled
    # 500 or rejecting the whole request.
    with app.app_context():
        user = _make_user()

        created = client.post(
            "/api/projects",
            json={"name": "Real Project", "project_type": "token", "chain": "evm"},
            headers=_auth_header(user),
        )
        project_id = created.get_json()["project"]["id"]

        response = client.patch(
            f"/api/projects/{project_id}",
            json={"name": ["not", "a", "string"]},
            headers=_auth_header(user),
        )
        assert response.status_code == 200
        assert response.get_json()["project"]["name"] == "Real Project"
