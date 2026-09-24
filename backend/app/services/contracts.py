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
from ..models.nft import NFTCollection
from . import blockchain, contract_templates, solidity

NATIVE_TOKENS = {
    "sepolia": "ETH",
    "ethereum": "ETH",
    "polygon_amoy": "POL",
    "polygon": "POL",
    "bsc_testnet": "tBNB",
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
    nft_collection_id: Optional[str] = None,
) -> ContractDeployment:
    """Persist a deployment the frontend's own wallet already broadcast, after
    independently confirming it actually landed on-chain — and that it's
    the deployment claimed: the receipt must have created `contract_address`
    and been sent by `deployer_address`. Before, only the transaction's
    success was checked, so any successful hash could be recorded next to
    an arbitrary contract address."""
    template = contract_templates.get_template(template_id)
    if template is None:
        raise contract_templates.UnknownTemplateError(f"Unknown template: {template_id}")

    if nft_collection_id is not None:
        if template.type != "erc721":
            raise ValueError("nft_collection_id only applies to an ERC-721 deployment")
        collection = db.session.get(NFTCollection, nft_collection_id)
        if collection is None or collection.user_id != user_id:
            raise ValueError(f"NFT collection not found: {nft_collection_id}")

    # Idempotent: a client retry after a slow/dropped response to a request
    # that actually succeeded server-side must not create a second row for
    # the same on-chain deployment — same pattern (and same bug class,
    # fixed there first) as candy_machine.record_candy_machine.
    #
    # Scoped to the SAME user, though — a transaction_hash is a public value
    # (visible on any block explorer), so without this check, any
    # authenticated user could call this with a transaction_hash they merely
    # observed (never deployed themselves) and get back — and silently link
    # into their own project — a deployment row that actually belongs to a
    # different user. transaction_hash is also a unique DB column, so a
    # different user genuinely can't ever record their own row under the
    # same hash; surface that as a clear error instead of silently handing
    # back someone else's row.
    existing = ContractDeployment.query.filter_by(transaction_hash=transaction_hash).first()
    if existing is not None:
        if existing.user_id != user_id:
            raise ValueError("This transaction has already been recorded under a different account")
        return existing

    tx_status = blockchain.get_transaction_status(network, transaction_hash)
    if tx_status.get("status") != "success":
        raise ValueError(f"Transaction is not a confirmed success on-chain (status: {tx_status.get('status')})")
    created = tx_status.get("contract_address")
    if not created or created.lower() != contract_address.lower():
        raise ValueError("The confirmed transaction did not create the given contract_address")
    sender = tx_status.get("from")
    if not sender or sender.lower() != deployer_address.lower():
        raise ValueError("The confirmed transaction was not sent by the given deployer_address")

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
        nft_collection_id=nft_collection_id,
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
