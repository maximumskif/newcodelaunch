"""
Token checker: what a buyer can check about ANY token, read from the chain
and public sources — not only tokens launched here (those also get a full
public page, token_pages.py). Facts, not a score: each check says what was
found and whether it's the reassuring answer.

EVM: that it's an ERC-20, whether ownership is renounced, whether the source
is verified on the explorer (Etherscan's API, when a key is configured), if
it's an upgradeable proxy, which powerful owner functions its verified code
contains, and its DEX liquidity (DexScreener).
Solana: whether more can be minted, whether wallets can be frozen, how much
of the supply the largest accounts hold, and DEX liquidity.

Reads only well-known view functions and public APIs, so it isn't a
general-purpose RPC proxy; the route is rate-limited.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from flask import current_app
from sqlalchemy import func
from web3 import Web3

from ..models.deployment import ContractDeployment
from ..models.solana_token import SolanaTokenLaunch
from . import blockchain, explorer_verification, market_intelligence
from .token_pages import ZERO, _fn, _optional

_ERC20_ABI = [
    _fn("name", ["string"]),
    _fn("symbol", ["string"]),
    _fn("decimals", ["uint8"]),
    _fn("totalSupply", ["uint256"]),
    _fn("owner", ["address"]),
    _fn("getOwner", ["address"]),
]

# Owner powers worth knowing about, matched against function names in the
# verified ABI. Presence in the code, not proof of use — the page says so.
_POWERS = [
    ("mint", re.compile(r"^mint", re.I), "mint new tokens"),
    ("block", re.compile(r"(black|block)list|^(set|add)bots?|^ban", re.I), "block wallets from trading"),
    ("pause", re.compile(r"^(pause|unpause|setpaused)", re.I), "pause transfers"),
    ("fees", re.compile(r"^(set|update|change).*(fee|tax)", re.I), "change buy/sell fees"),
    ("limits", re.compile(r"^(set|update|remove).*(maxtx|maxwallet|limit|maxtransaction)", re.I), "change transfer limits"),
]


class CheckError(ValueError):
    pass


class ChainReadError(RuntimeError):
    pass


def _check(check_id: str, ok: Optional[bool], label: str, detail: str = "") -> dict[str, Any]:
    return {"id": check_id, "ok": ok, "label": label, "detail": detail}


# DexScreener's name for each network it indexes (no testnets).
_DEXSCREENER_CHAINS = {"ethereum": "ethereum", "polygon": "polygon", "bsc": "bsc", "base": "base", "solana": "solana"}


def _liquidity(address: str, network: str) -> tuple[Optional[dict[str, Any]], dict[str, Any]]:
    """Top pool and total on THIS network, from DexScreener; and the check.
    Other chains are ignored: forks like PulseChain copied every Ethereum
    address, so the same address has unrelated pools there (USDC's top
    "pool" was a PulseChain copy priced at $0.0009)."""
    chain = _DEXSCREENER_CHAINS.get(network)
    if chain is None:
        return None, _check("liquidity", None, "Liquidity isn't tracked on testnets")
    try:
        chain_pairs = [p for p in market_intelligence.lookup_token(address) if p["chain"] == chain]
    except (market_intelligence.MarketDataError, ValueError):
        return None, _check("liquidity", None, "Couldn't read DEX liquidity right now")
    if not chain_pairs:
        return None, _check("liquidity", False, "No DEX pool found", "Nobody can trade it on a DEX DexScreener tracks.")
    top = chain_pairs[0]
    # Only a pool where this token is the base side prices it.
    price_usd = top["price_usd"] if top.get("token_is_base", True) else None
    total = sum(p["liquidity_usd"] or 0 for p in chain_pairs)
    summary = {
        "chain": chain,
        "pools": len(chain_pairs),
        "total_liquidity_usd": total,
        "top": {**{k: top[k] for k in ("dex", "pair_address", "url", "liquidity_usd", "volume_24h")}, "price_usd": price_usd},
    }
    ok = total >= 1000
    label = f"${total:,.0f} of liquidity in {len(chain_pairs)} pool{'s' if len(chain_pairs) != 1 else ''}"
    return summary, _check("liquidity", ok, label, "" if ok else "Very thin liquidity: large trades move the price a lot.")


def _verified_source(network: str, address: str) -> Optional[dict[str, Any]]:
    """Etherscan's getsourcecode, or None when no key is configured or the
    explorer can't be reached."""
    if not current_app.config.get("ETHERSCAN_API_KEY"):
        return None
    chain_id = blockchain.EVM_NETWORKS[network]["chain_id"]
    try:
        body = explorer_verification._call(
            "GET", chain_id, {"apikey": current_app.config["ETHERSCAN_API_KEY"], "module": "contract", "action": "getsourcecode", "address": address}
        )
    except explorer_verification.ExplorerRequestError as exc:
        current_app.logger.warning("Explorer source lookup failed: %s", exc)
        return None
    result = body.get("result")
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        return None
    entry = result[0]
    verified = bool(entry.get("SourceCode"))
    abi = []
    if verified:
        try:
            abi = json.loads(entry.get("ABI") or "[]")
        except ValueError:
            abi = []
    return {
        "verified": verified,
        "contract_name": entry.get("ContractName") or None,
        "proxy": str(entry.get("Proxy")) == "1",
        "implementation": entry.get("Implementation") or None,
        "function_names": [item.get("name", "") for item in abi if isinstance(item, dict) and item.get("type") == "function"],
    }


