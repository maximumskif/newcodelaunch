"""
DEX liquidity for ERC-20s deployed here: which Uniswap V2-style DEX each
network has, and recording an add-liquidity transaction the owner's wallet
already sent (the frontend builds and sends it; nothing here holds keys).

Only V2-style routers — `addLiquidityETH` against the network's wrapped
native token — so one ABI covers Uniswap V2 and PancakeSwap V2. Every
built-in address was checked against its live chain (the router's
`factory()` and `WETH()` return the factory and wrapped token listed) on
2026-09-25. Polygon Amoy has no V2 deployment we could confirm, so it has
none rather than a guess.
"""

from __future__ import annotations

import json
from typing import Any

from flask import current_app
from web3 import Web3

from ..extensions import db
from ..models.deployment import ContractDeployment
from ..models.liquidity import LiquidityProvision
from ..models.user import Chain, User, WalletIdentity
from . import blockchain

_BUILT_IN_DEXES: dict[str, dict[str, str]] = {
    "ethereum": {
        "name": "Uniswap V2",
        "router": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        "factory": "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        "wrapped_native": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
    "sepolia": {
        "name": "Uniswap V2",
        "router": "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
        "factory": "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
        "wrapped_native": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    },
    "polygon": {
        "name": "Uniswap V2",
        "router": "0xedf6066a2b290C185783862C7F4776A2C8077AD1",
        "factory": "0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C",
        "wrapped_native": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    },
    "bsc": {
        "name": "PancakeSwap V2",
        "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
        "factory": "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
        "wrapped_native": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    },
    "bsc_testnet": {
        "name": "PancakeSwap V2",
        "router": "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
        "factory": "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
        "wrapped_native": "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
    },
}

_FACTORY_ABI = [
    {
        "type": "function",
        "name": "getPair",
        "stateMutability": "view",
        "inputs": [{"name": "a", "type": "address"}, {"name": "b", "type": "address"}],
        "outputs": [{"name": "", "type": "address"}],
    }
]
_PAIR_ABI = [
    {"type": "function", "name": "token0", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "address"}]}
]
# Mint(address indexed sender, uint amount0, uint amount1) — emitted by the
# pair for every add, with what it actually received.
_MINT_TOPIC = Web3.keccak(text="Mint(address,uint256,uint256)")
_ZERO = "0x0000000000000000000000000000000000000000"


class LiquidityError(ValueError):
    pass


class DexNotAvailableError(LiquidityError):
    pass


def dexes() -> dict[str, dict[str, str]]:
    """Every network's DEX, with DEX_OVERRIDES applied and addresses checksummed."""
    merged = {network: dict(dex) for network, dex in _BUILT_IN_DEXES.items()}
    raw = current_app.config.get("DEX_OVERRIDES") or ""
    if raw:
        overrides = json.loads(raw)
        for network, dex in overrides.items():
            if network not in blockchain.EVM_NETWORKS:
                raise ValueError(f"DEX_OVERRIDES names an unknown EVM network: {network}")
            merged[network] = {"name": dex["name"], **{k: dex[k] for k in ("router", "factory", "wrapped_native")}}
    for dex in merged.values():
        for key in ("router", "factory", "wrapped_native"):
            dex[key] = Web3.to_checksum_address(dex[key])
    return merged


def get_dex(network: str) -> dict[str, str]:
    dex = dexes().get(network)
    if dex is None:
        raise DexNotAvailableError(f"No supported DEX on {network}")
    return dex


def get_owned_erc20(deployment_id: str, user_id: str) -> ContractDeployment | None:
    deployment = db.session.get(ContractDeployment, deployment_id)
    if deployment is None or deployment.user_id != user_id or deployment.contract_type != "erc20":
        return None
    return deployment


def _account_evm_wallets(user_id: str) -> set[str]:
    rows = WalletIdentity.query.filter_by(user_id=user_id, chain=Chain.EVM).all()
    wallets = {row.wallet_address.lower() for row in rows}
    user = db.session.get(User, user_id)
    if user is not None and user.chain == Chain.EVM:
        wallets.add(user.wallet_address.lower())
    return wallets


def record_provision(user_id: str, deployment: ContractDeployment, transaction_hash: str) -> LiquidityProvision:
    """Records an add-liquidity transaction after reading it back from the
    chain: a confirmed success, sent by one of this account's EVM wallets to
    the network's DEX router, in which this token's pool (the factory's own
    pair for token + wrapped native) minted LP tokens. Amounts come from the
    pair's Mint event, never from the client."""
    dex = get_dex(deployment.network)

    existing = LiquidityProvision.query.filter_by(transaction_hash=transaction_hash).first()
    if existing is not None:
        if existing.user_id != user_id or existing.deployment_id != deployment.id:
            raise LiquidityError("This transaction has already been recorded for a different token or account")
        return existing

    w3 = blockchain.get_web3(deployment.network)
    try:
        receipt = w3.eth.get_transaction_receipt(transaction_hash)
    except Exception as exc:  # noqa: BLE001 — not found / not mined yet
        raise LiquidityError("Transaction not found on-chain yet") from exc
    if receipt["status"] != 1:
        raise LiquidityError("The transaction reverted on-chain")
    if (receipt["to"] or "").lower() != dex["router"].lower():
        raise LiquidityError(f"The transaction wasn't sent to {dex['name']}'s router")
    sender = receipt["from"].lower()
    if sender not in _account_evm_wallets(user_id):
        raise LiquidityError("The transaction wasn't sent by a wallet on this account")

    token = Web3.to_checksum_address(deployment.contract_address)
    factory = w3.eth.contract(address=dex["factory"], abi=_FACTORY_ABI)
    # Read at the transaction's own block: exact, and immune to an RPC node
    # whose "latest" still lags the receipt it just served.
    at_block = receipt["blockNumber"]
    pair = factory.functions.getPair(token, dex["wrapped_native"]).call(block_identifier=at_block)
    if pair == _ZERO:
        raise LiquidityError("This token has no pool on the DEX")

    mint = next(
        (
            log
            for log in receipt["logs"]
            if log["address"].lower() == pair.lower() and log["topics"] and bytes(log["topics"][0]) == bytes(_MINT_TOPIC)
        ),
        None,
    )
    if mint is None:
        raise LiquidityError("The transaction didn't add liquidity to this token's pool")
    data = bytes(mint["data"])
    amount0, amount1 = int.from_bytes(data[0:32], "big"), int.from_bytes(data[32:64], "big")
    token0 = w3.eth.contract(address=pair, abi=_PAIR_ABI).functions.token0().call(block_identifier=at_block)
    token_amount, native_amount = (amount0, amount1) if token0.lower() == token.lower() else (amount1, amount0)

    provision = LiquidityProvision(
        user_id=user_id,
        deployment_id=deployment.id,
        network=deployment.network,
        dex_name=dex["name"],
        pair_address=pair,
        provider_address=receipt["from"],
        transaction_hash=transaction_hash,
        token_amount=str(token_amount),
        native_amount=str(native_amount),
    )
    db.session.add(provision)
    db.session.commit()
    return provision


def list_provisions(deployment: ContractDeployment) -> list[dict[str, Any]]:
    rows = (
        LiquidityProvision.query.filter_by(deployment_id=deployment.id)
        .order_by(LiquidityProvision.created_at.desc())
        .all()
    )
    return [row.to_dict() for row in rows]
