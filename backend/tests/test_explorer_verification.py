import json

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db as _db
from app.models.deployment import ContractDeployment
from app.models.user import Chain, User
from app.services import explorer_verification, solidity

PARAMS = {"TOKEN_NAME": "My Token", "TOKEN_SYMBOL": "MTK", "TOKEN_DECIMALS": 18, "TOKEN_SUPPLY": 1000}


class _Response:
    def __init__(self, body, status_code=200):
        self._body = body
        self.status_code = status_code
        self.text = json.dumps(body)

    def json(self):
        return self._body


@pytest.fixture
def configured(app):
    app.config["ETHERSCAN_API_KEY"] = "test-key"
    app.config["ETHERSCAN_API_URL"] = "https://explorer.example/v2/api"


@pytest.fixture
def explorer(monkeypatch):
    """Records every call and answers from a queue of canned bodies."""
    calls = []
    answers = []

    def fake_post(url, params, data, timeout):
        calls.append({"method": "POST", "url": url, "params": params, "data": data})
        return _Response(answers.pop(0))

    def fake_get(url, params, timeout):
        calls.append({"method": "GET", "url": url, "params": params})
        return _Response(answers.pop(0))

    monkeypatch.setattr(explorer_verification.requests, "post", fake_post)
    monkeypatch.setattr(explorer_verification.requests, "get", fake_get)
    return calls, answers


def _deployment(network="sepolia", wallet="0xabc0000000000000000000000000000000000a", parameters=PARAMS):
    user = User.query.filter_by(wallet_address=wallet).first()
    if user is None:
        user = User(wallet_address=wallet, chain=Chain.EVM)
        _db.session.add(user)
        _db.session.commit()
    deployment = ContractDeployment(
        user_id=user.id,
        template_id="erc20_basic",
        template_name="Basic ERC-20 Token",
        contract_type="erc20",
        network=network,
        contract_address="0x5FbDB2315678afecb367f032d93F642f64180aa3",
        transaction_hash=f"0xtx-{network}-{wallet}",
        deployer_address="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        parameters=parameters,
    )
    _db.session.add(deployment)
    _db.session.commit()
    return user, deployment


def test_submits_the_exact_compiler_input_the_contract_was_deployed_from(app, configured, explorer):
    calls, answers = explorer
    answers.append({"status": "1", "message": "OK", "result": "guid-123"})
    _, deployment = _deployment()

    explorer_verification.submit_verification(deployment)

    call = calls[0]
    assert call["method"] == "POST"
    assert call["params"] == {"chainid": 11155111}
    data = call["data"]
    assert data["action"] == "verifysourcecode"
    assert data["codeformat"] == "solidity-standard-json-input"
    assert data["contractname"] == "<stdin>:MyToken"
    assert data["compilerversion"] == solidity.compiler_version()
    assert data["constructorArguements"] == ""
    submitted = json.loads(data["sourceCode"])
    assert submitted["settings"]["optimizer"] == {"enabled": True, "runs": 200}
    assert submitted["settings"]["evmVersion"] == "paris"
    assert 'string public name = "My Token";' in submitted["sources"]["<stdin>"]["content"]
    assert deployment.verification_status == "pending"
    assert deployment.verification_guid == "guid-123"


def test_polls_a_pending_verification_until_it_passes(app, configured, explorer):
    calls, answers = explorer
    answers.extend(
        [
            {"status": "1", "message": "OK", "result": "guid-123"},
            {"status": "0", "message": "NOTOK", "result": "Pending in queue"},
            {"status": "1", "message": "OK", "result": "Pass - Verified"},
        ]
    )
    _, deployment = _deployment(network="polygon")
    explorer_verification.submit_verification(deployment)

    explorer_verification.refresh_verification(deployment)
    assert deployment.verification_status == "pending"
    explorer_verification.refresh_verification(deployment)
    assert deployment.verification_status == "verified"
    assert calls[1]["params"] == {"chainid": 137, "apikey": "test-key", "module": "contract", "action": "checkverifystatus", "guid": "guid-123"}

    # Settled — no further explorer calls.
    explorer_verification.refresh_verification(deployment)
    explorer_verification.submit_verification(deployment)
    assert len(calls) == 3


def test_a_failed_verification_records_why_and_can_be_retried(app, configured, explorer):
    _, answers = explorer
    answers.extend(
        [
            {"status": "0", "message": "NOTOK", "result": "Unable to locate ContractCode at 0x5FbD..."},
            {"status": "1", "message": "OK", "result": "guid-2"},
        ]
    )
    _, deployment = _deployment()

    explorer_verification.submit_verification(deployment)
    assert deployment.verification_status == "failed"
    assert "Unable to locate ContractCode" in deployment.verification_message

    explorer_verification.submit_verification(deployment)
    assert deployment.verification_status == "pending"


def test_already_verified_counts_as_verified(app, configured, explorer):
    _, answers = explorer
    answers.append({"status": "0", "message": "NOTOK", "result": "Contract source code already verified"})
    _, deployment = _deployment()
    explorer_verification.submit_verification(deployment)
    assert deployment.verification_status == "verified"


def test_unconfigured_key_is_a_clean_error_and_nothing_is_sent(app, explorer):
    calls, _ = explorer
    app.config["ETHERSCAN_API_KEY"] = ""
    _, deployment = _deployment()
    with pytest.raises(explorer_verification.ExplorerNotConfiguredError):
        explorer_verification.submit_verification(deployment)
    assert calls == []


def test_unreproducible_legacy_parameters_are_a_clean_error(app, configured, explorer):
    # A row recorded before parameter validation existed can hold values
    # that no longer render (here, a supply that isn't a number).
    _, deployment = _deployment(parameters={**PARAMS, "TOKEN_SUPPLY": "1e5"})
    with pytest.raises(explorer_verification.VerificationNotPossibleError):
        explorer_verification.submit_verification(deployment)


def test_malformed_explorer_response_is_a_request_error(app, configured, monkeypatch):
    monkeypatch.setattr(
        explorer_verification.requests, "post", lambda url, params, data, timeout: _Response({"unexpected": True})
    )
    _, deployment = _deployment()
    with pytest.raises(explorer_verification.ExplorerRequestError):
        explorer_verification.submit_verification(deployment)
    assert deployment.verification_status == "unverified"


def test_routes_are_owner_only_and_map_errors(app, client, configured, explorer):
    _, answers = explorer
    answers.extend(
        [
            {"status": "1", "message": "OK", "result": "guid-9"},
            {"status": "1", "message": "OK", "result": "Pass - Verified"},
        ]
    )
    owner, deployment = _deployment()
    stranger, _ = _deployment(wallet="0xabc000000000000000000000000000000000000b")
    owner_headers = {"Authorization": f"Bearer {create_access_token(identity=owner.id)}"}
    stranger_headers = {"Authorization": f"Bearer {create_access_token(identity=stranger.id)}"}

    assert client.post(f"/api/contracts/deployments/{deployment.id}/verify", headers=stranger_headers).status_code == 404

    submitted = client.post(f"/api/contracts/deployments/{deployment.id}/verify", headers=owner_headers)
    assert submitted.status_code == 200
    assert submitted.get_json()["deployment"]["verification_status"] == "pending"

    refreshed = client.get(f"/api/contracts/deployments/{deployment.id}/verification", headers=owner_headers)
    assert refreshed.get_json()["deployment"]["verification_status"] == "verified"

    app.config["ETHERSCAN_API_KEY"] = ""
    _, other = _deployment(network="bsc")
    response = client.post(f"/api/contracts/deployments/{other.id}/verify", headers=owner_headers)
    assert response.status_code == 503
