from app.services import solidity


def test_compile_contract_returns_0x_prefixed_bytecode():
    # Regression test for a real bug found via end-to-end testing against a
    # real chain (see frontend/e2e/): py-solc-x's own "bin" field has no
    # "0x" prefix, and the frontend trusted it was already prefixed via a
    # bare TypeScript `as` cast — which changes the type, not the runtime
    # string. Every real deployment sent malformed transaction `data` and
    # reverted on-chain with a raw EVM OpcodeNotFound (misaligned bytecode)
    # instead of ever running the compiled contract's actual code. Fixed at
    # this source so every caller gets standards-compliant hex, not just
    # whichever one happened to notice.
    result = solidity.compile_contract(
        "pragma solidity ^0.8.19;\ncontract Foo { uint256 public x = 1; }",
        "Foo",
    )

    assert result.success is True
    assert result.bytecode.startswith("0x")
    assert result.abi is not None


def test_compile_contract_reports_a_clean_error_on_invalid_source():
    result = solidity.compile_contract("this is not valid solidity", "Foo")

    assert result.success is False
    assert result.error_message
