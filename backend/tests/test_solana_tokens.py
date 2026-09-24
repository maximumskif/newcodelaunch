import io

import pytest
from flask_jwt_extended import create_access_token
from PIL import Image

from app.extensions import db as _db
from app.models.solana_token import SolanaTokenLaunch
from app.models.user import Chain, User
from app.services import blockchain, candy_machine, ipfs, solana_tokens

CREATOR = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
MINT = "2xNweLHLqrxsFCTd7oPHruTxSD5siVBt7XSQP2Vth2mB"
SIGNATURE = "5" * 88


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (4, 4), (255, 0, 0, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _make_user(wallet="SoLUser111111111111111111111111111111111111"):
    user = User(wallet_address=wallet, chain=Chain.SOLANA)
    _db.session.add(user)
    _db.session.commit()
    return user


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(identity=user.id)}"}


@pytest.fixture
def sidecar_calls(monkeypatch):
    calls = []

    def fake_sidecar_request(method, path, *, json=None, params=None, timeout):
        calls.append({"method": method, "path": path, "json": json})
        return {"mint": MINT, "transaction": "dHg="}

    monkeypatch.setattr(solana_tokens, "_sidecar_request", fake_sidecar_request)
    return calls


@pytest.fixture
def ipfs_calls(monkeypatch):
    calls = []

    def fake_upload_file(file_bytes, filename):
        calls.append(("file", filename))
        return {"hash": "QmLogo", "url": "ipfs://QmLogo", "gateway_url": "https://gw.example/ipfs/QmLogo"}

    def fake_upload_json(data, filename):
        calls.append(("json", data))
        return {"hash": "QmMeta", "url": "ipfs://QmMeta", "gateway_url": "https://gw.example/ipfs/QmMeta"}

    monkeypatch.setattr(ipfs, "upload_file", fake_upload_file)
    monkeypatch.setattr(ipfs, "upload_json", fake_upload_json)
    return calls


def _prepare(**overrides):
    kwargs = dict(
        network="solana_devnet",
        creator_wallet=CREATOR,
        name="Test Token",
        symbol="TST",
        decimals=6,
        supply="1000000",
    )
    kwargs.update(overrides)
    return solana_tokens.prepare_token_launch(**kwargs)


# --- prepare ---------------------------------------------------------------


def test_prepare_without_description_or_logo_needs_no_ipfs(app, sidecar_calls, ipfs_calls):
    result = _prepare()

    assert ipfs_calls == []
    assert result == {"mint": MINT, "transaction": "dHg=", "metadata_uri": ""}
    payload = sidecar_calls[0]["json"]
    assert sidecar_calls[0]["path"] == "/internal/token/prepare"
    # Backend network id mapped to the sidecar's cluster name, and the raw
    # u64 amount sent as a string (1,000,000 tokens x 10^6).
    assert payload["network"] == "devnet"
    assert payload["amount"] == "1000000000000"
    assert payload["metadataUri"] == ""
    assert payload["revokeMintAuthority"] is True
    assert payload["revokeFreezeAuthority"] is True


def test_prepare_pins_logo_then_metadata_and_passes_the_gateway_uri(app, sidecar_calls, ipfs_calls):
    result = _prepare(description="A test token", logo=_png_bytes())

    assert [kind for kind, _ in ipfs_calls] == ["file", "json"]
    assert ipfs_calls[0][1] == "TST_logo.png"
    metadata = ipfs_calls[1][1]
    assert metadata == {
        "name": "Test Token",
        "symbol": "TST",
        "description": "A test token",
        "image": "https://gw.example/ipfs/QmLogo",
    }
    assert result["metadata_uri"] == "https://gw.example/ipfs/QmMeta"
    assert sidecar_calls[0]["json"]["metadataUri"] == "https://gw.example/ipfs/QmMeta"


def test_prepare_rejects_a_non_image_logo_before_pinning_anything(app, sidecar_calls, ipfs_calls):
    with pytest.raises(solana_tokens.ValidationError, match="readable image"):
        _prepare(description="x", logo=b"definitely not an image")
    assert ipfs_calls == []
    assert sidecar_calls == []


