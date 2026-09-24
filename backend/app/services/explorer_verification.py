"""
Block-explorer source verification for EVM deployments (Etherscan,
Polygonscan, BscScan and their testnets).

Uses Etherscan's multichain V2 API: one key, one base URL, the target chain
picked by `chainid`. Submits the exact standard-JSON compiler input the
contract was deployed from (solidity.standard_json_input), rebuilt from the
deployment's stored template + parameters — rendering and compiling are
deterministic, and the compile path keeps the same source name ("<stdin>")
every deployment has always been compiled under, so the explorer's
recompile reproduces the deployed bytecode byte-for-byte, metadata hash
included. Verification is asynchronous on the explorer's side: submit
returns a guid, which is polled until it settles.
"""

from __future__ import annotations

import json
from typing import Any

import requests
from flask import current_app

from ..extensions import db
from ..models.deployment import ContractDeployment
from . import blockchain, contract_templates, solidity


class ExplorerNotConfiguredError(RuntimeError):
    pass


class ExplorerRequestError(RuntimeError):
    pass


class VerificationNotPossibleError(ValueError):
    pass


PENDING = "pending"
VERIFIED = "verified"
FAILED = "failed"


def _api_key() -> str:
    key = current_app.config.get("ETHERSCAN_API_KEY")
    if not key:
        raise ExplorerNotConfiguredError(
            "Source verification isn't configured — set ETHERSCAN_API_KEY (one Etherscan key covers every EVM network)"
        )
    return key


def _call(method: str, chain_id: int, params: dict[str, Any]) -> dict[str, Any]:
    url = current_app.config["ETHERSCAN_API_URL"]
    query = {"chainid": chain_id}
    try:
        if method == "POST":
            response = requests.post(url, params=query, data=params, timeout=30)
        else:
            response = requests.get(url, params={**query, **params}, timeout=30)
    except requests.RequestException as exc:
        raise ExplorerRequestError(f"Block explorer request failed: {exc}") from exc
    if response.status_code != 200:
        raise ExplorerRequestError(f"Block explorer returned {response.status_code}: {response.text[:300]}")
    try:
        body = response.json()
    except ValueError as exc:
        raise ExplorerRequestError("Block explorer returned a non-JSON response") from exc
    if not isinstance(body, dict) or "status" not in body or "result" not in body:
        raise ExplorerRequestError("Block explorer returned an unexpected response shape")
    return body


def _save(deployment: ContractDeployment, status: str, message: str | None, guid: str | None = None) -> ContractDeployment:
    deployment.verification_status = status
    deployment.verification_message = (message or "")[:512] or None
    if guid is not None:
        deployment.verification_guid = guid
    db.session.commit()
    return deployment


def submit_verification(deployment: ContractDeployment) -> ContractDeployment:
    """Submits the deployment's source for verification. Idempotent-ish:
    an already-verified or still-pending deployment is returned unchanged
    rather than resubmitted."""
    if deployment.verification_status in (VERIFIED, PENDING):
        return deployment

    network = blockchain.EVM_NETWORKS.get(deployment.network)
    if network is None:
        raise VerificationNotPossibleError(f"Source verification isn't available for network: {deployment.network}")
    api_key = _api_key()

    try:
        rendered = contract_templates.render_contract(deployment.template_id, deployment.parameters or {})
    except (contract_templates.UnknownTemplateError, contract_templates.TemplateParameterError) as exc:
        # A deployment recorded before template rendering validated its
        # parameters can hold values that no longer render — its source
        # can't be reproduced, so it can't be verified.
        raise VerificationNotPossibleError(f"This deployment's source can't be reproduced for verification: {exc}") from exc

    body = _call(
        "POST",
        network["chain_id"],
        {
            "apikey": api_key,
            "module": "contract",
            "action": "verifysourcecode",
            "contractaddress": deployment.contract_address,
            "codeformat": "solidity-standard-json-input",
            "sourceCode": json.dumps(solidity.standard_json_input(rendered["contract_code"])),
            "contractname": f"{solidity.SOURCE_NAME}:{rendered['contract_name']}",
            "compilerversion": solidity.compiler_version(),
            # (sic) — the parameter really is spelled this way in Etherscan's
            # API. Empty: none of these templates' constructors take arguments.
            "constructorArguements": "",
        },
    )

    result = str(body["result"])
    if body["status"] == "1":
        return _save(deployment, PENDING, "Submitted — waiting for the explorer to verify", guid=result)
    if "already verified" in result.lower():
        return _save(deployment, VERIFIED, result)
    return _save(deployment, FAILED, result)


def refresh_verification(deployment: ContractDeployment) -> ContractDeployment:
    """Polls a pending verification once and records where it landed."""
    if deployment.verification_status != PENDING or not deployment.verification_guid:
        return deployment

    network = blockchain.EVM_NETWORKS[deployment.network]
    body = _call(
        "GET",
        network["chain_id"],
        {
            "apikey": _api_key(),
            "module": "contract",
            "action": "checkverifystatus",
            "guid": deployment.verification_guid,
        },
    )

    result = str(body["result"])
    lowered = result.lower()
    if lowered.startswith("pass") or "already verified" in lowered:
        return _save(deployment, VERIFIED, result)
    if "pending" in lowered or "queue" in lowered:
        return deployment
    return _save(deployment, FAILED, result)


def get_owned_deployment(deployment_id: str, user_id: str) -> ContractDeployment | None:
    deployment = db.session.get(ContractDeployment, deployment_id)
    if deployment is None or deployment.user_id != user_id:
        return None
    return deployment
