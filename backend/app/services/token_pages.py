"""
Public token pages: what a buyer should be able to check about a token
launched with this app, read from the chain rather than from anything the
creator claims — supply, whether the creator can still mint or freeze (or
still owns the contract), taxes and trading status for an advanced ERC-20,
the DEX pool and its price, and how much of the pool's liquidity is locked
and until when. Only tokens launched here have a page, so this can't be used
as a general-purpose RPC proxy.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func
from web3 import Web3

from ..models.deployment import ContractDeployment
from ..models.solana_token import SolanaTokenLaunch
from . import blockchain, liquidity
from .candy_machine import CandyMachineServiceError, _sidecar_network, _sidecar_request

ZERO = "0x0000000000000000000000000000000000000000"
# Where LP tokens are conventionally sent to burn them.
DEAD = "0x000000000000000000000000000000000000dEaD"


class NotFoundError(ValueError):
    pass


class ChainReadError(RuntimeError):
    pass


def _fn(name: str, outputs: list[str], inputs: Optional[list[str]] = None) -> dict:
    return {
        "type": "function",
        "name": name,
        "stateMutability": "view",
        "inputs": [{"name": f"a{i}", "type": t} for i, t in enumerate(inputs or [])],
        "outputs": [{"name": "", "type": t} for t in outputs],
    }


_TOKEN_ABI = [
    _fn("name", ["string"]),
    _fn("symbol", ["string"]),
    _fn("decimals", ["uint8"]),
    _fn("totalSupply", ["uint256"]),
    _fn("owner", ["address"]),
    _fn("tradingEnabled", ["bool"]),
    _fn("buyTaxRate", ["uint256"]),
    _fn("sellTaxRate", ["uint256"]),
    _fn("maxTransactionAmount", ["uint256"]),
    _fn("maxWalletAmount", ["uint256"]),
    _fn("balanceOf", ["uint256"], ["address"]),
]
_FACTORY_ABI = [_fn("getPair", ["address"], ["address", "address"])]
_PAIR_ABI = [
    _fn("getReserves", ["uint112", "uint112", "uint32"]),
    _fn("token0", ["address"]),
    _fn("totalSupply", ["uint256"]),
    _fn("balanceOf", ["uint256"], ["address"]),
]
_LOCK_ABI = [_fn("lockedAmount", ["uint256"]), _fn("releaseTime", ["uint256"])]


def _optional(call) -> Any:
    """A read that only some tokens support (e.g. erc20_advanced's
    tradingEnabled) — None when the contract doesn't have it."""
    try:
        return call()
    except Exception:  # noqa: BLE001 — a revert or missing function, not an error
        return None


def _evm_pool(w3: Web3, network: str, token: str, chain_time: int) -> Optional[dict[str, Any]]:
    dex = liquidity.dexes().get(network)
    if dex is None:
        return None
    factory = w3.eth.contract(address=dex["factory"], abi=_FACTORY_ABI)
    pair_address = factory.functions.getPair(token, dex["wrapped_native"]).call()
    if pair_address == ZERO:
        return {"dex": dex["name"], "pair": None}
    pair = w3.eth.contract(address=pair_address, abi=_PAIR_ABI)
    reserve0, reserve1, _ = pair.functions.getReserves().call()
    token_is_0 = pair.functions.token0().call().lower() == token.lower()
    lp_supply = pair.functions.totalSupply().call()
    burned = pair.functions.balanceOf(Web3.to_checksum_address(DEAD)).call() + pair.functions.balanceOf(ZERO).call()

    # Token Time-Locks deployed here (by anyone) whose token is this pool's
    # LP — each read live; only ones still holding LP and not yet due count.
    locks = []
    candidates = ContractDeployment.query.filter_by(template_id="token_timelock", network=network).all()
    for row in candidates:
        if str((row.parameters or {}).get("TOKEN", "")).lower() != pair_address.lower():
            continue
        lock = w3.eth.contract(address=Web3.to_checksum_address(row.contract_address), abi=_LOCK_ABI)
        amount = _optional(lambda: lock.functions.lockedAmount().call())
        release_time = _optional(lambda: lock.functions.releaseTime().call())
        if amount and release_time and release_time > chain_time:
            locks.append({"address": row.contract_address, "amount": str(amount), "release_time": release_time})
    locks.sort(key=lambda item: item["release_time"])

    return {
        "dex": dex["name"],
        "pair": pair_address,
        "token_reserve": str(reserve0 if token_is_0 else reserve1),
        "native_reserve": str(reserve1 if token_is_0 else reserve0),
        "lp_supply": str(lp_supply),
        "burned_lp": str(burned),
        "locks": locks,
    }


