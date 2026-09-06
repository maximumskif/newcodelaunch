"""
Real CoinGecko token market data (Phase 6 — Market Intelligence).

The legacy market_intelligence.py faked this entirely — `random.uniform()`
for price/volume/change, no network call at all. This calls CoinGecko's
public /coins/markets endpoint for real. COINGECKO_API_KEY is optional: it
still works unauthenticated, just at CoinGecko's lower public rate limit.
"""

from __future__ import annotations

import time
from typing import Any

import requests
from flask import current_app

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"

# Short server-side cache so N concurrent page loads don't each trigger their
# own CoinGecko request — the frontend already only refetches every 60s
# (react-query), so a shorter TTL here still cuts duplicate upstream calls
# without making the data noticeably staler. Per-process only: with more
# than one gunicorn worker, each worker holds its own cache, same caveat as
# this app's in-memory rate limiter (see docs/REBUILD_PROGRESS.md) — a
# shared cache (Redis) would be needed to fully dedupe across workers, but
# unlike the rate limiter this is a pure optimization, not a correctness
# issue, so the simple per-process version is a safe improvement on its own.
_CACHE_TTL_SECONDS = 30
_cache: dict[int, tuple[float, list[dict[str, Any]]]] = {}


class MarketDataError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    api_key = current_app.config.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": api_key} if api_key else {}


def get_top_tokens(limit: int = 20) -> list[dict[str, Any]]:
    cached = _cache.get(limit)
    if cached is not None:
        cached_at, data = cached
        if time.monotonic() - cached_at < _CACHE_TTL_SECONDS:
            return data

    try:
        response = requests.get(
            f"{COINGECKO_BASE_URL}/coins/markets",
            params={
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": min(limit, 100),
                "page": 1,
                "price_change_percentage": "24h",
            },
            headers=_headers(),
            timeout=15,
        )
        response.raise_for_status()
        coins = response.json()
    except requests.RequestException as exc:
        raise MarketDataError(f"CoinGecko request failed: {exc}") from exc

    if not isinstance(coins, list):
        # A 200 with a non-list body (e.g. a rate-limit/error object) means
        # something is wrong even though raise_for_status() didn't catch it.
        raise MarketDataError(f"CoinGecko returned an unexpected response shape: {coins!r}")

    result = [
        {
            "id": coin["id"],
            "symbol": coin["symbol"].upper(),
            "name": coin["name"],
            "image": coin.get("image"),
            "current_price": coin.get("current_price"),
            "market_cap": coin.get("market_cap"),
            "market_cap_rank": coin.get("market_cap_rank"),
            "total_volume": coin.get("total_volume"),
            "price_change_percentage_24h": coin.get("price_change_percentage_24h"),
        }
        for coin in coins
    ]
    _cache[limit] = (time.monotonic(), result)
    return result
