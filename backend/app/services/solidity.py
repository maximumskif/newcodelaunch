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

from solcx import compile_source, install_solc, set_solc_version

SOLC_VERSION = "0.8.19"

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


def compile_contract(source: str, contract_name: str) -> CompilationResult:
    ensure_solc_installed()
    set_solc_version(SOLC_VERSION)

    try:
        compiled = compile_source(source, optimize=True, optimize_runs=200, output_values=["abi", "bin"])
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller as a compile error
        return CompilationResult(success=False, error_message=str(exc))

    contract_interface = None
    for contract_id, contract_data in compiled.items():
        if contract_id.split(":")[-1] == contract_name:
            contract_interface = contract_data
            break
    if contract_interface is None:
        contract_interface = next(iter(compiled.values()), None)

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
    bytecode = contract_interface["bin"]
    if not bytecode.startswith("0x"):
        bytecode = "0x" + bytecode
    return CompilationResult(success=True, abi=contract_interface["abi"], bytecode=bytecode)
