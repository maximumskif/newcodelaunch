"""Posts each new bonding-curve launch to the platform's X account.

Post-only, like the Telegram launch channel: the account never reads or
answers anything, which is what X's free API tier allows. Posting uses the
account's own keys (OAuth 1.0a user context: the app's key and secret plus
the account's access token and secret, all four from the X developer
portal, with the app's permissions set to "Read and write").

A launch is posted as it's recorded (contracts route), with a short
timeout; `flask announce-launches` posts the ones X didn't take then.
`x_announced_at` makes each launch go out once, apart from Telegram's
`announced_at`, so one service being down never holds back the other.
The free tier caps how often an account may post, so at most
X_DAILY_POST_LIMIT launches go out per 24 hours; the rest wait for the
retry, within its one-day window.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import quote

import requests
from flask import current_app

from ..extensions import db
from ..models.deployment import ContractDeployment
from . import blockchain, liquidity

POST_URL = "https://api.x.com/2/tweets"
ME_URL = "https://api.x.com/2/users/me"
REQUEST_TIMEOUT_SECONDS = 10
ANNOUNCE_TIMEOUT_SECONDS = 5
ANNOUNCE_WINDOW = timedelta(days=1)
MAX_POST_LENGTH = 280
# X counts every link as this many characters, whatever its length.
LINK_LENGTH = 23
_LINK = re.compile(r"https?://\S+")


class XError(RuntimeError):
    """X refused or failed a request; the message says why."""


def is_configured() -> bool:
    config = current_app.config
    return all(config.get(key) for key in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"))


def _encode(value: str) -> str:
    return quote(str(value), safe="~-._")


def oauth_header(
    method: str,
    url: str,
    params: dict[str, str] | None = None,
    *,
    nonce: str | None = None,
    timestamp: str | None = None,
) -> str:
    """The OAuth 1.0a Authorization header for one request. `params` are the
    query (or form) parameters; a JSON body isn't part of the signature."""
    config = current_app.config
    oauth = {
        "oauth_consumer_key": config["X_API_KEY"],
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": timestamp or str(int(time.time())),
        "oauth_token": config["X_ACCESS_TOKEN"],
        "oauth_version": "1.0",
    }
    signed = sorted((_encode(k), _encode(v)) for k, v in {**(params or {}), **oauth}.items())
    base = "&".join([method.upper(), _encode(url), _encode("&".join(f"{k}={v}" for k, v in signed))])
    key = f"{_encode(config['X_API_SECRET'])}&{_encode(config['X_ACCESS_TOKEN_SECRET'])}"
    oauth["oauth_signature"] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return "OAuth " + ", ".join(f'{_encode(k)}="{_encode(v)}"' for k, v in sorted(oauth.items()))