def check_evm(network: str, address: str) -> dict[str, Any]:
    if network not in blockchain.EVM_NETWORKS:
        raise CheckError(f"Unknown EVM network: {network}")
    if not Web3.is_address(address):
        raise CheckError("That isn't an EVM address (0x followed by 40 hex characters)")
    checksum = Web3.to_checksum_address(address)
    try:
        w3 = blockchain.get_web3(network)
        if len(w3.eth.get_code(checksum)) == 0:
            raise CheckError(f"No contract at this address on {blockchain.EVM_NETWORKS[network]['name']}")
        token = w3.eth.contract(address=checksum, abi=_ERC20_ABI)
        try:
            name, symbol = token.functions.name().call(), token.functions.symbol().call()
            decimals, supply = token.functions.decimals().call(), token.functions.totalSupply().call()
        except Exception as exc:  # noqa: BLE001 — a revert here means it isn't an ERC-20
            raise CheckError("This contract doesn't answer as an ERC-20 token") from exc
        owner = _optional(lambda: token.functions.owner().call()) or _optional(lambda: token.functions.getOwner().call())
    except CheckError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ChainReadError(str(exc)) from exc

    checks = []
    renounced = owner is not None and owner.lower() == ZERO
    if owner is None:
        checks.append(_check("owner", None, "No owner() function", "Ownership can't be read this way; check the verified code."))
    elif renounced:
        checks.append(_check("owner", True, "Ownership renounced", "No one can call owner-only functions."))
    else:
        checks.append(_check("owner", False, "Has an owner", f"{owner} can call owner-only functions."))

    source = _verified_source(network, checksum)
    powers: list[str] = []
    if source is None:
        checks.append(_check("source", None, "Source verification not checked", "The explorer couldn't be reached."))
    else:
        checks.append(
            _check("source", source["verified"], "Source code verified on the explorer" if source["verified"] else "Source code not verified", "" if source["verified"] else "Nobody can read what this contract does.")
        )
        if source["verified"]:
            checks.append(
                _check("proxy", not source["proxy"], "Upgradeable proxy — its code can be replaced" if source["proxy"] else "Not an upgradeable proxy", "")
            )
            names = source["function_names"]
            # A proxy's own ABI is just upgrade plumbing; the token's real
            # functions are in the implementation it points at.
            if source["proxy"] and source["implementation"] and Web3.is_address(source["implementation"]):
                implementation = _verified_source(network, Web3.to_checksum_address(source["implementation"]))
                if implementation and implementation["verified"]:
                    names = names + implementation["function_names"]
            powers = [label for _, pattern, label in _POWERS if any(pattern.search(n) for n in names)]
            if powers:
                checks.append(
                    _check("powers", True if renounced else False, "Powerful functions in the code: " + ", ".join(powers), "Harmless if ownership is renounced and they're owner-only." if renounced else "An owner may be able to " + ", ".join(powers) + ".")
                )

    liquidity, liquidity_check = _liquidity(checksum, network)
    checks.append(liquidity_check)

    ours = (
        ContractDeployment.query.filter(func.lower(ContractDeployment.contract_address) == checksum.lower(), ContractDeployment.network == network, ContractDeployment.contract_type == "erc20")
        .order_by(ContractDeployment.created_at.asc())
        .first()
    )
    return {
        "chain": "evm",
        "network": network,
        "address": checksum,
        "name": name,
        "symbol": symbol,
        "decimals": decimals,
        "total_supply": str(supply),
        "owner": owner,
        "powers": powers,
        "contract_name": source["contract_name"] if source else None,
        "checks": checks,
        "largest_holders": None,
        "liquidity": liquidity,
        "launched_here": f"/token/{network}/{checksum}" if ours else None,
        "explorer_url": f"{blockchain.EVM_NETWORKS[network]['explorer_url']}/token/{checksum}",
    }


