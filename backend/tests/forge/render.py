"""Renders the Bonding-Curve Token template into src/ for the Foundry tests,
exactly as the backend renders it for a deploy. FACTORY and WRAPPED_NATIVE
are fixed test addresses; the tests put Uniswap's own V2 code there.

    cd backend && .venv/bin/python tests/forge/render.py && cd tests/forge && forge test
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services import contract_templates  # noqa: E402

FACTORY = "0x00000000000000000000000000000000000fAc70"
WRAPPED_NATIVE = "0x0000000000000000000000000000000000057e70"

# (display name, supply in whole tokens, graduation target in wei)
VARIANTS = [
    ("Curve Default", 1_000_000_000, 4 * 10**18),
    ("Curve Small", 1_000, 10**15),  # the smallest supply and target allowed
    ("Curve Huge", 10**15, 10**24),  # the largest
    ("Curve Odd", 777_777_777, 3_333_333_333_333_333_337),  # nothing divides evenly
]

out = Path(__file__).resolve().parent / "src"
out.mkdir(exist_ok=True)
for display_name, supply, target in VARIANTS:
    rendered = contract_templates.render_contract(
        "curve_token",
        {
            "TOKEN_NAME": display_name,
            "TOKEN_SYMBOL": "CRV",
            "TOKEN_SUPPLY": supply,
            "GRADUATION_TARGET": target,
            "FACTORY": FACTORY,
            "WRAPPED_NATIVE": WRAPPED_NATIVE,
        },
    )
    (out / f"{rendered['contract_name']}.sol").write_text(rendered["contract_code"])
    print(f"src/{rendered['contract_name']}.sol")