def test_prepare_rejects_a_supply_that_overflows_the_u64_mint(app, sidecar_calls):
    # 20 billion tokens x 10^9 base units > 2^64 - 1 (~1.8e19).
    with pytest.raises(solana_tokens.ValidationError, match="too large for 9 decimals"):
        _prepare(decimals=9, supply="20000000000")
    assert sidecar_calls == []


def test_prepare_accepts_the_exact_u64_maximum(app, sidecar_calls):
    _prepare(decimals=0, supply=str(2**64 - 1))
    assert sidecar_calls[0]["json"]["amount"] == str(2**64 - 1)


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"network": "sepolia"}, "network must be one of"),
        ({"name": "x" * 33}, "name is required"),
        ({"name": "   "}, "name is required"),
        ({"symbol": "TOOLONGSYMB"}, "symbol is required"),
        ({"decimals": 10}, "decimals must be"),
        ({"supply": "0"}, "supply must be a positive"),
        ({"supply": "1.5"}, "supply must be a positive"),
    ],
)
def test_prepare_validation(app, sidecar_calls, overrides, message):
    with pytest.raises(solana_tokens.ValidationError, match=message):
        _prepare(**overrides)
    assert sidecar_calls == []


# --- record ----------------------------------------------------------------


def _chain(monkeypatch, *, tx=None, mint=None):
    monkeypatch.setattr(
        blockchain,
        "get_transaction_status",
        lambda network, sig: tx if tx is not None else {"status": "success", "account_keys": [CREATOR, MINT]},
    )
    monkeypatch.setattr(
        blockchain,
        "get_solana_mint_info",
        lambda network, address: mint
        if mint is not None
        else {
            "status": "success",
            "decimals": 6,
            "supply": "1000000000000",
            "mint_authority": None,
            "freeze_authority": None,
        },
    )


def _record(user, **overrides):
    kwargs = dict(
        user_id=user.id,
        network="solana_devnet",
        mint_address=MINT,
        transaction_signature=SIGNATURE,
        creator_wallet=CREATOR,
        name="Test Token",
        symbol="TST",
        metadata_uri="",
    )
    kwargs.update(overrides)
    return solana_tokens.record_token_launch(**kwargs)


def test_record_persists_what_the_chain_says_not_what_the_client_says(app, monkeypatch):
    _chain(
        monkeypatch,
        mint={
            "status": "success",
            "decimals": 2,
            "supply": "12345",
            "mint_authority": CREATOR,
            "freeze_authority": None,
        },
    )
    user = _make_user()
    launch = _record(user)

    assert launch.decimals == 2
    assert launch.supply_raw == "12345"
    assert launch.mint_authority_revoked is False
    assert launch.freeze_authority_revoked is True
    assert launch.explorer_url == f"https://explorer.solana.com/address/{MINT}?cluster=devnet"


def test_record_rejects_a_transaction_paid_for_by_someone_else(app, monkeypatch):
    _chain(monkeypatch, tx={"status": "success", "account_keys": [MINT, CREATOR]})
    with pytest.raises(solana_tokens.ValidationError, match="not paid for by"):
        _record(_make_user())


def test_record_rejects_a_transaction_that_does_not_touch_the_mint(app, monkeypatch):
    _chain(monkeypatch, tx={"status": "success", "account_keys": [CREATOR]})
    with pytest.raises(solana_tokens.ValidationError, match="does not reference"):
        _record(_make_user())


def test_record_rejects_a_failed_transaction(app, monkeypatch):
    _chain(monkeypatch, tx={"status": "failed", "account_keys": [CREATOR, MINT]})
    with pytest.raises(solana_tokens.ValidationError, match="not a confirmed success"):
        _record(_make_user())


def test_record_rejects_an_address_that_is_not_an_spl_mint(app, monkeypatch):
    _chain(monkeypatch, mint={"status": "not_a_mint"})
    with pytest.raises(solana_tokens.ValidationError, match="not a readable SPL mint"):
        _record(_make_user())


def test_record_is_idempotent_for_the_same_owner_only(app, monkeypatch):
    _chain(monkeypatch)
    owner = _make_user()
    first = _record(owner)
    assert _record(owner).id == first.id
    assert SolanaTokenLaunch.query.count() == 1

    stranger = _make_user(wallet="SoLOther11111111111111111111111111111111111")
    with pytest.raises(solana_tokens.ValidationError, match="different account"):
        _record(stranger)


