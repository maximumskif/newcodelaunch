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


def _record_via_route(client, user, **extra):
    body = {
        "network": "solana_devnet",
        "mint_address": MINT,
        "transaction_signature": SIGNATURE,
        "creator_wallet": CREATOR,
        "name": "Test Token",
        "symbol": "TST",
        **extra,
    }
    return client.post("/api/solana-tokens", headers=_auth(user), json=body)


def test_recording_links_an_owned_token_project(app, client, monkeypatch):
    from app.services import projects

    _chain(monkeypatch)
    user = _make_user()
    project = projects.create_project(user.id, "My Solana Token", "token", "solana", network="solana_devnet")

    assert _record_via_route(client, user, project_id=project.id).status_code == 201

    linked = project.to_dict()["solana_token_launch"]
    assert linked["mint_address"] == MINT
    assert project.status == "active"


def test_recording_never_links_someone_elses_project(app, client, monkeypatch):
    from app.services import projects

    _chain(monkeypatch)
    owner = _make_user()
    stranger = _make_user(wallet="SoLOther11111111111111111111111111111111111")
    theirs = projects.create_project(stranger.id, "Not yours", "token", "solana")

    # The launch still records — linking is best-effort — but their project is untouched.
    assert _record_via_route(client, owner, project_id=theirs.id).status_code == 201
    assert theirs.solana_token_launch_id is None


def test_first_linked_launch_wins(app, monkeypatch):
    from app.services import projects

    _chain(monkeypatch)
    user = _make_user()
    project = projects.create_project(user.id, "P", "token", "solana")
    first = _record(user)
    projects.link_solana_token(project, first)
    other = SolanaTokenLaunch(
        user_id=user.id, network="solana_devnet", mint_address="Other1111111111111111111111111111111111111",
        transaction_signature="7" * 88, creator_wallet=CREATOR, name="B", symbol="B", decimals=0, supply_raw="1",
        mint_authority_revoked=True, freeze_authority_revoked=True,
    )
    _db.session.add(other)
    _db.session.commit()
    projects.link_solana_token(project, other)
    assert project.solana_token_launch_id == first.id


# --- owner tools ---------------------------------------------------------------

TRANSFERRED_AUTHORITY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"


def _kept_authorities(**overrides):
    mint = {"status": "success", "decimals": 2, "supply": "100000", "mint_authority": CREATOR, "freeze_authority": CREATOR}
    mint.update(overrides)
    return mint


def test_mint_more_is_built_for_the_current_on_chain_authority(app, monkeypatch, sidecar_calls):
    _chain(monkeypatch, mint=_kept_authorities(mint_authority=TRANSFERRED_AUTHORITY))
    launch = _record(_make_user())

    result = solana_tokens.prepare_token_action(launch, "mint", "500")

    call = sidecar_calls[-1]
    assert call["path"] == f"/internal/token/{MINT}/prepare-action"
    # Whoever holds the authority now — not necessarily the launch-time creator.
    assert call["json"]["authorityPublicKey"] == TRANSFERRED_AUTHORITY
    assert call["json"]["amount"] == "50000"  # 500 tokens x 10^2
    assert result["authority"] == TRANSFERRED_AUTHORITY


def test_actions_on_an_already_revoked_authority_are_refused(app, monkeypatch, sidecar_calls):
    _chain(monkeypatch, mint=_kept_authorities(mint_authority=None, freeze_authority=None))
    launch = _record(_make_user())
    with pytest.raises(solana_tokens.ValidationError, match="supply is already fixed"):
        solana_tokens.prepare_token_action(launch, "mint", "1")
    with pytest.raises(solana_tokens.ValidationError, match="freeze authority is already revoked"):
        solana_tokens.prepare_token_action(launch, "revokeFreeze")
    assert not any(c["path"].endswith("/prepare-action") for c in sidecar_calls)


