"""
Holder snapshot: every wallet holding a token, with its balance — for
airdrops to holders, reward lists, or just seeing who holds.

Solana: all token accounts for the mint (one getProgramAccounts call,
only the owner and amount bytes of each), summed per owner, as of now.
EVM: tokens launched here only, replaying every Transfer event from the
deploy block (which we know from the recorded deploy transaction) to the
chosen block — so a snapshot can be taken at a past block. Log ranges are
fetched in chunks that shrink when the RPC refuses a range as too large.

Results are cached briefly per query; the route is rate-limited.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any, Optional

from solana.rpc.models import DataSliceOpts, MemcmpOpts
from solders.pubkey import Pubkey
from web3 import Web3

from ..models.deployment import ContractDeployment
from ..models.solana_token import SolanaTokenLaunch
from . import blockchain
from .token_pages import _fn

TRANSFER_TOPIC = "0x" + Web3.keccak(text="Transfer(address,address,uint256)").hex().removeprefix("0x")
ZERO = "0x0000000000000000000000000000000000000000"
DEAD = "0x000000000000000000000000000000000000dead"
# Holders returned (largest first); the count is always the full one.
MAX_LISTED = 10_000
_FIRST_CHUNK = 50_000
_MAX_REQUESTS = 2_000
_CACHE_SECONDS = 60
_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}

_ERC20_ABI = [_fn("decimals", ["uint8"]), _fn("symbol", ["string"]), _fn("totalSupply", ["uint256"])]


class SnapshotError(ValueError):
    pass


class ChainReadError(RuntimeError):
    pass


def _cached(key: tuple, build) -> dict[str, Any]:
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_SECONDS:
        return hit[1]
    result = build()
    _cache[key] = (now, result)
    # Keep the cache small: drop anything expired.
    for stale in [k for k, (at, _) in _cache.items() if now - at >= _CACHE_SECONDS]:
        _cache.pop(stale, None)
    return result


def _summary(balances: dict[str, int], supply: int, decimals: int, **extra: Any) -> dict[str, Any]:
    held = sorted(((owner, amount) for owner, amount in balances.items() if amount > 0), key=lambda item: -item[1])
    return {
        **extra,
        "decimals": decimals,
        "total_supply": str(supply),
        "holder_count": len(held),
        "truncated": len(held) > MAX_LISTED,
        "holders": [
            {"address": owner, "balance": str(amount), "share": amount / supply if supply else 0}
            for owner, amount in held[:MAX_LISTED]
        ],
    }


def _transfer_logs(w3: Web3, address: str, start: int, end: int) -> list[Any]:
    logs: list[Any] = []
    chunk, block, requests = _FIRST_CHUNK, start, 0
    while block <= end:
        requests += 1
        if requests > _MAX_REQUESTS:
            raise SnapshotError("This token has too much history to replay here")
        to_block = min(block + chunk - 1, end)
        try:
            logs.extend(w3.eth.get_logs({"address": address, "topics": [TRANSFER_TOPIC], "fromBlock": block, "toBlock": to_block}))
        except Exception:  # noqa: BLE001 — "range too large" / "too many results" wording varies by provider
            if chunk == 1:
                raise
            chunk = max(1, chunk // 4)
            continue
        block = to_block + 1
    return logs


def snapshot_evm(network: str, address: str, at_block: Optional[int] = None) -> dict[str, Any]:
    if network not in blockchain.EVM_NETWORKS:
        raise SnapshotError(f"Unknown EVM network: {network}")
    if not Web3.is_address(address):
        raise SnapshotError("That isn't an EVM address (0x followed by 40 hex characters)")
    checksum = Web3.to_checksum_address(address)
    deployment = (
        ContractDeployment.query.filter(ContractDeployment.contract_address.ilike(checksum), ContractDeployment.network == network, ContractDeployment.contract_type == "erc20")
        .order_by(ContractDeployment.created_at.asc())
        .first()
    )
    if deployment is None:
        raise SnapshotError("EVM snapshots work for tokens launched here (we replay its history from the block it was deployed in)")

    def build() -> dict[str, Any]:
        try:
            w3 = blockchain.get_web3(network)
            latest = w3.eth.block_number
            end = latest if at_block is None else at_block
            start = w3.eth.get_transaction_receipt(deployment.transaction_hash)["blockNumber"]
            if end < start:
                raise SnapshotError(f"The token didn't exist yet at block {end} (deployed in block {start})")
            if end > latest:
                raise SnapshotError(f"Block {end} hasn't happened yet (latest is {latest})")
            token = w3.eth.contract(address=checksum, abi=_ERC20_ABI)
            symbol = token.functions.symbol().call()
            decimals = token.functions.decimals().call()
            supply = token.functions.totalSupply().call(block_identifier=end)
            logs = _transfer_logs(w3, checksum, start, end)
        except SnapshotError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ChainReadError(str(exc)) from exc

        balances: dict[str, int] = defaultdict(int)
        for log in logs:
            topics = log["topics"]
            if len(topics) != 3:
                continue
            sender = Web3.to_checksum_address(bytes(topics[1])[-20:])
            recipient = Web3.to_checksum_address(bytes(topics[2])[-20:])
            data = log["data"]
            amount = int.from_bytes(bytes(data), "big") if not isinstance(data, str) else int(data, 16)
            balances[sender] -= amount
            balances[recipient] += amount
        # Mints come from the zero address; its "balance" is just negative supply.
        balances.pop(Web3.to_checksum_address(ZERO), None)
        return _summary(
            balances,
            supply,
            decimals,
            chain="evm",
            network=network,
            address=checksum,
            symbol=symbol,
            as_of={"block": end, "latest": end == latest},
            burn_addresses=[Web3.to_checksum_address(DEAD)],
        )

    return _cached(("evm", network, checksum.lower(), at_block), build)


def snapshot_solana(network: str, mint: str) -> dict[str, Any]:
    if network not in blockchain.SOLANA_NETWORKS:
        raise SnapshotError(f"Unknown Solana network: {network}")
    try:
        mint_key = Pubkey.from_string(mint)
    except Exception as exc:  # noqa: BLE001
        raise SnapshotError("That isn't a Solana address") from exc

    def build() -> dict[str, Any]:
        info = blockchain.get_solana_mint_info(network, mint)
        if info["status"] in ("not_found", "not_a_mint"):
            raise SnapshotError("This address isn't an SPL token mint")
        if info["status"] != "success":
            raise ChainReadError(info.get("error", "mint read failed"))

        async def _fetch():
            async with blockchain._get_solana_client(network) as client:
                # Token accounts are 165 bytes: mint (0–32), owner (32–64),
                # amount (64–72, little-endian). Only owner + amount come back.
                return await client.get_program_accounts(
                    Pubkey.from_string(blockchain.SPL_TOKEN_PROGRAM_ID),
                    encoding="base64",
                    data_slice=DataSliceOpts(offset=32, length=40),
                    filters=[165, MemcmpOpts(offset=0, bytes=str(mint_key))],
                )

        try:
            response = asyncio.run(_fetch())
        except Exception as exc:  # noqa: BLE001
            raise ChainReadError(str(exc)) from exc
        balances: dict[str, int] = defaultdict(int)
        for keyed in response.value:
            data = bytes(keyed.account.data)
            balances[str(Pubkey.from_bytes(data[:32]))] += int.from_bytes(data[32:40], "little")
        ours = SolanaTokenLaunch.query.filter_by(mint_address=mint, network=network).first()
        return _summary(
            balances,
            int(info["supply"]),
            info["decimals"],
            chain="solana",
            network=network,
            address=mint,
            symbol=ours.symbol if ours else None,
            as_of={"block": None, "latest": True},
            burn_addresses=[],
        )

    return _cached(("solana", network, mint), build)
