from datetime import datetime, timedelta, timezone

from eth_account import Account
from eth_account.messages import encode_defunct
from flask_jwt_extended import create_access_token, decode_token

from app.extensions import db as _db
from app.models.user import User


def _sign_in(client):
    account = Account.create()
    address = account.address.lower()
    nonce = client.post("/api/auth/nonce", json={"wallet_address": address, "chain": "evm"}).get_json()
    signature = "0x" + account.sign_message(encode_defunct(text=nonce["message"])).signature.hex().removeprefix("0x")
    response = client.post(
        "/api/auth/verify",
        json={"wallet_address": address, "chain": "evm", "nonce": nonce["nonce"], "signature": signature},
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()["access_token"], address


def _now():
    return int(datetime.now(timezone.utc).timestamp())


def test_tokens_last_the_configured_lifetime_not_the_libraries_15_minutes(app, client):
    token, _ = _sign_in(client)
    claims = decode_token(token)
    assert claims["exp"] - claims["iat"] == app.config["JWT_ACCESS_TOKEN_EXPIRES_SECONDS"] == 3600


def test_refresh_gives_a_new_token_for_the_same_session(app, client):
    token, address = _sign_in(client)
    first = decode_token(token)

    response = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    claims = decode_token(body["access_token"])
    assert claims["sub"] == first["sub"]
    assert (claims["wallet"], claims["chain"]) == (address, "evm")
    # The sign-in time carries over, so refreshing can't extend the session's cap.
    assert claims["auth_time"] == first["auth_time"]
    assert body["user"]["wallet_address"] == address

    # The new token works on its own.
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200


def test_refresh_refuses_a_session_older_than_the_cap(app, client):
    token, address = _sign_in(client)
    sub = decode_token(token)["sub"]
    too_old = _now() - app.config["JWT_SESSION_MAX_SECONDS"] - 60
    stale = create_access_token(identity=sub, additional_claims={"wallet": address, "chain": "evm", "auth_time": too_old})

    response = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {stale}"})
    assert response.status_code == 401
    assert "Sign in again" in response.get_json()["error"]


def test_refresh_needs_a_valid_token(client):
    assert client.post("/api/auth/refresh").status_code == 401


def test_refresh_refuses_a_deleted_account(app, client):
    token, _ = _sign_in(client)
    _db.session.delete(_db.session.get(User, decode_token(token)["sub"]))
    _db.session.commit()
    assert client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_jwt_errors_are_readable_json_with_a_code(app, client):
    missing = client.get("/api/auth/me")
    assert missing.status_code == 401
    assert missing.get_json() == {"error": "Sign in with your wallet first.", "code": "sign_in_required"}

    garbage = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert garbage.status_code == 401
    assert garbage.get_json()["code"] == "session_invalid"

    token, _ = _sign_in(client)
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(seconds=-1)
    expired = create_access_token(identity=decode_token(token)["sub"])
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert response.get_json() == {"error": "Your session has ended. Sign in again.", "code": "session_expired"}