def evm_token_page(network: str, address: str) -> dict[str, Any]:
    if network not in blockchain.EVM_NETWORKS:
        raise NotFoundError(f"Unknown EVM network: {network}")
    deployment = (
        ContractDeployment.query.filter(
            func.lower(ContractDeployment.contract_address) == address.lower(),
            ContractDeployment.network == network,
            ContractDeployment.contract_type == "erc20",
        )
        .order_by(ContractDeployment.created_at.asc())
        .first()
    )
    if deployment is None:
        raise NotFoundError("No token launched with this app at that address")

    try:
        w3 = blockchain.get_web3(network)
        token_address = Web3.to_checksum_address(deployment.contract_address)
        token = w3.eth.contract(address=token_address, abi=_TOKEN_ABI)
        chain_time = w3.eth.get_block("latest")["timestamp"]
        owner = _optional(lambda: token.functions.owner().call())
        trading_enabled = _optional(lambda: token.functions.tradingEnabled().call())
        page = {
            "chain": "evm",
            "network": network,
            "address": token_address,
            "template": deployment.template_name,
            "name": token.functions.name().call(),
            "symbol": token.functions.symbol().call(),
            "decimals": token.functions.decimals().call(),
            "total_supply": str(token.functions.totalSupply().call()),
            "owner": owner,
            "ownership_renounced": owner is not None and owner == ZERO,
            "advanced": None
            if trading_enabled is None
            else {
                "trading_enabled": trading_enabled,
                "buy_tax_bps": token.functions.buyTaxRate().call(),
                "sell_tax_bps": token.functions.sellTaxRate().call(),
                "max_transaction": str(token.functions.maxTransactionAmount().call()),
                "max_wallet": str(token.functions.maxWalletAmount().call()),
            },
            "source_verified": deployment.verification_status == "verified",
            "explorer_url": deployment.explorer_url,
            "chain_time": chain_time,
            "pool": _evm_pool(w3, network, token_address, chain_time),
        }
    except NotFoundError:
        raise
    except Exception as exc:  # noqa: BLE001 — RPC trouble; the route answers generically
        raise ChainReadError(str(exc)) from exc
    return page


def solana_token_page(mint: str) -> dict[str, Any]:
    launch = SolanaTokenLaunch.query.filter_by(mint_address=mint).first()
    if launch is None:
        raise NotFoundError("No token launched with this app at that address")
    mint_info = blockchain.get_solana_mint_info(launch.network, launch.mint_address)
    if mint_info.get("status") != "success":
        raise ChainReadError(f"mint read failed: {mint_info.get('status')}")

    pool: Optional[dict[str, Any]]
    try:
        state = _sidecar_request(
            "GET",
            "/internal/raydium/pool",
            params={"network": _sidecar_network(launch.network), "mint": launch.mint_address},
            timeout=30,
        )
        raw = state.get("pool")
        pool = (
            {"dex": "Raydium", "pair": None}
            if not raw
            else {
                "dex": "Raydium",
                "pair": state["poolId"],
                "token_reserve": raw["tokenReserve"],
                "native_reserve": raw["solReserve"],
                "lp_supply": raw["lpSupply"],
                # Raydium's Burn & Earn: locked for good, so there's no date.
                "permanently_locked_lp": state.get("lockedLp") or "0",
            }
        )
    except CandyMachineServiceError:
        pool = None  # the page still shows the mint itself

    return {
        "chain": "solana",
        "network": launch.network,
        "address": launch.mint_address,
        "name": launch.name,
        "symbol": launch.symbol,
        "decimals": mint_info["decimals"],
        "total_supply": mint_info["supply"],
        "mint_authority_revoked": mint_info["mint_authority"] is None,
        "freeze_authority_revoked": mint_info["freeze_authority"] is None,
        "metadata_locked": launch.metadata_locked,
        "explorer_url": launch.explorer_url,
        "pool": pool,
    }
