import pytest

from app.services import contract_templates


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