def check_solana(network: str, mint: str) -> dict[str, Any]:
    if network not in blockchain.SOLANA_NETWORKS:
        raise CheckError(f"Unknown Solana network: {network}")
    info = blockchain.get_solana_mint_info(network, mint)
    if info["status"] == "error" and "Invalid mint" in info.get("error", ""):
        raise CheckError("That isn't a Solana address")
    if info["status"] == "not_found":
        raise CheckError("No account at this address")
    if info["status"] == "not_a_mint":
        raise CheckError("This address isn't an SPL token mint")
    if info["status"] != "success":
        raise ChainReadError(info.get("error", "mint read failed"))

    supply = int(info["supply"])
    checks = [
        _check("mint", info["mint_authority"] is None, "Supply is fixed" if info["mint_authority"] is None else "More can be minted", "" if info["mint_authority"] is None else f"{info['mint_authority']} can create new tokens."),
        _check("freeze", info["freeze_authority"] is None, "Wallets can't be frozen" if info["freeze_authority"] is None else "Wallets can be frozen", "" if info["freeze_authority"] is None else f"{info['freeze_authority']} can freeze holders' tokens."),
    ]

    holders = blockchain.get_solana_largest_accounts(network, mint)
    largest = None
    if holders["status"] == "success" and supply > 0:
        largest = [{"address": a["address"], "share": int(a["amount"]) / supply} for a in holders["accounts"][:10]]
        top10 = sum(item["share"] for item in largest)
        checks.append(
            _check("holders", top10 <= 0.5, f"Largest 10 accounts hold {top10:.0%}", "Pools and exchanges count as single accounts." + ("" if top10 <= 0.5 else " A few accounts could move the price a lot."))
        )
    else:
        checks.append(_check("holders", None, "Couldn't read the largest holders"))

    liquidity, liquidity_check = _liquidity(mint, network)
    checks.append(liquidity_check)

    ours = SolanaTokenLaunch.query.filter_by(mint_address=mint, network=network).first()
    # Name and symbol: ours if launched here, else what DexScreener lists
    # (the same cached lookup as the liquidity check); none if unlisted.
    name, symbol = (ours.name, ours.symbol) if ours else (None, None)
    if not ours and liquidity:
        try:
            base = market_intelligence.lookup_token(mint)[0]["base_token"]
            name, symbol = base["name"], base["symbol"]
        except (market_intelligence.MarketDataError, ValueError, IndexError):
            pass
    cluster = "" if network == "solana" else "?cluster=devnet"
    return {
        "chain": "solana",
        "network": network,
        "address": mint,
        "name": name,
        "symbol": symbol,
        "decimals": info["decimals"],
        "total_supply": info["supply"],
        "owner": None,
        "powers": [],
        "contract_name": None,
        "checks": checks,
        "largest_holders": largest,
        "liquidity": liquidity,
        "launched_here": f"/token/{network}/{mint}" if ours else None,
        "explorer_url": f"https://explorer.solana.com/address/{mint}{cluster}",
    }
