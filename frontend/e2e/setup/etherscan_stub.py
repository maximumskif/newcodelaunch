"""Local stand-in for Etherscan's V2 contract-verification API, used only by
the e2e suite (backend/app/services/explorer_verification.py points at it
via ETHERSCAN_API_URL, set by run-backend.sh).

Not a canned "Pass": it actually verifies, the way an explorer does. It
compiles the submitted standard-JSON input with the requested solc version
and compares the resulting runtime bytecode — metadata hash included —
byte-for-byte against the code really deployed at that address on the
local anvil chain (eth_getCode). So an e2e pass means the source, settings,
compiler version, and contract name this app submits genuinely reproduce
the deployed contract. What's not real: Etherscan's own availability, and
its per-chain coverage/rate limits.

Like Etherscan, the first status check of a submission answers "Pending in
queue", so the app's polling path is exercised too.

Run via e2e/setup/run-etherscan-stub.sh, not directly.
"""

from __future__ import annotations

import json
import os
import uuid

import requests
from flask import Flask, jsonify, request
from solcx import compile_standard, install_solc

app = Flask(__name__)

ANVIL_RPC_URL = os.environ.get("ANVIL_RPC_URL", "http://127.0.0.1:8545")
ANVIL_CHAIN_ID = "11155111"  # run-anvil.sh runs anvil as Sepolia

# guid -> {"result": final message, "polled": bool}
_JOBS: dict[str, dict] = {}


def _deployed_code(address: str) -> str:
    response = requests.post(
        ANVIL_RPC_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [address, "latest"]},
        timeout=10,
    )
    return response.json()["result"].lower().removeprefix("0x")


def _verify(form) -> str:
    version = form["compilerversion"].removeprefix("v").split("+", 1)[0]
    install_solc(version)
    path, _, name = form["contractname"].rpartition(":")
    output = compile_standard(json.loads(form["sourceCode"]), solc_version=version)
    try:
        compiled = output["contracts"][path][name]["evm"]["deployedBytecode"]["object"].lower()
    except KeyError:
        return f"Fail - Unable to verify. Contract {form['contractname']} not found in the submitted source"
    deployed = _deployed_code(form["contractaddress"])
    if not deployed:
        return f"Unable to locate ContractCode at {form['contractaddress']}"
    if compiled != deployed:
        return "Fail - Unable to verify. Compiled bytecode does NOT match the deployed bytecode"
    return "Pass - Verified"


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.route("/v2/api", methods=["GET", "POST"])
def api():
    params = {**request.args, **request.form}
    if not params.get("apikey"):
        return jsonify(status="0", message="NOTOK", result="Missing/Invalid API Key")
    if params.get("chainid") != ANVIL_CHAIN_ID:
        return jsonify(status="0", message="NOTOK", result=f"Unsupported chainid {params.get('chainid')}")

    action = params.get("action")
    if action == "verifysourcecode" and request.method == "POST":
        result = _verify(request.form)
        if result.startswith("Unable to locate"):
            return jsonify(status="0", message="NOTOK", result=result)
        guid = uuid.uuid4().hex
        _JOBS[guid] = {"result": result, "polled": False}
        return jsonify(status="1", message="OK", result=guid)

    if action == "checkverifystatus":
        job = _JOBS.get(params.get("guid", ""))
        if job is None:
            return jsonify(status="0", message="NOTOK", result="Unknown GUID")
        if not job["polled"]:
            job["polled"] = True
            return jsonify(status="0", message="NOTOK", result="Pending in queue")
        passed = job["result"].startswith("Pass")
        return jsonify(status="1" if passed else "0", message="OK" if passed else "NOTOK", result=job["result"])

    return jsonify(status="0", message="NOTOK", result=f"Unsupported action {action}")


if __name__ == "__main__":
    app.run(port=5557)
