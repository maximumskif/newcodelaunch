from datetime import datetime, timedelta, timezone

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.candy_machine import CandyMachineDeployment
from app.models.nft import NFTCollection, NFTGeneratedItem
from app.models.user import Chain, User
from app.services import blockchain, candy_machine

CREATOR = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
CANDY = "2xNweLHLqrxsFCTd7oPHruTxSD5siVBt7XSQP2Vth2mB"
FAN = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
OUTSIDER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"
ROOT = "cd" * 32

NOW = datetime.now(timezone.utc)
WL_START = (NOW - timedelta(hours=1)).replace(microsecond=0)
PUBLIC_START = (NOW + timedelta(days=1)).replace(microsecond=0)
ALLOWLIST = {"addresses": [CREATOR, FAN], "price_sol": 0.05, "start_date": WL_START.isoformat()}


def _iso_z(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _phased_guards(**overrides):
    wl = {
        "label": "wl",
        "price_lamports": "50000000",
        "payment_destination": CREATOR,
        "start_date": _iso_z(WL_START),
        "end_date": _iso_z(PUBLIC_START),
        "merkle_root": ROOT,
    }
    pub = {
        "label": "pub",
        "price_lamports": "200000000",
        "payment_destination": CREATOR,
        "start_date": _iso_z(PUBLIC_START),
        "end_date": None,
        "merkle_root": None,
    }
    wl.update(overrides.get("wl", {}))
    pub.update(overrides.get("pub", {}))
    empty = {"price_lamports": None, "payment_destination": None, "start_date": None, "end_date": None, "merkle_root": None}
    return {"default": empty, "groups": [wl, pub]}


@pytest.fixture
def sidecar(monkeypatch):
    state = {"guards": _phased_guards(), "calls": [], "minted": 0}

    def fake(method, path, *, json=None, params=None, timeout):
        state["calls"].append({"method": method, "path": path, "json": json})
        if path.endswith("/guards"):
            return state["guards"]
        if path.endswith("/merkle-root"):
            return {"merkle_root": ROOT}
        if path.endswith("/prepare-candy-machine"):
            return {"candy_machine": CANDY, "transactions": ["tx"]}
        if path.endswith("/minted"):
            if state["minted"] is None:
                raise candy_machine.CandyMachineServiceError("RPC down")
            return {"minted": state["minted"]}
        if path.endswith("/prepare-update"):
            return {"transaction": "tx"}
        if path.endswith("/mint"):
            return {"transaction": "tx", "nft_mint": "nft"}
        if path.endswith("/status"):
            return {"items_available": 2, "items_redeemed": 2, "items_remaining": 0}
        raise AssertionError(path)

    monkeypatch.setattr(candy_machine, "_sidecar_request", fake)
    monkeypatch.setattr(
        blockchain, "get_transaction_status", lambda network, sig: {"status": "success", "account_keys": [CREATOR, CANDY]}
    )
    return state


def _collection():
    user = User(wallet_address=CREATOR, chain=Chain.SOLANA)
    _db.session.add(user)
    _db.session.commit()
    collection = NFTCollection(user_id=user.id, name="Phased", description="", collection_size=2, image_size=64)
    _db.session.add(collection)
    _db.session.commit()
    for index in (1, 2):
        _db.session.add(
            NFTGeneratedItem(
                collection_id=collection.id,
                token_index=index,
                attributes=[],
                image_path=f"{index}.png",
                ipfs_image_hash=f"QmI{index}",
                ipfs_metadata_hash=f"QmM{index}",
            )
        )
    _db.session.commit()
    return user, collection


def _record(collection, allowlist=ALLOWLIST, price_sol=0.2):
    return candy_machine.record_candy_machine(
        collection=collection,
        network="solana_devnet",
        collection_mint=CREATOR,
        candy_machine=CANDY,
        transaction_signatures=["5" * 88],
        price_sol=price_sol,
        items_available=2,
        go_live_date=PUBLIC_START.isoformat(),
        creator_wallet=CREATOR,
        allowlist=allowlist,
    )


# --- validation / prepare ----------------------------------------------------


@pytest.mark.parametrize(
    "allowlist, message",
    [
        ("nope", "must be an object"),
        ({**ALLOWLIST, "addresses": []}, "non-empty list"),
        ({**ALLOWLIST, "addresses": [CREATOR, CREATOR]}, "duplicates"),
        ({**ALLOWLIST, "addresses": ["not-a-wallet"]}, "Not a valid Solana wallet"),
        ({**ALLOWLIST, "price_sol": 0}, "between 0.000001"),
        ({**ALLOWLIST, "start_date": PUBLIC_START.isoformat()}, "must start before the public phase"),
        ({**ALLOWLIST, "start_date": "yesterday"}, "valid ISO 8601"),
    ],
)
def test_allowlist_validation(app, allowlist, message):
    with pytest.raises(candy_machine.ValidationError, match=message):
        candy_machine._validate_allowlist(allowlist, PUBLIC_START.isoformat())


def test_allowlist_is_capped(app):
    with pytest.raises(candy_machine.ValidationError, match="at most 2000"):
        candy_machine._validate_allowlist({**ALLOWLIST, "addresses": [CREATOR] * 2001}, PUBLIC_START.isoformat())


def test_prepare_step_forwards_the_allowlist_phase(app, sidecar):
    _, collection = _collection()
    candy_machine.prepare_candy_machine_step(
        collection, "solana_devnet", CREATOR, CREATOR, 0.2, PUBLIC_START.isoformat(), allowlist=ALLOWLIST
    )
    payload = sidecar["calls"][-1]["json"]
    assert payload["allowlist"] == {"addresses": [CREATOR, FAN], "priceSol": 0.05, "startDate": WL_START.isoformat()}


# --- record: checked against the chain ---------------------------------------


def test_record_stores_a_phased_drop_that_matches_the_chain(app, sidecar):
    _, collection = _collection()
    deployment = _record(collection)
    assert deployment.allowlist["addresses"] == [CREATOR, FAN]
    assert deployment.to_dict()["allowlist"] == {"price_sol": 0.05, "start_date": WL_START.isoformat(), "size": 2}
    assert "addresses" not in str(deployment.to_dict())


@pytest.mark.parametrize(
    "guards, message",
    [
        (_phased_guards(wl={"merkle_root": "ee" * 32}), "allowlist doesn't match the wallet list"),
        (_phased_guards(wl={"price_lamports": "1"}), "allowlist guard .*price"),
        (_phased_guards(pub={"payment_destination": OUTSIDER}), "public guard .*payment destination"),
        (_phased_guards(wl={"end_date": None}), "allowlist guard .*end date"),
        (_phased_guards(pub={"start_date": _iso_z(PUBLIC_START + timedelta(hours=1))}), "public guard .*start date"),
    ],
)
def test_record_rejects_a_claim_the_chain_contradicts(app, sidecar, guards, message):
    sidecar["guards"] = guards
    _, collection = _collection()
    with pytest.raises(candy_machine.ValidationError, match=message):
        _record(collection)
    assert CandyMachineDeployment.query.count() == 0


def test_record_rejects_phases_that_exist_on_one_side_only(app, sidecar):
    _, collection = _collection()
    with pytest.raises(candy_machine.ValidationError, match="has phases, but"):
        _record(collection, allowlist=None)

    sidecar["guards"] = {"default": _phased_guards()["groups"][1], "groups": []}
    with pytest.raises(candy_machine.ValidationError, match="expected allowlist and public phases"):
        _record(collection)


# --- phases, storefront, mint --------------------------------------------------


def _deployment(allowlist=ALLOWLIST, go_live=PUBLIC_START):
    user, collection = _collection()
    deployment = CandyMachineDeployment(
        user_id=user.id,
        nft_collection_id=collection.id,
        network="solana_devnet",
        collection_mint=CREATOR,
        candy_machine=CANDY,
        price_sol=0.2,
        items_available=2,
        go_live_date=go_live,
        allowlist=allowlist,
        creator_wallet=CREATOR,
        transaction_signatures=["5" * 88],
    )
    _db.session.add(deployment)
    _db.session.commit()
    return deployment


def test_current_phase_windows(app):
    deployment = _deployment()
    assert candy_machine.current_phase(deployment, WL_START - timedelta(seconds=1)) == "upcoming"
    assert candy_machine.current_phase(deployment, WL_START) == "allowlist"
    assert candy_machine.current_phase(deployment, PUBLIC_START) == "public"
    plain = CandyMachineDeployment(go_live_date=PUBLIC_START, allowlist=None)
    assert candy_machine.current_phase(plain, WL_START) == "upcoming"


def test_storefront_status_tells_a_wallet_whether_and_what_it_can_mint(app, sidecar):
    _deployment()
    fan = candy_machine.get_public_candy_machine_status(CANDY, FAN)
    outsider = candy_machine.get_public_candy_machine_status(CANDY, OUTSIDER)
    anonymous = candy_machine.get_public_candy_machine_status(CANDY)

    assert fan["phase"] == "allowlist"
    assert (fan["allowlisted"], fan["mint_price_sol"]) == (True, 0.05)
    assert (outsider["allowlisted"], outsider["mint_price_sol"]) == (False, None)
    assert anonymous["allowlisted"] is None
    assert fan["allowlist"] == {"price_sol": 0.05, "start_date": WL_START.isoformat(), "size": 2}
    assert FAN not in str(outsider)


def test_mint_during_the_allowlist_phase_uses_the_wl_group_with_the_list(app, sidecar):
    _deployment()
    candy_machine.prepare_mint(CANDY, FAN)
    payload = sidecar["calls"][-1]["json"]
    assert payload["group"] == "wl"
    assert payload["allowlist"] == [CREATOR, FAN]


def test_an_outsider_is_refused_during_the_allowlist_phase(app, sidecar):
    _deployment()
    with pytest.raises(candy_machine.NotEligibleError, match="allowlist-only"):
        candy_machine.prepare_mint(CANDY, OUTSIDER)
    assert not any(call["path"].endswith("/mint") for call in sidecar["calls"])


def test_public_phase_uses_the_pub_group_for_anyone(app, sidecar):
    _deployment(go_live=NOW - timedelta(minutes=1), allowlist={**ALLOWLIST, "start_date": (NOW - timedelta(hours=2)).isoformat()})
    candy_machine.prepare_mint(CANDY, OUTSIDER)
    payload = sidecar["calls"][-1]["json"]
    assert payload["group"] == "pub"
    assert "allowlist" not in payload


def test_a_drop_without_phases_mints_without_a_group_and_refuses_before_go_live(app, sidecar):
    deployment = _deployment(allowlist=None, go_live=NOW + timedelta(hours=1))
    with pytest.raises(candy_machine.NotEligibleError, match="isn't open yet"):
        candy_machine.prepare_mint(CANDY, OUTSIDER)

    deployment.go_live_date = NOW - timedelta(minutes=1)
    _db.session.commit()
    candy_machine.prepare_mint(CANDY, OUTSIDER)
    assert "group" not in sidecar["calls"][-1]["json"]


def test_mint_route_maps_ineligible_to_403(app, client, sidecar):
    _deployment()
    response = client.post(f"/api/mint/public/{CANDY}/mint", json={"minter_wallet": OUTSIDER})
    assert response.status_code == 403
    assert "allowlist-only" in response.get_json()["error"]


def test_dashboard_revenue_is_a_range_for_a_two_price_drop(app, sidecar):
    deployment = _deployment()
    dashboard = candy_machine.get_creator_dashboard(deployment.user_id)
    drop = dashboard["drops"][0]
    # 2 minted at either 0.05 (allowlist) or 0.2 (public) each.
    assert (drop["revenue_min_sol"], drop["revenue_max_sol"]) == (0.1, 0.4)
    assert drop["phase"] == "allowlist"


def test_record_route_passes_the_allowlist_through(app, client, sidecar):
    user, collection = _collection()
    response = client.post(
        "/api/mint/candy-machines",
        headers={"Authorization": f"Bearer {create_access_token(identity=user.id)}"},
        json={
            "collection_id": collection.id,
            "network": "solana_devnet",
            "collection_mint": CREATOR,
            "candy_machine": CANDY,
            "transaction_signatures": ["5" * 88],
            "price_sol": 0.2,
            "items_available": 2,
            "go_live_date": PUBLIC_START.isoformat(),
            "creator_wallet": CREATOR,
            "allowlist": ALLOWLIST,
        },
    )
    assert response.status_code == 201
    assert response.get_json()["candy_machine"]["allowlist"]["size"] == 2


# --- editing a live drop's phases --------------------------------------------


def _single_phase_guards(price_lamports: str, start: datetime):
    return {
        "default": {
            "price_lamports": price_lamports,
            "payment_destination": CREATOR,
            "start_date": _iso_z(start),
            "end_date": None,
            "merkle_root": None,
        },
        "groups": [],
    }


def test_prepare_update_is_built_for_the_creator_wallet_with_the_new_phases(app, sidecar):
    deployment = _deployment()
    candy_machine.prepare_phase_update(deployment, 0.3, PUBLIC_START.isoformat(), {**ALLOWLIST, "price_sol": 0.1})
    call = sidecar["calls"][-1]
    assert call["path"] == f"/internal/candy-machine/{CANDY}/prepare-update"
    assert call["json"]["creatorPublicKey"] == CREATOR
    assert call["json"]["priceSol"] == 0.3
    assert call["json"]["allowlist"]["priceSol"] == 0.1


def test_prepare_update_validates_before_building_anything(app, sidecar):
    deployment = _deployment()
    with pytest.raises(candy_machine.ValidationError, match="must start before the public phase"):
        candy_machine.prepare_phase_update(deployment, 0.3, WL_START.isoformat(), ALLOWLIST)
    with pytest.raises(candy_machine.ValidationError, match="price_sol must be between"):
        candy_machine.prepare_phase_update(deployment, 0, PUBLIC_START.isoformat())
    assert sidecar["calls"] == []


def test_apply_update_records_the_new_phases_once_the_chain_shows_them(app, sidecar):
    deployment = _deployment()  # allowlist at 0.05, public at 0.2
    deployment.prices_seen = [0.05, 0.2]
    new_start = (NOW - timedelta(minutes=5)).replace(microsecond=0)
    sidecar["guards"] = _single_phase_guards("300000000", new_start)

    candy_machine.apply_phase_update(deployment, "6" * 88, 0.3, new_start.isoformat(), None)

    assert deployment.price_sol == 0.3
    assert deployment.allowlist is None
    assert deployment.transaction_signatures == ["5" * 88, "6" * 88]
    # Earlier mints may have paid 0.05 or 0.2 — the revenue range keeps them.
    assert deployment.prices_seen == [0.05, 0.2, 0.3]
    assert candy_machine.current_phase(deployment) == "public"


def test_apply_update_changes_nothing_when_the_chain_disagrees(app, sidecar):
    deployment = _deployment()
    sidecar["guards"] = _single_phase_guards("999", NOW)  # not what's being claimed
    with pytest.raises(candy_machine.ValidationError, match="doesn't match"):
        candy_machine.apply_phase_update(deployment, "6" * 88, 0.3, NOW.isoformat(), None)
    _db.session.refresh(deployment)
    assert deployment.price_sol == 0.2
    assert deployment.allowlist is not None


def test_apply_update_requires_a_successful_tx_paid_by_the_creator(app, sidecar, monkeypatch):
    deployment = _deployment()
    monkeypatch.setattr(blockchain, "get_transaction_status", lambda n, s: {"status": "success", "account_keys": [OUTSIDER]})
    with pytest.raises(candy_machine.ValidationError, match="creator wallet"):
        candy_machine.apply_phase_update(deployment, "6" * 88, 0.2, PUBLIC_START.isoformat(), ALLOWLIST)
    monkeypatch.setattr(blockchain, "get_transaction_status", lambda n, s: {"status": "failed", "account_keys": [CREATOR]})
    with pytest.raises(candy_machine.ValidationError, match="not a confirmed success"):
        candy_machine.apply_phase_update(deployment, "6" * 88, 0.2, PUBLIC_START.isoformat(), ALLOWLIST)


def test_dashboard_range_spans_prices_from_before_an_edit(app, sidecar):
    deployment = _deployment(allowlist=None, go_live=NOW - timedelta(hours=1))
    deployment.price_sol = 0.3
    deployment.prices_seen = [0.1, 0.3]
    _db.session.commit()
    drop = candy_machine.get_creator_dashboard(deployment.user_id)["drops"][0]
    # 2 minted, at 0.1 (before the edit) or 0.3 (after).
    assert (drop["revenue_min_sol"], drop["revenue_max_sol"]) == (0.2, 0.6)


def test_phase_edit_routes_are_owner_only(app, client, sidecar):
    deployment = _deployment()
    owner = {"Authorization": f"Bearer {create_access_token(identity=deployment.user_id)}"}
    stranger_user = User(wallet_address=OUTSIDER, chain=Chain.SOLANA)
    _db.session.add(stranger_user)
    _db.session.commit()
    stranger = {"Authorization": f"Bearer {create_access_token(identity=stranger_user.id)}"}
    body = {"price_sol": 0.2, "go_live_date": PUBLIC_START.isoformat(), "allowlist": ALLOWLIST}

    assert client.post(f"/api/mint/candy-machines/{deployment.id}/prepare-update", headers=stranger, json=body).status_code == 404
    assert client.post(f"/api/mint/candy-machines/{deployment.id}/prepare-update", headers=owner, json={}).status_code == 400
    prepared = client.post(f"/api/mint/candy-machines/{deployment.id}/prepare-update", headers=owner, json=body)
    assert prepared.status_code == 200

    assert client.post(
        f"/api/mint/candy-machines/{deployment.id}/phases", headers=owner, json=body
    ).status_code == 400  # no signature
    applied = client.post(
        f"/api/mint/candy-machines/{deployment.id}/phases", headers=owner, json={**body, "transaction_signature": "6" * 88}
    )
    assert applied.status_code == 200
    assert applied.get_json()["candy_machine"]["allowlist"]["size"] == 2


def test_full_allowlist_is_for_the_owner_only(app, client, sidecar):
    deployment = _deployment()
    owner = {"Authorization": f"Bearer {create_access_token(identity=deployment.user_id)}"}
    stranger_user = User(wallet_address=OUTSIDER, chain=Chain.SOLANA)
    _db.session.add(stranger_user)
    _db.session.commit()
    stranger = {"Authorization": f"Bearer {create_access_token(identity=stranger_user.id)}"}

    assert client.get(f"/api/mint/candy-machines/{deployment.id}/allowlist", headers=owner).get_json() == {"addresses": [CREATOR, FAN]}
    assert client.get(f"/api/mint/candy-machines/{deployment.id}/allowlist", headers=stranger).status_code == 404
    assert client.get(f"/api/mint/candy-machines/{deployment.id}/allowlist").status_code == 401


# --- per-wallet mint limit ---------------------------------------------------


@pytest.mark.parametrize("value", [0, 65536, "abc", True, 1.5])
def test_mint_limit_validation(app, value):
    with pytest.raises(candy_machine.ValidationError, match="mint_limit"):
        candy_machine._validate_mint_limit(value)


def test_mint_limit_is_forwarded_at_launch_and_on_edit(app, sidecar):
    deployment = _deployment()
    collection = _db.session.get(NFTCollection, deployment.nft_collection_id)
    candy_machine.prepare_candy_machine_step(
        collection, "solana_devnet", CREATOR, CREATOR, 0.2, PUBLIC_START.isoformat(), allowlist=ALLOWLIST, mint_limit=3
    )
    assert sidecar["calls"][-1]["json"]["mintLimit"] == 3
    candy_machine.prepare_phase_update(deployment, 0.2, PUBLIC_START.isoformat(), ALLOWLIST, mint_limit="5")
    assert sidecar["calls"][-1]["json"]["mintLimit"] == 5
    candy_machine.prepare_phase_update(deployment, 0.2, PUBLIC_START.isoformat(), ALLOWLIST, mint_limit=None)
    assert "mintLimit" not in sidecar["calls"][-1]["json"]


def _with_default_limit(guards, limit):
    guards["default"]["mint_limit"] = limit
    return guards


def test_record_checks_the_mint_limit_against_the_chain(app, sidecar):
    _, collection = _collection()
    sidecar["guards"] = _with_default_limit(_phased_guards(), 3)
    with pytest.raises(candy_machine.ValidationError, match="mint limit"):
        _record(collection)  # claims no limit, chain has 3
    with pytest.raises(candy_machine.ValidationError, match="mint limit"):
        candy_machine.record_candy_machine(
            collection=collection, network="solana_devnet", collection_mint=CREATOR, candy_machine=CANDY,
            transaction_signatures=["5" * 88], price_sol=0.2, items_available=2,
            go_live_date=PUBLIC_START.isoformat(), creator_wallet=CREATOR, allowlist=ALLOWLIST, mint_limit=2,
        )
    deployment = candy_machine.record_candy_machine(
        collection=collection, network="solana_devnet", collection_mint=CREATOR, candy_machine=CANDY,
        transaction_signatures=["5" * 88], price_sol=0.2, items_available=2,
        go_live_date=PUBLIC_START.isoformat(), creator_wallet=CREATOR, allowlist=ALLOWLIST, mint_limit=3,
    )
    assert deployment.mint_limit == 3
    assert deployment.to_dict()["mint_limit"] == 3


def test_a_limit_inside_a_group_is_rejected(app, sidecar):
    _, collection = _collection()
    sidecar["guards"] = _phased_guards(pub={"mint_limit": 3})
    with pytest.raises(candy_machine.ValidationError, match="mint limit"):
        _record(collection)


def test_storefront_shows_a_wallets_count_and_when_it_hit_the_limit(app, sidecar):
    deployment = _deployment()
    deployment.mint_limit = 2
    _db.session.commit()

    sidecar["minted"] = 1
    status = candy_machine.get_public_candy_machine_status(CANDY, FAN)
    assert (status["mint_limit"], status["wallet_minted"], status["limit_reached"]) == (2, 1, False)
    assert status["mint_price_sol"] == 0.05

    sidecar["minted"] = 2
    status = candy_machine.get_public_candy_machine_status(CANDY, FAN)
    assert status["limit_reached"] is True
    assert status["mint_price_sol"] is None


def test_mint_is_refused_at_the_limit_and_flags_the_counter_below_it(app, sidecar):
    deployment = _deployment()
    deployment.mint_limit = 2
    _db.session.commit()

    sidecar["minted"] = 2
    with pytest.raises(candy_machine.NotEligibleError, match="limit is 2 per wallet"):
        candy_machine.prepare_mint(CANDY, FAN)

    sidecar["minted"] = 1
    candy_machine.prepare_mint(CANDY, FAN)
    assert sidecar["calls"][-1]["json"]["mintLimit"] is True

    # Count unreadable: don't block — the on-chain guard still enforces it.
    sidecar["minted"] = None
    candy_machine.prepare_mint(CANDY, FAN)
    assert sidecar["calls"][-1]["json"]["mintLimit"] is True


def test_editing_can_set_and_clear_the_limit(app, sidecar):
    deployment = _deployment()
    sidecar["guards"] = _with_default_limit(_phased_guards(), 4)
    candy_machine.apply_phase_update(deployment, "6" * 88, 0.2, PUBLIC_START.isoformat(), ALLOWLIST, mint_limit=4)
    assert deployment.mint_limit == 4
    sidecar["guards"] = _with_default_limit(_phased_guards(), None)
    candy_machine.apply_phase_update(deployment, "7" * 88, 0.2, PUBLIC_START.isoformat(), ALLOWLIST)
    assert deployment.mint_limit is None
