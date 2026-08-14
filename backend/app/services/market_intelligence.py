"""
Real CoinGecko token market data (Phase 6 — Market Intelligence).

The legacy market_intelligence.py faked this entirely — `random.uniform()`
for price/volume/change, no network call at all. This calls CoinGecko's
public /coins/markets endpoint for real. COINGECKO_API_KEY is optional: it
still works unauthenticated, just at CoinGecko's lower public rate limit.
"""

from __future__ import annotations

from typing import Any

import requests
from flask import current_app

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"


class MarketDataError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    api_key = current_app.config.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": api_key} if api_key else {}


def get_top_tokens(limit: int = 20) -> list[dict[str, Any]]:
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
    except requests.RequestException as exc:
        raise MarketDataError(f"CoinGecko request failed: {exc}") from exc

    return [
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
        for coin in response.json()
    ]
