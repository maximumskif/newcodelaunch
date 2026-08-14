"""
Orchestrates the compile -> estimate -> (frontend deploys) -> record flow.

Deliberately does NOT sign or broadcast anything — see the Phase 2 plan for
why. The old smart_contract_deployer.py took a raw private_key over the wire
and deployed server-side; here the backend only compiles and estimates, and
records the result after the user's own wallet has already broadcast the
transaction from the browser.
"""

from __future__ import annotations

from typing import Any, Optional

from ..extensions import db
from ..models.deployment import ContractDeployment
from . import blockchain, contract_templates, solidity

NATIVE_TOKENS = {
    "ethereum": "ETH",
    "polygon": "MATIC",
    "bsc": "BNB",
}


class CompilationFailedError(RuntimeError):
    pass


def compile_template(template_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    rendered = contract_templates.render_contract(template_id, parameters)
    result = solidity.compile_contract(rendered["contract_code"], rendered["contract_name"])
    if not result.success:
        raise CompilationFailedError(result.error_message or "Compilation failed")
    return {
        "abi": result.abi,
        "bytecode": result.bytecode,
        "contract_name": rendered["contract_name"],
        "template": rendered["template"],
    }


def estimate_deployment(
    template_id: str,
    parameters: dict[str, Any],
    network: str,
    deployer_address: str,
) -> dict[str, Any]:
    compiled = compile_template(template_id, parameters)

    w3 = blockchain.get_web3(network)
    contract = w3.eth.contract(abi=compiled["abi"], bytecode=compiled["bytecode"])

    gas_estimate = contract.constructor().estimate_gas({"from": deployer_address})
    gas_price_wei = w3.eth.gas_price
    deployment_cost_native = (gas_estimate * gas_price_wei) / 10**18

    return {
        "gas_estimate": gas_estimate,
        "gas_price_gwei": float(w3.from_wei(gas_price_wei, "gwei")),
        "deployment_cost_native": deployment_cost_native,
        "native_token": NATIVE_TOKENS.get(network, "ETH"),
        "network": network,
    }


def record_deployment(
    user_id: str,
    template_id: str,
    network: str,
    contract_address: str,
    transaction_hash: str,
    deployer_address: str,
    parameters: dict[str, Any],
) -> ContractDeployment:
    """Persist a deployment the frontend's own wallet already broadcast, after
    independently confirming it actually landed on-chain."""
    template = contract_templates.get_template(template_id)
    if template is None:
        raise contract_templates.UnknownTemplateError(f"Unknown template: {template_id}")

    tx_status = blockchain.get_transaction_status(network, transaction_hash)
    if tx_status.get("status") != "success":
        raise ValueError(f"Transaction is not a confirmed success on-chain (status: {tx_status.get('status')})")

    deployment = ContractDeployment(
        user_id=user_id,
        template_id=template_id,
        template_name=template.name,
        contract_type=template.type,
        network=network,
        contract_address=contract_address,
        transaction_hash=transaction_hash,
        deployer_address=deployer_address,
        parameters=parameters,
        gas_used=tx_status.get("gas_used"),
        deployment_cost_native=_native_cost_from_status(tx_status),
        explorer_url=blockchain.EVM_NETWORKS.get(network, {}).get("explorer_url", "") + f"/address/{contract_address}",
    )
    db.session.add(deployment)
    db.session.commit()
    return deployment


def _native_cost_from_status(tx_status: dict[str, Any]) -> Optional[float]:
    gas_used = tx_status.get("gas_used")
    gas_price = tx_status.get("gas_price")
    if gas_used is None or gas_price is None:
        return None
    return (gas_used * gas_price) / 10**18


def get_user_deployments(user_id: str) -> list[ContractDeployment]:
    return (
        ContractDeployment.query.filter_by(user_id=user_id)
        .order_by(ContractDeployment.created_at.desc())
        .all()
    )


def get_deployment_by_address(contract_address: str) -> Optional[ContractDeployment]:
    return ContractDeployment.query.filter_by(contract_address=contract_address).first()
