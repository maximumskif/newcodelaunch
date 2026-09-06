"""
Real, read-only blockchain connectivity — chain status, gas price, tx lookup.

Ported from the old root-level blockchain_manager.py, with two deliberate changes:

1. Connections are created per-request instead of once at import time. The old
   module made live RPC calls as a side effect of `import blockchain_manager`
   (inside BlockchainManager.__init__), which meant a slow/unreachable RPC
   endpoint could hang or fail app startup. Here, nothing touches the network
   until a route actually asks for it.
2. The Solana client calls are rewritten against the current solana-py/solders
   typed-response API (`.value` accessors, `Signature` objects). The old code
   used `get_recent_blockhash()` / `get_confirmed_transaction()` and dict-style
   `response['result']` indexing — both were removed years ago; that code would
   raise on every call, silently caught by a broad `except`, so Solana never
   actually connected in the old app.

NOTE: written against the documented solana-py 0.30+/solders typed API but not
execution-verified in this environment (no pip/venv available here — see
backend/requirements.txt). Smoke-test the /api/blockchain/solana/status route
first thing once you can actually install and run this.
"""

from __future__ import annotations

from typing import Optional

from flask import current_app
from solana.rpc.api import Client as SolanaClient
from solana.rpc.commitment import Confirmed
from solders.signature import Signature
from web3 import HTTPProvider, Web3
from web3.middleware import geth_poa_middleware

EVM_NETWORKS = {
    # Testnets first — this is also the order the frontend network picker
    # renders in, and it defaults to the first entry (see NetworkContext.tsx).
    "sepolia": {
        "name": "Ethereum Sepolia",
        "chain_id": 11155111,
        "explorer_url": "https://sepolia.etherscan.io",
        "native_token": "ETH",
        "poa": False,
        "is_testnet": True,
    },
    "ethereum": {
        "name": "Ethereum Mainnet",
        "chain_id": 1,
        "explorer_url": "https://etherscan.io",
        "native_token": "ETH",
        "poa": False,
        "is_testnet": False,
    },
    "polygon_amoy": {
        "name": "Polygon Amoy",
        "chain_id": 80002,
        "explorer_url": "https://amoy.polygonscan.com",
        "native_token": "POL",
        "poa": True,
        "is_testnet": True,
    },
    "polygon": {
        "name": "Polygon Mainnet",
        "chain_id": 137,
        "explorer_url": "https://polygonscan.com",
        "native_token": "POL",
        "poa": True,
        "is_testnet": False,
    },
    "bsc_testnet": {
        "name": "BNB Smart Chain Testnet",
        "chain_id": 97,
        "explorer_url": "https://testnet.bscscan.com",
        "native_token": "tBNB",
        "poa": True,
        "is_testnet": True,
    },
    "bsc": {
        "name": "BNB Smart Chain",
        "chain_id": 56,
        "explorer_url": "https://bscscan.com",
        "native_token": "BNB",
        "poa": True,
        "is_testnet": False,
    },
}

SOLANA_NETWORKS = {
    # Testnet first, same convention as EVM_NETWORKS above — added for the
    # Candy Machine creator flow (Phase 6), which is testnet-first too.
    "solana_devnet": {
        "name": "Solana Devnet",
        # Base URL only, like every other network here — candy_machine.py
        # appends /address/<pubkey> and the ?cluster=devnet suffix itself.
        "explorer_url": "https://explorer.solana.com",
        "native_token": "SOL",
        "is_testnet": True,
    },
    "solana": {
        "name": "Solana Mainnet",
        "explorer_url": "https://explorer.solana.com",
        "native_token": "SOL",
        "is_testnet": False,
    },
}

_RPC_CONFIG_KEYS = {
    "sepolia": "SEPOLIA_RPC_URL",
    "ethereum": "ETHEREUM_RPC_URL",
    "polygon_amoy": "POLYGON_AMOY_RPC_URL",
    "polygon": "POLYGON_RPC_URL",
    "bsc_testnet": "BSC_TESTNET_RPC_URL",
    "bsc": "BSC_RPC_URL",
    "solana_devnet": "SOLANA_DEVNET_RPC_URL",
    "solana": "SOLANA_RPC_URL",
}


class UnknownNetworkError(ValueError):
    pass


def _rpc_url(network: str) -> str:
    try:
        config_key = _RPC_CONFIG_KEYS[network]
    except KeyError as exc:
        raise UnknownNetworkError(f"Unknown network: {network}") from exc
    return current_app.config[config_key]


def _get_web3(network: str) -> Web3:
    w3 = Web3(HTTPProvider(_rpc_url(network), request_kwargs={"timeout": 10}))
    if EVM_NETWORKS[network]["poa"]:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    return w3


def get_web3(network: str) -> Web3:
    """Public accessor for other services (e.g. contracts.py) that need a raw
    Web3 connection — for gas estimation against a compiled contract, for
    example — rather than one of the higher-level status/lookup helpers below."""
    if network not in EVM_NETWORKS:
        raise UnknownNetworkError(f"Not an EVM network: {network}")
    return _get_web3(network)


