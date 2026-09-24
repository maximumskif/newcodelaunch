"""
Solidity compilation via solcx (py-solc-x).

The old smart_contract_deployer.py called install_solc() as a side effect of
constructing its module-level singleton — `import smart_contract_deployer`
made a network call (to download the solc binary) before anything even asked
to compile something. Same "does I/O at import time" problem Phase 1 fixed in
blockchain_manager.py. Here, install is lazy and cached after the first call.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Optional

from solcx import compile_standard, get_solc_version, install_solc, set_solc_version

SOLC_VERSION = "0.8.19"

# The source's name inside the compiler input. It's part of the metadata
# hash embedded at the end of the bytecode, so verification must submit the
# exact same name the deploy was compiled under. "<stdin>" because that's
# what every deployment before 2026-09-24 was compiled as (py-solc-x's
# compile_source pipes the source through stdin) — keeping it means those
# contracts reproduce byte-for-byte too, not just new ones.
SOURCE_NAME = "<stdin>"

_install_lock = threading.Lock()
_installed = False


def ensure_solc_installed() -> None:
    global _installed
    if _installed:
        return
    with _install_lock:
        if _installed:
            return
        install_solc(SOLC_VERSION)
        _installed = True


@dataclass
class CompilationResult:
    success: bool
    abi: Optional[list[dict[str, Any]]] = None
    bytecode: Optional[str] = None
    error_message: Optional[str] = None


def standard_json_input(source: str) -> dict[str, Any]:
    """The one compiler input every deploy is built from — and, verbatim,
    what gets submitted to a block explorer for source verification
    (services/explorer_verification.py), so the two can't drift apart.
    evmVersion is pinned to what solc 0.8.19 defaults to, rather than left
    implicit, so an explorer recompiling it can't pick a different one."""
    return {
        "language": "Solidity",
        "sources": {SOURCE_NAME: {"content": source}},
        "settings": {
            "optimizer": {"enabled": True, "runs": 200},
            "evmVersion": "paris",
            "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]}},
        },
    }


def compiler_version() -> str:
    """Full version string in the form block explorers expect, e.g.
    "v0.8.19+commit.7dd6d404"."""
    ensure_solc_installed()
    set_solc_version(SOLC_VERSION)
    return f"v{get_solc_version(with_commit_hash=True)}"


def compile_contract(source: str, contract_name: str) -> CompilationResult:
    ensure_solc_installed()
    set_solc_version(SOLC_VERSION)

    try:
        output = compile_standard(standard_json_input(source))
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller as a compile error
        return CompilationResult(success=False, error_message=str(exc))

    compiled = output.get("contracts", {}).get(SOURCE_NAME, {})
    contract_interface = compiled.get(contract_name) or next(iter(compiled.values()), None)

    if contract_interface is None:
        return CompilationResult(success=False, error_message="No contract found in compilation output")

    # solcx's own "bin" field is bare hex, no "0x" prefix — every real EVM
    # tool (web3.py tolerates either, but viem/ethers and the raw JSON-RPC
    # eth_sendTransaction `data` field do not) expects "0x"-prefixed hex.
    # Found via real end-to-end testing (see frontend/e2e/): the frontend's
    # useDeployTemplate.ts cast this string to `0x${string}` with a bare
    # TypeScript `as`, which changes nothing at runtime — every real
    # deployment was sending malformed, unprefixed `data`, and reverted
    # on-chain with a raw EVM `OpcodeNotFound` (misaligned bytecode) instead
    # of ever compiling into anything. Never caught before because nothing
    # had driven this flow through a real chain until this test existed.
    bytecode = contract_interface["evm"]["bytecode"]["object"]
    if not bytecode.startswith("0x"):
        bytecode = "0x" + bytecode
    return CompilationResult(success=True, abi=contract_interface["abi"], bytecode=bytecode)
