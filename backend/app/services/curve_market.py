"""
Bonding-curve market data for buyers: a curve's recent trades (for the
public token page's price chart and trade list) and a feed of recent curve
launches. All public and read from the chain — trades from the curve's own
Buy/Sell/Graduated events, replayed from its deploy block — so nothing here
is what a creator claims.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func
from web3 import Web3

from ..models.deployment import ContractDeployment
from . import blockchain
from .holder_snapshot import _cached, fetch_logs
from .token_pages import _fn


def _topic(signature: str) -> str:
    return "0x" + Web3.keccak(text=signature).hex().removeprefix("0x")


# Trades carry their fee since the template took one; curves launched
# before that emit the fee-less events.
BUY_TOPIC = _topic("Buy(address,uint256,uint256,uint256,uint256,uint256)")
SELL_TOPIC = _topic("Sell(address,uint256,uint256,uint256,uint256,uint256)")
LEGACY_BUY_TOPIC = _topic("Buy(address,uint256,uint256,uint256,uint256)")
LEGACY_SELL_TOPIC = _topic("Sell(address,uint256,uint256,uint256,uint256)")
GRADUATED_TOPIC = _topic("Graduated(address,uint256,uint256)")
# Each trade event's data words. "eth" is what the trader paid into the
# curve (buy) or received (sell); the fee is on top of a buy and out of a
# sale.
_TRADE_LAYOUTS = {
    BUY_TOPIC: ("buy", ("eth", "fee", "tokens", "eth_reserve", "tokens_sold")),
    SELL_TOPIC: ("sell", ("tokens", "eth", "fee", "eth_reserve", "tokens_sold")),
    LEGACY_BUY_TOPIC: ("buy", ("eth", "tokens", "eth_reserve", "tokens_sold")),
    LEGACY_SELL_TOPIC: ("sell", ("tokens", "eth", "eth_reserve", "tokens_sold")),
}
# Trades returned, newest first. Each distinct block costs one timestamp read.
MAX_TRADES = 100
MAX_LAUNCHES = 48

_STATE_ABI = [_fn("graduated", ["bool"]), _fn("ethReserve", ["uint256"])]
_FEES_ABI = [_fn("feesOwed", ["uint256"])]


class NotFoundError(ValueError):
    pass


class ChainReadError(RuntimeError):
    pass


def _words(data: Any) -> list[int]:
    raw = bytes(data) if not isinstance(data, str) else bytes.fromhex(data.removeprefix("0x"))
    return [int.from_bytes(raw[i : i + 32], "big") for i in range(0, len(raw), 32)]


def _hex(value: Any) -> str:
    text = value.hex() if hasattr(value, "hex") else str(value)
    return text if text.startswith("0x") else "0x" + text


def _curve(network: str, address: str) -> ContractDeployment:
    if network not in blockchain.EVM_NETWORKS or not Web3.is_address(address):
        raise NotFoundError("No bonding-curve token launched here at that address")
    row = (
        ContractDeployment.query.filter(
            func.lower(ContractDeployment.contract_address) == address.lower(),
            ContractDeployment.network == network,
            ContractDeployment.template_id == "curve_token",
        )
        .order_by(ContractDeployment.created_at.asc())
        .first()
    )
    if row is None:
        raise NotFoundError("No bonding-curve token launched here at that address")
    return row


def curve_trades(network: str, address: str) -> dict[str, Any]:
    deployment = _curve(network, address)
    checksum = Web3.to_checksum_address(deployment.contract_address)

    try:
        w3 = blockchain.get_web3(network)
        latest = w3.eth.block_number
    except Exception as exc:  # noqa: BLE001
        raise ChainReadError(str(exc)) from exc

    def build() -> dict[str, Any]:
        try:
            start = w3.eth.get_transaction_receipt(deployment.transaction_hash)["blockNumber"]
            logs = fetch_logs(w3, checksum, [*_TRADE_LAYOUTS, GRADUATED_TOPIC], start, latest)
        except Exception as exc:  # noqa: BLE001 — RPC trouble; the route answers generically
            raise ChainReadError(str(exc)) from exc

        trades: list[dict[str, Any]] = []
        graduated: Optional[dict[str, Any]] = None
        for log in logs:
            topics = [_hex(t) for t in log["topics"]]
            words = _words(log["data"])
            who = Web3.to_checksum_address("0x" + topics[1][-40:]) if len(topics) > 1 else None
            where = {"block": log["blockNumber"], "tx": _hex(log["transactionHash"])}
            layout = _TRADE_LAYOUTS.get(topics[0])
            if layout and len(words) == len(layout[1]):
                kind, fields = layout
                trade = {"fee": "0", **{field: str(word) for field, word in zip(fields, words)}}
                trades.append({"kind": kind, "wallet": who, **trade, **where})
            elif topics[0] == GRADUATED_TOPIC and len(words) == 2:
                graduated = {"pair": who, "eth": str(words[0]), "tokens": str(words[1]), **where}

        recent = trades[-MAX_TRADES:][::-1]
        try:
            times = {block: w3.eth.get_block(block)["timestamp"] for block in {t["block"] for t in recent} | ({graduated["block"]} if graduated else set())}
        except Exception as exc:  # noqa: BLE001
            raise ChainReadError(str(exc)) from exc
        for trade in recent:
            trade["time"] = times[trade["block"]]
        if graduated:
            graduated["time"] = times[graduated["block"]]
        explorer = blockchain.EVM_NETWORKS[network].get("explorer_url", "")
        return {
            "network": network,
            "address": checksum,
            "trade_count": len(trades),
            "trades": recent,
            "graduated": graduated,
            "explorer_tx": f"{explorer}/tx/" if explorer else None,
        }

    # Keyed by the latest block: a new trade is always in a new block, so a
    # buyer sees their own trade on the next refresh, and requests within
    # one block share a single replay.
    return _cached(("curve-trades", network, checksum.lower(), latest), build)


def curve_launches(network: Optional[str] = None) -> dict[str, Any]:
    """The most recent curve launches, with where each stands. Rows were
    code-checked when recorded, so their state reads are the curve's own."""
    if network is not None and network not in blockchain.EVM_NETWORKS:
        raise NotFoundError(f"Unknown EVM network: {network}")

    def build() -> dict[str, Any]:
        query = ContractDeployment.query.filter(ContractDeployment.template_id == "curve_token")
        if network:
            query = query.filter(ContractDeployment.network == network)
        rows = query.order_by(ContractDeployment.created_at.desc()).limit(MAX_LAUNCHES).all()
        launches = []
        clients: dict[str, Any] = {}
        for row in rows:
            params = row.parameters or {}
            state: dict[str, Any] = {"graduated": None, "eth_reserve": None}
            try:
                w3 = clients.get(row.network) or clients.setdefault(row.network, blockchain.get_web3(row.network))
                curve = w3.eth.contract(address=Web3.to_checksum_address(row.contract_address), abi=_STATE_ABI)
                state = {"graduated": curve.functions.graduated().call(), "eth_reserve": str(curve.functions.ethReserve().call())}
            except Exception:  # noqa: BLE001 — one network down shouldn't empty the feed
                pass
            launches.append(
                {
                    "network": row.network,
                    "address": Web3.to_checksum_address(row.contract_address),
                    "name": params.get("TOKEN_NAME"),
                    "symbol": params.get("TOKEN_SYMBOL"),
                    "graduation_target": str(params.get("GRADUATION_TARGET")),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    **state,
                }
            )
        return {"launches": launches}

    return _cached(("curve-launches", network), build, seconds=15)


def fees_owed() -> list[dict[str, Any]]:
    """Every curve launched here that holds platform fees, with how much.
    Anyone can send them on with the curve's withdrawFees(); they only ever
    go to its fixed feeRecipient. Curves launched before the fee (no
    feesOwed()) and ones whose network can't be read are left out."""
    owed = []
    clients: dict[str, Any] = {}
    for row in ContractDeployment.query.filter(ContractDeployment.template_id == "curve_token").order_by(ContractDeployment.created_at.asc()):
        try:
            w3 = clients.get(row.network) or clients.setdefault(row.network, blockchain.get_web3(row.network))
            curve = w3.eth.contract(address=Web3.to_checksum_address(row.contract_address), abi=_FEES_ABI)
            amount = curve.functions.feesOwed().call()
        except Exception:  # noqa: BLE001 — a legacy curve, or the network is down
            continue
        if amount:
            owed.append({"network": row.network, "address": Web3.to_checksum_address(row.contract_address), "symbol": (row.parameters or {}).get("TOKEN_SYMBOL"), "fees_owed": amount})
    return owed
