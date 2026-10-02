import shutil

import pytest

from app.services import contract_templates, solidity

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (solidity.SOLCJS_DIR / "node_modules" / "solc").exists(),
    reason="needs Node and `npm ci` in backend/solcjs",
)


def _sample_parameters(template) -> dict:
    params = {}
    for param in template.deployment_params:
        if param.get("default") is not None:
            params[param["name"]] = param["default"]
        elif param["type"] == "address":
            params[param["name"]] = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
        elif param["type"] == "string":
            params[param["name"]] = "SMP" if "SYMBOL" in param["name"] else "ipfs://bafyX/" if "URI" in param["name"] else "Sample"
        else:
            params[param["name"]] = "4133980800" if param["name"] == "END_TIME" else "4102444800" if "TIME" in param["name"] else "1000"
    return params


@pytest.mark.parametrize("template", contract_templates.get_all_templates(), ids=lambda t: t.id)
def test_the_webassembly_compiler_reproduces_native_output_exactly(template, monkeypatch):
    # ARM servers have no native solc 0.8.19, so they compile with its
    # WebAssembly build. Code-match checks and explorer verification only
    # work if both produce identical bytes — metadata hash included.
    rendered = contract_templates.render_contract(template.id, _sample_parameters(template))
    results = {}
    for backend in ("native", "wasm"):
        monkeypatch.setenv("SOLC_BACKEND", backend)
        results[backend] = solidity.compile_contract(rendered["contract_code"], rendered["contract_name"])
        assert results[backend].success, results[backend].error_message

    native, wasm = results["native"], results["wasm"]
    assert (wasm.bytecode, wasm.deployed_bytecode, wasm.abi) == (native.bytecode, native.deployed_bytecode, native.abi)


def test_both_compilers_report_the_version_explorers_expect(monkeypatch):
    versions = set()
    for backend in ("native", "wasm"):
        monkeypatch.setenv("SOLC_BACKEND", backend)
        versions.add(solidity.compiler_version())
    assert versions == {"v0.8.19+commit.7dd6d404"}


def test_a_compile_error_comes_back_as_a_failed_result(monkeypatch):
    monkeypatch.setenv("SOLC_BACKEND", "wasm")
    result = solidity.compile_contract("contract Broken { function f( }", "Broken")
    assert not result.success and "ParserError" in (result.error_message or "")