def test_mint_more_rejects_bad_amounts_and_u64_overflow(app, monkeypatch, sidecar_calls):
    _chain(monkeypatch, mint=_kept_authorities(decimals=0, supply=str(2**64 - 10)))
    launch = _record(_make_user())
    with pytest.raises(solana_tokens.ValidationError, match="at most 9 more tokens"):
        solana_tokens.prepare_token_action(launch, "mint", "10")
    with pytest.raises(solana_tokens.ValidationError, match="positive whole number"):
        solana_tokens.prepare_token_action(launch, "mint", "1.5")
    with pytest.raises(solana_tokens.ValidationError, match="action must be one of"):
        solana_tokens.prepare_token_action(launch, "burnEverything")


def test_refresh_reads_supply_and_authorities_back_from_the_chain(app, monkeypatch):
    _chain(monkeypatch, mint=_kept_authorities())
    launch = _record(_make_user())
    assert launch.mint_authority_revoked is False

    _chain(monkeypatch, mint=_kept_authorities(supply="150000", mint_authority=None))
    refreshed = solana_tokens.refresh_token_launch(launch)

    assert refreshed["token"]["supply_raw"] == "150000"
    assert refreshed["token"]["mint_authority_revoked"] is True
    assert refreshed["token"]["freeze_authority_revoked"] is False
    assert (refreshed["mint_authority"], refreshed["freeze_authority"]) == (None, CREATOR)


def test_owner_tool_routes_are_owner_only(app, client, monkeypatch, sidecar_calls):
    _chain(monkeypatch, mint=_kept_authorities())
    owner = _make_user()
    launch = _record(owner)
    stranger = _make_user(wallet="SoLOther11111111111111111111111111111111111")

    for path, body in [(f"/api/solana-tokens/{launch.id}/prepare-action", {"action": "revokeMint"}), (f"/api/solana-tokens/{launch.id}/refresh", None)]:
        assert client.post(path, headers=_auth(stranger), json=body or {}).status_code == 404
        assert client.post(path, headers=_auth(owner), json=body or {}).status_code == 200
    assert client.post(
        f"/api/solana-tokens/{launch.id}/prepare-action", headers=_auth(owner), json={"action": "mint", "amount": 5}
    ).status_code == 400


# --- metadata after launch -------------------------------------------------------

GATEWAY_JSON = f"{ipfs.PINATA_GATEWAY}QmCurrent"


@pytest.fixture
def token_metadata(monkeypatch):
    """A fake sidecar that also serves on-chain metadata, plus whatever the
    off-chain JSON fetch would return."""
    state = {
        "on_chain": {"name": "Test Token", "symbol": "TST", "uri": GATEWAY_JSON, "update_authority": CREATOR, "is_mutable": True},
        "off_chain": {"description": "Old words", "image": "https://gw.example/ipfs/QmOldLogo"},
        "calls": [],
        "fetched": [],
    }

    def fake_sidecar(method, path, *, json=None, params=None, timeout):
        state["calls"].append({"path": path, "json": json})
        if path.endswith("/metadata"):
            return state["on_chain"]
        return {"transaction": "dHg="}

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return state["off_chain"]

    def fake_get(url, timeout, allow_redirects):
        state["fetched"].append(url)
        return _Response()

    monkeypatch.setattr(solana_tokens, "_sidecar_request", fake_sidecar)
    monkeypatch.setattr(solana_tokens.requests, "get", fake_get)
    return state


def test_metadata_reads_off_chain_json_only_from_this_apps_gateway(app, monkeypatch, token_metadata):
    _chain(monkeypatch)
    launch = _record(_make_user())
    current = solana_tokens.get_token_metadata(launch)
    assert (current["description"], current["image"]) == ("Old words", "https://gw.example/ipfs/QmOldLogo")

    # A URI anywhere else is never fetched server-side (SSRF guard).
    token_metadata["on_chain"]["uri"] = "http://169.254.169.254/latest/meta-data"
    token_metadata["fetched"].clear()
    current = solana_tokens.get_token_metadata(launch)
    assert token_metadata["fetched"] == []
    assert (current["description"], current["image"]) == ("", None)


