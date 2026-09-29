"""
Real market data (Phase 6 — Market Intelligence).

The legacy market_intelligence.py faked this entirely — `random.uniform()`
for price/volume/change, no network call at all. Everything here is a real
upstream call:

- Top tokens by market cap: CoinGecko's /coins/markets, falling back to
  CoinPaprika's /tickers when CoinGecko refuses. Since 2026 CoinGecko
  answers keyless requests from many networks with a 403, which left the
  page with nothing. COINGECKO_API_KEY (a free "demo" key) makes CoinGecko
  the reliable first choice again; the response names the source used.
- Token lookup by contract address/mint, and trending tokens: DexScreener's
  public API, on any chain it indexes.
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable

import requests
from flask import current_app

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
COINPAPRIKA_BASE_URL = "https://api.coinpaprika.com/v1"
DEXSCREENER_BASE_URL = "https://api.dexscreener.com"

# Short server-side cache so N concurrent page loads don't each trigger their
# own upstream request — the frontend already only refetches every 60s
# (react-query), so a shorter TTL here still cuts duplicate upstream calls
# without making the data noticeably staler. Per-process only: with more
# than one gunicorn worker, each worker holds its own cache — a pure
# optimization, not a correctness issue.
_CACHE_TTL_SECONDS = 30
_cache: dict[Any, tuple[float, Any]] = {}


class MarketDataError(RuntimeError):
    pass


def _cached(key: Any, ttl: float, fetch: Callable[[], Any]) -> Any:
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = fetch()
    _cache[key] = (time.monotonic(), value)
    return value


def _get_json(url: str, source: str, **kwargs: Any) -> Any:
    try:
        response = requests.get(url, timeout=15, **kwargs)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise MarketDataError(f"{source} request failed: {exc}") from exc


def _headers() -> dict[str, str]:
    api_key = current_app.config.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": api_key} if api_key else {}


def _coingecko_top(limit: int) -> list[dict[str, Any]]:
    coins = _get_json(
        f"{COINGECKO_BASE_URL}/coins/markets",
        "CoinGecko",
        params={
            "vs_currency": "usd",
            "order": "market_cap_desc",
            "per_page": min(limit, 100),
            "page": 1,
            "price_change_percentage": "24h",
        },
        headers=_headers(),
    )
    if not isinstance(coins, list):
        # A 200 with a non-list body (e.g. a rate-limit/error object) means
        # something is wrong even though raise_for_status() didn't catch it.
        raise MarketDataError(f"CoinGecko returned an unexpected response shape: {coins!r}")

    result = []
    for coin in coins:
        # A well-formed list can still contain a malformed/edge-case item
        # (a delisted token, say) missing id/symbol/name — .get() everywhere
        # so one bad item can't turn into an unhandled KeyError.
        if not isinstance(coin, dict):
            continue
        symbol = coin.get("symbol")
        result.append(
            {
                "id": coin.get("id"),
                "symbol": symbol.upper() if isinstance(symbol, str) else symbol,
                "name": coin.get("name"),
                "image": coin.get("image"),
                "current_price": coin.get("current_price"),
                "market_cap": coin.get("market_cap"),
                "market_cap_rank": coin.get("market_cap_rank"),
                "total_volume": coin.get("total_volume"),
                "price_change_percentage_24h": coin.get("price_change_percentage_24h"),
            }
        )
    return result


def _coinpaprika_top(limit: int) -> list[dict[str, Any]]:
    tickers = _get_json(f"{COINPAPRIKA_BASE_URL}/tickers", "CoinPaprika", params={"limit": min(limit, 100)})
    if not isinstance(tickers, list):
        raise MarketDataError(f"CoinPaprika returned an unexpected response shape: {tickers!r}")
    result = []
    for ticker in tickers:
        if not isinstance(ticker, dict):
            continue
        usd = (ticker.get("quotes") or {}).get("USD") or {}
        symbol = ticker.get("symbol")
        result.append(
            {
                "id": ticker.get("id"),
                "symbol": symbol.upper() if isinstance(symbol, str) else symbol,
                "name": ticker.get("name"),
                # CoinPaprika's logo URLs refuse hotlinking; the page shows
                # an initial instead.
                "image": None,
                "current_price": usd.get("price"),
                "market_cap": usd.get("market_cap"),
                "market_cap_rank": ticker.get("rank"),
                "total_volume": usd.get("volume_24h"),
                "price_change_percentage_24h": usd.get("percent_change_24h"),
            }
        )
    return result


_TOP_TOKEN_SOURCES: list[tuple[str, Callable[[int], list[dict[str, Any]]]]] = [
    ("CoinGecko", _coingecko_top),
    ("CoinPaprika", _coinpaprika_top),
]


def get_top_tokens_with_source(limit: int = 20) -> tuple[str, list[dict[str, Any]]]:
    """Top tokens by market cap from the first source that answers, and
    that source's name."""

    def fetch() -> tuple[str, list[dict[str, Any]]]:
        errors = []
        for name, source in _TOP_TOKEN_SOURCES:
            try:
                return name, source(limit)
            except MarketDataError as exc:
                current_app.logger.warning("Market data source failed, trying the next: %s", exc)
                errors.append(str(exc))
        raise MarketDataError("No market data source answered: " + "; ".join(errors))

    return _cached(("top", limit), _CACHE_TTL_SECONDS, fetch)


