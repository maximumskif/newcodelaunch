"""Shared helpers for safely reading fields out of a parsed JSON request body.

A JSON field a client sends can be any JSON type, not just the one a route
expects (e.g. {"name": 123} instead of {"name": "foo"}). Blindly calling
.strip()/.lower() on `data.get(key) or ""` crashes with an unhandled 500 the
moment the value is a truthy non-string (int, list, dict) — `123 or ""`
evaluates to `123`, so the `or ""` fallback never kicks in. str_field()
treats a non-string value the same as a missing one, turning that into a
clean validation error downstream instead of a crash.
"""

from __future__ import annotations

from typing import Any


def str_field(data: dict[str, Any], key: str) -> str:
    """Read `key` out of `data` as a stripped string, or "" if missing/not a string."""
    value = data.get(key)
    return value.strip() if isinstance(value, str) else ""