def test_editing_the_description_re_pins_json_keeping_the_current_logo(app, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    launch = _record(_make_user())
    result = solana_tokens.prepare_metadata_update(launch, "Renamed", "NEW", "New words")

    assert ipfs_calls == [
        ("json", {"name": "Renamed", "symbol": "NEW", "description": "New words", "image": "https://gw.example/ipfs/QmOldLogo"})
    ]
    payload = token_metadata["calls"][-1]["json"]
    assert token_metadata["calls"][-1]["path"] == f"/internal/token/{MINT}/prepare-metadata-update"
    assert payload == {
        "network": "devnet",
        "authorityPublicKey": CREATOR,
        "name": "Renamed",
        "symbol": "NEW",
        "metadataUri": "https://gw.example/ipfs/QmMeta",
    }
    assert result["authority"] == CREATOR


def test_a_new_logo_replaces_the_old_one(app, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    launch = _record(_make_user())
    solana_tokens.prepare_metadata_update(launch, "Test Token", "TST", "Old words", logo=_png_bytes())
    assert [kind for kind, _ in ipfs_calls] == ["file", "json"]
    assert ipfs_calls[1][1]["image"] == "https://gw.example/ipfs/QmLogo"


def test_lock_only_changes_nothing_else_and_pins_nothing(app, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    launch = _record(_make_user())
    solana_tokens.prepare_metadata_update(launch, "Test Token", "TST", "Old words", lock=True)
    assert ipfs_calls == []
    payload = token_metadata["calls"][-1]["json"]
    assert payload["lock"] is True
    assert "metadataUri" not in payload


def test_a_token_without_off_chain_metadata_renames_without_pinning(app, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    token_metadata["on_chain"]["uri"] = ""
    launch = _record(_make_user())
    solana_tokens.prepare_metadata_update(launch, "Renamed", "TST")
    assert ipfs_calls == []
    assert "metadataUri" not in token_metadata["calls"][-1]["json"]


def test_locked_or_unchanged_metadata_is_refused_before_building(app, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    launch = _record(_make_user())
    with pytest.raises(solana_tokens.ValidationError, match="Nothing to change"):
        solana_tokens.prepare_metadata_update(launch, "Test Token", "TST", "Old words")
    token_metadata["on_chain"]["is_mutable"] = False
    with pytest.raises(solana_tokens.ValidationError, match="locked"):
        solana_tokens.prepare_metadata_update(launch, "Renamed", "TST")
    assert not any(c["path"].endswith("prepare-metadata-update") for c in token_metadata["calls"])
    assert ipfs_calls == []


def test_refresh_picks_up_changed_metadata(app, monkeypatch, token_metadata):
    _chain(monkeypatch)
    launch = _record(_make_user())
    token_metadata["on_chain"].update(name="Renamed", symbol="NEW", uri="https://x/new.json", is_mutable=False)
    token = solana_tokens.refresh_token_launch(launch)["token"]
    assert (token["name"], token["symbol"], token["metadata_uri"], token["metadata_locked"]) == (
        "Renamed", "NEW", "https://x/new.json", True
    )


def test_metadata_routes_are_owner_only(app, client, monkeypatch, token_metadata, ipfs_calls):
    _chain(monkeypatch)
    owner = _make_user()
    launch = _record(owner)
    stranger = _make_user(wallet="SoLOther11111111111111111111111111111111111")
    assert client.get(f"/api/solana-tokens/{launch.id}/metadata", headers=_auth(stranger)).status_code == 404
    assert client.get(f"/api/solana-tokens/{launch.id}/metadata", headers=_auth(owner)).get_json()["description"] == "Old words"
    form = {"name": "Renamed", "symbol": "TST", "description": "Old words", "lock": "true"}
    assert client.post(f"/api/solana-tokens/{launch.id}/prepare-metadata-update", headers=_auth(stranger), data=form).status_code == 404
    response = client.post(f"/api/solana-tokens/{launch.id}/prepare-metadata-update", headers=_auth(owner), data=form)
    assert response.status_code == 200
    assert token_metadata["calls"][-1]["json"]["lock"] is True
