import pytest

from app.services import contract_templates, solidity


def test_get_all_templates_returns_the_three_real_templates():
    templates = contract_templates.get_all_templates()
    assert {t.id for t in templates} == {"erc20_basic", "erc20_advanced", "erc721_basic"}


def test_get_all_templates_filters_by_type():
    erc721_templates = contract_templates.get_all_templates("erc721")
    assert {t.id for t in erc721_templates} == {"erc721_basic"}


def test_render_contract_substitutes_parameters_and_reads_back_contract_name():
    rendered = contract_templates.render_contract(
        "erc20_basic",
        {"TOKEN_NAME": "MyToken", "TOKEN_SYMBOL": "MTK", "TOKEN_DECIMALS": 18, "TOKEN_SUPPLY": 1000},
    )
    assert "contract MyToken is IERC20" in rendered["contract_code"]
    assert rendered["contract_name"] == "MyToken"
    assert "{{" not in rendered["contract_code"]


def test_render_contract_raises_on_missing_required_param():
    with pytest.raises(contract_templates.MissingParametersError):
        contract_templates.render_contract("erc20_basic", {"TOKEN_NAME": "MyToken"})


def test_render_contract_raises_on_unknown_template():
    with pytest.raises(contract_templates.UnknownTemplateError):
        contract_templates.render_contract("does_not_exist", {})


def test_render_contract_rejects_non_dict_parameters_instead_of_crashing():
    # Regression: a list containing the required param names as strings
    # (e.g. ["TOKEN_NAME", "TOKEN_SYMBOL", "TOKEN_DECIMALS", "TOKEN_SUPPLY"])
    # passed the old `name not in parameters` check (list membership, not
    # dict-key membership) without being a dict, then crashed `.items()`
    # with an unhandled AttributeError — reachable via the unauthenticated
    # /api/contracts/compile route.
    with pytest.raises(contract_templates.MissingParametersError):
        contract_templates.render_contract(
            "erc20_basic",
            ["TOKEN_NAME", "TOKEN_SYMBOL", "TOKEN_DECIMALS", "TOKEN_SUPPLY"],
        )


def test_display_names_with_spaces_get_a_derived_contract_identifier():
    rendered = contract_templates.render_contract(
        "erc721_basic",
        {"COLLECTION_NAME": "My Cool Apes", "COLLECTION_SYMBOL": "APE", "MAX_SUPPLY": 3, "MINT_PRICE": 0, "BASE_URI": "ipfs://x/"},
    )
    assert "contract MyCoolApes is IERC721" in rendered["contract_code"]
    assert 'string public name = "My Cool Apes";' in rendered["contract_code"]
    assert rendered["contract_name"] == "MyCoolApes"
    # MAX_MINTS_PER_WALLET is required but has a default — filled, not "missing".
    assert "uint256 public maxMintsPerWallet = 10;" in rendered["contract_code"]


def test_a_quote_in_a_string_parameter_cannot_inject_solidity():
    # Regression: values used to be pasted in raw, so a `"` closed the
    # literal and everything after it compiled as contract code.
    payload = 'x"; function drain() public { selfdestruct(payable(msg.sender)); } string public y = "'
    rendered = contract_templates.render_contract(
        "erc20_basic", {"TOKEN_NAME": "Safe", "TOKEN_SYMBOL": payload, "TOKEN_DECIMALS": 18, "TOKEN_SUPPLY": 1}
    )
    assert 'string public symbol = "x\\"; function drain()' in rendered["contract_code"]
    # The real proof: it compiles, and the "function" is just text inside
    # the symbol string — not a function in the contract's ABI.
    compiled = solidity.compile_contract(rendered["contract_code"], rendered["contract_name"])
    assert compiled.success, compiled.error_message
    assert "drain" not in {entry.get("name") for entry in compiled.abi}


def test_non_ascii_names_render_as_unicode_literals():
    rendered = contract_templates.render_contract(
        "erc20_basic", {"TOKEN_NAME": "Café Coin", "TOKEN_SYMBOL": "CAF", "TOKEN_SUPPLY": 1}
    )
    assert 'string public name = unicode"Café Coin";' in rendered["contract_code"]
    assert rendered["contract_name"] == "CafeCoin"


def test_addresses_are_checksummed_so_lowercase_input_compiles():
    rendered = contract_templates.render_contract(
        "erc20_advanced",
        {
            "TOKEN_NAME": "Adv",
            "TOKEN_SYMBOL": "ADV",
            "TOKEN_SUPPLY": 1000,
            "MAX_TX_AMOUNT": 10,
            "MAX_WALLET_AMOUNT": 20,
            "MARKETING_WALLET": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            "LIQUIDITY_WALLET": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        },
    )
    assert "marketingWallet = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;" in rendered["contract_code"]


def test_extra_parameters_are_never_substituted():
    rendered = contract_templates.render_contract(
        "erc20_basic",
        {"TOKEN_NAME": "Real", "TOKEN_SYMBOL": "R", "TOKEN_SUPPLY": 1, "CONTRACT_NAME": "Injected {"},
    )
    assert rendered["contract_name"] == "Real"
    assert "Injected" not in rendered["contract_code"]


@pytest.mark.parametrize(
    "bad",
    [
        {"TOKEN_SUPPLY": "1e5"},
        {"TOKEN_SUPPLY": True},
        {"TOKEN_SUPPLY": -1},
        {"TOKEN_DECIMALS": 256},
        {"TOKEN_NAME": "line\nbreak"},
        {"TOKEN_NAME": "   "},
        {"TOKEN_SYMBOL": 42},
    ],
)
def test_invalid_parameter_values_are_rejected(bad):
    params = {"TOKEN_NAME": "T", "TOKEN_SYMBOL": "T", "TOKEN_SUPPLY": 1, **bad}
    with pytest.raises(contract_templates.TemplateParameterError):
        contract_templates.render_contract("erc20_basic", params)


@pytest.mark.parametrize(
    "display_name, expected",
    [("My Token", "MyToken"), ("my_token", "My_token"), ("123", "ERC20123"), ("!!!", "ERC20"), ("IERC20", "IERC20ERC20")],
)
def test_contract_identifier(display_name, expected):
    assert contract_templates.contract_identifier(display_name, fallback="ERC20") == expected