def get_top_tokens(limit: int = 20) -> list[dict[str, Any]]:
    return get_top_tokens_with_source(limit)[1]


# --- DexScreener: any token by address, and what's trending ---------------

# An EVM address, or a Solana base58 mint (32–44 chars).
_ADDRESS = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")


def _pair(pair: dict[str, Any]) -> dict[str, Any]:
    base = pair.get("baseToken") or {}
    quote = pair.get("quoteToken") or {}
    info = pair.get("info") or {}
    price_usd = pair.get("priceUsd")
    return {
        "chain": pair.get("chainId"),
        "dex": pair.get("dexId"),
        "pair_address": pair.get("pairAddress"),
        "url": pair.get("url"),
        "base_token": {"address": base.get("address"), "name": base.get("name"), "symbol": base.get("symbol")},
        "quote_symbol": quote.get("symbol"),
        "price_usd": float(price_usd) if price_usd not in (None, "") else None,
        "price_change_24h": (pair.get("priceChange") or {}).get("h24"),
        "volume_24h": (pair.get("volume") or {}).get("h24"),
        "liquidity_usd": (pair.get("liquidity") or {}).get("usd"),
        "fdv": pair.get("fdv"),
        "market_cap": pair.get("marketCap"),
        "created_at": pair.get("pairCreatedAt"),
        "image": info.get("imageUrl"),
    }


def lookup_token(address: str) -> list[dict[str, Any]]:
    """A token's trading pairs on every chain DexScreener indexes, most
    liquid first. Empty: no pairs — not listed on any DEX it tracks."""
    address = address.strip()
    if not _ADDRESS.match(address):
        raise ValueError("Enter a token contract address (0x…) or a Solana mint address")

    def fetch() -> list[dict[str, Any]]:
        body = _get_json(f"{DEXSCREENER_BASE_URL}/latest/dex/tokens/{address}", "DexScreener")
        pairs = body.get("pairs") if isinstance(body, dict) else None
        pairs = [_pair(p) for p in (pairs or []) if isinstance(p, dict)]
        pairs.sort(key=lambda p: p["liquidity_usd"] or 0, reverse=True)
        return pairs[:20]

    return _cached(("lookup", address.lower() if address.startswith("0x") else address), _CACHE_TTL_SECONDS, fetch)


def trending_tokens(limit: int = 12) -> list[dict[str, Any]]:
    """Tokens with the most active DexScreener promotion ("boosts") right
    now, with their most liquid pair's market data. Promotion, not a
    recommendation — the page labels it that way."""

    def fetch() -> list[dict[str, Any]]:
        boosts = _get_json(f"{DEXSCREENER_BASE_URL}/token-boosts/top/v1", "DexScreener")
        if not isinstance(boosts, list):
            raise MarketDataError(f"DexScreener returned an unexpected response shape: {str(boosts)[:200]}")
        picked = [b for b in boosts if isinstance(b, dict) and b.get("chainId") and b.get("tokenAddress")][:limit]
        by_chain: dict[str, list[str]] = {}
        for boost in picked:
            by_chain.setdefault(boost["chainId"], []).append(boost["tokenAddress"])
        best: dict[tuple[str, str], dict[str, Any]] = {}
        for chain, addresses in by_chain.items():
            # Up to 30 addresses per call.
            pairs = _get_json(f"{DEXSCREENER_BASE_URL}/tokens/v1/{chain}/{','.join(addresses[:30])}", "DexScreener")
            for raw in pairs if isinstance(pairs, list) else []:
                if not isinstance(raw, dict):
                    continue
                pair = _pair(raw)
                key = (chain, (pair["base_token"]["address"] or "").lower())
                if key not in best or (pair["liquidity_usd"] or 0) > (best[key]["liquidity_usd"] or 0):
                    best[key] = pair
        result = []
        for boost in picked:
            pair = best.get((boost["chainId"], boost["tokenAddress"].lower()))
            if pair is None:
                continue
            result.append({**pair, "image": pair["image"] or boost.get("icon"), "boosts": boost.get("totalAmount")})
        return result

    return _cached(("trending", limit), 120, fetch)
