"""
Real DeFiLlama protocol TVL data (Phase 6 — DeFi Protocol Scanner).

The legacy defi_scanner.py faked this too. DeFiLlama's /protocols endpoint
is public and free — no API key needed.
"""

from __future__ import annotations

import time
from typing import Any

import requests

DEFILLAMA_BASE_URL = "https://api.llama.fi"

# Same rationale/caveat as market_intelligence.get_top_tokens's cache — see
# that module's comment. Cached differently, though: DeFiLlama's /protocols
# endpoint has no limit param, so every call fetches the *entire* protocol
# list regardless of `limit` and only slices it locally. Caching per-limit
# (like market_intelligence does, where the upstream call itself is
# limit-scoped) would re-fetch that same full list once per distinct limit
# value seen — cache the single full sorted list instead, and slice from
# the cache on every call.
_CACHE_TTL_SECONDS = 30
_cache: tuple[float, list[dict[str, Any]]] | None = None


class DefiDataError(RuntimeError):
    pass


def _get_sorted_protocols() -> list[dict[str, Any]]:
    global _cache
    if _cache is not None:
        cached_at, data = _cache
        if time.monotonic() - cached_at < _CACHE_TTL_SECONDS:
            return data

    try:
        response = requests.get(f"{DEFILLAMA_BASE_URL}/protocols", timeout=15)
        response.raise_for_status()
        protocols = response.json()
    except requests.RequestException as exc:
        raise DefiDataError(f"DeFiLlama request failed: {exc}") from exc

    if not isinstance(protocols, list):
        # A 200 with a non-list body (e.g. a rate-limit/error object) means
        # something is wrong even though raise_for_status() didn't catch it.
        raise DefiDataError(f"DeFiLlama returned an unexpected response shape: {protocols!r}")

    protocols.sort(key=lambda p: p.get("tvl") or 0, reverse=True)

    result = [
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
        for p in protocols
    ]
    _cache = (time.monotonic(), result)
    return result


def get_top_protocols(limit: int = 20) -> list[dict[str, Any]]:
    return _get_sorted_protocols()[:limit]