def _check(response: requests.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        detail = body.get("detail") or body.get("title") or (body.get("errors") or [{}])[0].get("message") or response.text[:200]
        raise XError(f"X answered {response.status_code}: {detail}")
    return body


def post(text: str, timeout: float = REQUEST_TIMEOUT_SECONDS) -> str:
    """Posts `text` and returns the new post's id."""
    response = requests.post(
        POST_URL,
        json={"text": text},
        headers={"Authorization": oauth_header("POST", POST_URL)},
        timeout=timeout,
    )
    return _check(response)["data"]["id"]


def whoami() -> str:
    """The @username the keys post as (checks they work, posting nothing)."""
    response = requests.get(ME_URL, headers={"Authorization": oauth_header("GET", ME_URL)}, timeout=REQUEST_TIMEOUT_SECONDS)
    return _check(response)["data"]["username"]


def weighted_length(text: str) -> int:
    """How long X counts `text`: each link as LINK_LENGTH, and characters
    outside Latin and the common punctuation (CJK, emoji) as 2."""
    text = _LINK.sub("x" * LINK_LENGTH, text)
    return sum(1 if ord(ch) < 0x1100 or 0x2000 <= ord(ch) <= 0x206F else 2 for ch in text)


def announcement(deployment: ContractDeployment) -> str:
    """The post for a new curve launch, within X's length limit."""
    params = deployment.parameters or {}
    network = blockchain.EVM_NETWORKS[deployment.network]
    app_url = current_app.config["PUBLIC_APP_URL"]
    symbol = str(params.get("TOKEN_SYMBOL") or "")
    page = f"{app_url}/token/{deployment.network}/{deployment.contract_address}"
    target = Decimal(int(params.get("GRADUATION_TARGET") or 0)) / Decimal(10**18)
    dex = liquidity.dexes().get(deployment.network, {}).get("name", "a DEX")
    name = " ".join(str(params.get("TOKEN_NAME") or "").split())

    def compose(name: str, invite: bool) -> str:
        text = (
            f"New launch on {network['name']}: {name} ${symbol}\n\n"
            f"Buy it on its bonding curve. At {target.normalize():f} {network['native_token']} raised it moves "
            f"to {dex}, with the liquidity burned.\n\n"
            f"CA: {deployment.contract_address}\n"
            f"{page}"
        )
        if invite:
            text += f"\n\nLaunch your own: {app_url}/tokens/curve"
        return text

    for invite in (True, False):
        text = compose(name, invite)
        if weighted_length(text) <= MAX_POST_LENGTH:
            return text
    # Still too long: only a very long (or wide-character) name does that.
    while name and weighted_length(compose(name + "…", False)) > MAX_POST_LENGTH:
        name = name[:-1]
    return compose(name.rstrip() + "…", False)


def _should_announce(deployment: ContractDeployment) -> bool:
    if deployment.template_id != "curve_token" or not is_configured():
        return False
    network = blockchain.EVM_NETWORKS.get(deployment.network)
    return network is not None and (not network["is_testnet"] or current_app.config.get("X_ANNOUNCE_TESTNETS"))


def _posted_today() -> int:
    since = datetime.now(timezone.utc) - timedelta(days=1)
    return ContractDeployment.query.filter(ContractDeployment.x_announced_at >= since).count()


def announce_launch(deployment: ContractDeployment, timeout: float = ANNOUNCE_TIMEOUT_SECONDS) -> bool:
    """Posts a curve launch to X, once. Returns whether this call posted it.
    Never raises: a launch is recorded whether or not X answers, and one
    that wasn't posted is tried again later."""
    if not _should_announce(deployment):
        return False
    if _posted_today() >= current_app.config["X_DAILY_POST_LIMIT"]:
        return False
    # The claim, as for Telegram: only one caller gets to set it.
    claimed = (
        ContractDeployment.query.filter_by(id=deployment.id, x_announced_at=None)
        .update({"x_announced_at": datetime.now(timezone.utc)}, synchronize_session=False)
    )
    db.session.commit()
    if not claimed:
        return False
    try:
        post(announcement(deployment), timeout=timeout)
        return True
    except Exception:
        current_app.logger.exception("posting launch %s to X failed", deployment.id)
        ContractDeployment.query.filter_by(id=deployment.id).update({"x_announced_at": None}, synchronize_session=False)
        db.session.commit()
        return False


def announce_pending() -> int:
    """Posts the recent curve launches X hasn't had yet, oldest first, up to
    the daily limit. Returns how many were posted."""
    if not is_configured():
        return 0
    since = datetime.now(timezone.utc) - ANNOUNCE_WINDOW
    pending = (
        ContractDeployment.query.filter(
            ContractDeployment.template_id == "curve_token",
            ContractDeployment.x_announced_at.is_(None),
            ContractDeployment.created_at >= since,
        )
        .order_by(ContractDeployment.created_at)
        .all()
    )
    return sum(announce_launch(deployment, timeout=REQUEST_TIMEOUT_SECONDS) for deployment in pending)