def _get_solana_client(network: str) -> SolanaClient:
    # Explicit "confirmed", not solana-py's own default ("finalized") — the
    # frontend only waits for "confirmed" before ever calling this app's own
    # record/verify endpoints (see MintLaunchPage.tsx's confirmTransaction
    # calls), so requiring "finalized" here created a real, narrow window
    # where record_candy_machine's independent re-verification could 404
    # with "not_found" on a transaction that had already landed and been
    # shown to the user as successful — found via real end-to-end testing
    # against a local validator (see frontend/e2e/README.md), not observed
    # in this app's one prior manual devnet pass, likely because that pass's
    # timing happened not to land in the gap. "Confirmed" (supermajority
    # vote) is what Solana's own docs recommend trusting for this kind of
    # check; matching it here removes the gap instead of narrowing it.
    return SolanaClient(_rpc_url(network), commitment=Confirmed, timeout=10)


def get_supported_networks() -> list[dict]:
    networks = []
    for network_id, meta in {**EVM_NETWORKS, **SOLANA_NETWORKS}.items():
        networks.append({"id": network_id, **{k: v for k, v in meta.items() if k != "poa"}})
    return networks


def get_network_status(network: str) -> dict:
    if network in EVM_NETWORKS:
        return _get_evm_status(network)
    if network in SOLANA_NETWORKS:
        return _get_solana_status(network)
    raise UnknownNetworkError(f"Unknown network: {network}")


def _get_evm_status(network: str) -> dict:
    w3 = _get_web3(network)
    try:
        if not w3.is_connected():
            return {"connected": False, "error": "RPC endpoint did not respond"}
        latest_block = w3.eth.get_block("latest")
        gas_price = w3.eth.gas_price
        return {
            "connected": True,
            "network": EVM_NETWORKS[network]["name"],
            "chain_id": w3.eth.chain_id,
            "latest_block": latest_block["number"],
            "gas_price_gwei": float(w3.from_wei(gas_price, "gwei")),
            "block_timestamp": latest_block["timestamp"],
        }
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller, not swallowed
        return {"connected": False, "error": str(exc)}


def _get_solana_status(network: str) -> dict:
    client = _get_solana_client(network)
    try:
        slot = client.get_slot().value
        version = client.get_version().value
        blockhash_resp = client.get_latest_blockhash().value
        return {
            "connected": True,
            "network": SOLANA_NETWORKS[network]["name"],
            "slot": slot,
            "solana_core_version": getattr(version, "solana_core", str(version)),
            "latest_blockhash": str(blockhash_resp.blockhash),
        }
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "error": str(exc)}


def get_gas_price_gwei(network: str) -> Optional[float]:
    if network not in EVM_NETWORKS:
        return None
    w3 = _get_web3(network)
    return float(w3.from_wei(w3.eth.gas_price, "gwei"))


def get_transaction_status(network: str, tx_hash: str) -> dict:
    if network in EVM_NETWORKS:
        return _get_evm_transaction_status(network, tx_hash)
    if network in SOLANA_NETWORKS:
        return _get_solana_transaction_status(network, tx_hash)
    raise UnknownNetworkError(f"Unknown network: {network}")


def _get_evm_transaction_status(network: str, tx_hash: str) -> dict:
    w3 = _get_web3(network)
    try:
        receipt = w3.eth.get_transaction_receipt(tx_hash)
    except Exception:
        try:
            tx = w3.eth.get_transaction(tx_hash)
            return {"status": "pending", "from": tx["from"], "to": tx["to"], "value": tx["value"]}
        except Exception as exc:  # noqa: BLE001
            return {"status": "not_found", "error": str(exc)}

    tx = w3.eth.get_transaction(tx_hash)
    return {
        "status": "success" if receipt["status"] == 1 else "failed",
        "block_number": receipt["blockNumber"],
        "gas_used": receipt["gasUsed"],
        "gas_price": tx["gasPrice"],
        "from": receipt["from"],
        "to": receipt["to"],
        "value": tx["value"],
        "confirmations": w3.eth.block_number - receipt["blockNumber"],
    }


def _get_solana_transaction_status(network: str, tx_hash: str) -> dict:
    client = _get_solana_client(network)
    try:
        signature = Signature.from_string(tx_hash)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"Invalid signature: {exc}"}

    try:
        resp = client.get_transaction(signature, max_supported_transaction_version=0)
        if resp.value is None:
            return {"status": "not_found"}
        meta = resp.value.transaction.meta
        # Account keys touched by this transaction — used by candy_machine.py
        # to independently confirm a claimed collection_mint/candy_machine
        # address was actually involved in the verified transaction, not
        # just that *some* successful signature was supplied.
        account_keys = [str(key) for key in resp.value.transaction.transaction.message.account_keys]
        return {
            "status": "success" if meta.err is None else "failed",
            "slot": resp.value.slot,
            "fee": meta.fee,
            "error": str(meta.err) if meta.err else None,
            "account_keys": account_keys,
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}
