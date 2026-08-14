"""
Real DeFiLlama protocol TVL data (Phase 6 — DeFi Protocol Scanner).

The legacy defi_scanner.py faked this too. DeFiLlama's /protocols endpoint
is public and free — no API key needed.
"""

from __future__ import annotations

from typing import Any

import requests

DEFILLAMA_BASE_URL = "https://api.llama.fi"


class DefiDataError(RuntimeError):
    pass


def get_top_protocols(limit: int = 20) -> list[dict[str, Any]]:
    try:
        response = requests.get(f"{DEFILLAMA_BASE_URL}/protocols", timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise DefiDataError(f"DeFiLlama request failed: {exc}") from exc

    protocols = response.json()
    protocols.sort(key=lambda p: p.get("tvl") or 0, reverse=True)

    return [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "symbol": p.get("symbol"),
            "category": p.get("category"),
            "chains": p.get("chains", []),
            "tvl": p.get("tvl"),
            "change_1d": p.get("change_1d"),
            "change_7d": p.get("change_7d"),
            "url": p.get("url"),
            "logo": p.get("logo"),
        }
        for p in protocols[:limit]
    ]