# --- on-chain mint reader --------------------------------------------------


def test_get_solana_mint_info_reports_bad_input_instead_of_raising(app):
    assert blockchain.get_solana_mint_info("sepolia", MINT)["status"] == "error"
    assert blockchain.get_solana_mint_info("solana_devnet", "not-a-pubkey")["status"] == "error"


# --- routes ----------------------------------------------------------------


def test_prepare_route_requires_auth(client):
    assert client.post("/api/solana-tokens/prepare", data={}).status_code == 401


def test_prepare_route_forwards_multipart_fields_and_logo(app, client, monkeypatch):
    captured = {}

    def fake_prepare(**kwargs):
        captured.update(kwargs)
        return {"mint": MINT, "transaction": "dHg=", "metadata_uri": ""}

    monkeypatch.setattr(solana_tokens, "prepare_token_launch", fake_prepare)
    user = _make_user()
    response = client.post(
        "/api/solana-tokens/prepare",
        headers=_auth(user),
        data={
            "network": "solana_devnet",
            "creator_wallet": CREATOR,
            "name": "Test Token",
            "symbol": "TST",
            "decimals": "6",
            "supply": "1000",
            "revoke_mint_authority": "false",
            "logo": (io.BytesIO(b"logo-bytes"), "logo.png"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert captured["decimals"] == 6
    assert captured["logo"] == b"logo-bytes"
    assert captured["revoke_mint_authority"] is False
    assert captured["revoke_freeze_authority"] is True


def test_prepare_route_explains_missing_pinata_config(app, client, monkeypatch):
    def fake_prepare(**kwargs):
        raise ipfs.IPFSNotConfiguredError("Pinata is not configured")

    monkeypatch.setattr(solana_tokens, "prepare_token_launch", fake_prepare)
    response = client.post(
        "/api/solana-tokens/prepare",
        headers=_auth(_make_user()),
        data={"network": "solana_devnet", "creator_wallet": CREATOR, "name": "T", "symbol": "T", "decimals": "0", "supply": "1"},
        content_type="multipart/form-data",
    )
    assert response.status_code == 503
    assert "without a description/logo" in response.get_json()["error"]


def test_prepare_route_passes_through_a_sidecar_4xx(app, client, monkeypatch):
    def fake_prepare(**kwargs):
        raise candy_machine.CandyMachineServiceError("bad input", status_code=400)

    monkeypatch.setattr(solana_tokens, "prepare_token_launch", fake_prepare)
    response = client.post(
        "/api/solana-tokens/prepare",
        headers=_auth(_make_user()),
        data={"network": "solana_devnet", "creator_wallet": CREATOR, "name": "T", "symbol": "T", "decimals": "0", "supply": "1"},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400


def test_record_and_list_routes(app, client, monkeypatch):
    _chain(monkeypatch)
    user = _make_user()
    body = {
        "network": "solana_devnet",
        "mint_address": MINT,
        "transaction_signature": SIGNATURE,
        "creator_wallet": CREATOR,
        "name": "Test Token",
        "symbol": "TST",
    }
    created = client.post("/api/solana-tokens", headers=_auth(user), json=body)
    assert created.status_code == 201
    assert created.get_json()["token"]["mint_authority_revoked"] is True

    listed = client.get("/api/solana-tokens", headers=_auth(user))
    assert [t["mint_address"] for t in listed.get_json()["tokens"]] == [MINT]

    other = _make_user(wallet="SoLOther11111111111111111111111111111111111")
    assert client.get("/api/solana-tokens", headers=_auth(other)).get_json()["tokens"] == []


def test_record_route_rejects_non_string_fields(app, client):
    response = client.post(
        "/api/solana-tokens",
        headers=_auth(_make_user()),
        json={
            "network": "solana_devnet",
            "mint_address": ["not", "a", "string"],
            "transaction_signature": SIGNATURE,
            "creator_wallet": CREATOR,
            "name": "T",
            "symbol": "T",
        },
    )
    assert response.status_code == 400
