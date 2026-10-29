"""The Telegram launch bot.

"/launch Moon Cat MCAT" (optionally "... on base") answers with a link to
the bonding-curve launch page with the name, ticker and network filled in.
The person opens it, connects their own wallet and signs the launch there,
so the bot never holds a key or pays gas: it only writes links. That keeps
it the same launch as the website's, with the same fee and the same 0.3%
creator share going to whoever signs.

Updates arrive either at the webhook (blueprints/telegram.py, production)
or through `flask telegram-poll` (local, where Telegram can't reach us).
Both hand each update to handle_update(), which returns the sendMessage
call to make, or None for anything the bot doesn't answer.
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

import requests
from flask import current_app

from ..extensions import db
from ..models.deployment import ContractDeployment
from . import blockchain, liquidity

API_URL = "https://api.telegram.org/bot{token}/{method}"
REQUEST_TIMEOUT_SECONDS = 10
POLL_TIMEOUT_SECONDS = 30
MAX_NAME_LENGTH = 64
# Short, because a launch is posted while its creator waits for it to be
# recorded; one that times out is posted later by `flask announce-launches`.
ANNOUNCE_TIMEOUT_SECONDS = 5
# How far back `flask announce-launches` looks for launches still to post.
ANNOUNCE_WINDOW = timedelta(days=1)
_TICKER = re.compile(r"^\$?([A-Za-z0-9]{1,16})$")
# "/launch", or "/launch@SomeBot" as Telegram writes it in groups.
_COMMAND = re.compile(r"^/([A-Za-z_]+)(?:@\S+)?(?:\s+(.*))?$", re.S)
# What people call each network, beyond its id.
_ALIASES = {"eth": "ethereum", "mainnet": "ethereum", "bnb": "bsc", "bnb testnet": "bsc_testnet", "matic": "polygon"}

HELP = (
    "<b>Launch a coin on a bonding curve</b>\n\n"
    "<code>/launch Moon Cat MCAT</code>\n"
    "<code>/launch Moon Cat MCAT on base</code>\n\n"
    "The name comes first and the ticker last. I'll reply with a link: open it, connect your "
    "wallet and sign, and the coin is live. People can buy it right away. When the curve "
    "reaches its target it moves into a DEX pool by itself, with the liquidity burned.\n\n"
    "Every trade pays 1%: 0.3% to you as the creator and 0.7% to the platform.\n\n"
    "Networks: {networks}"
)


class LaunchRequestError(ValueError):
    """A /launch message that can't become a link; the message says why."""


class TelegramNotConfiguredError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(current_app.config.get("TELEGRAM_BOT_TOKEN"))


_usernames: dict[str, str] = {}


def bot_username() -> str | None:
    """The bot's @username (asked of Telegram once per token), or None if
    Telegram doesn't answer."""
    token = current_app.config.get("TELEGRAM_BOT_TOKEN")
    if token and token not in _usernames:
        try:
            _usernames[token] = call("getMe")["username"]
        except Exception:
            return None
    return _usernames.get(token)


def _curve_networks() -> list[str]:
    """The networks a curve can launch on: the ones with a DEX to graduate to,
    in the site's order."""
    available = liquidity.dexes()
    return [network for network in blockchain.EVM_NETWORKS if network in available]


def _network_named(text: str) -> str | None:
    key = re.sub(r"[\s_-]+", " ", text.strip().lower())
    key = _ALIASES.get(key, key).replace(" ", "_")
    return key if key in _curve_networks() else None


def parse_launch(args: str) -> tuple[str, str, str]:
    """Reads the words after /launch as (name, ticker, network)."""
    words = args.split()
    network = current_app.config["TELEGRAM_LAUNCH_NETWORK"]
    # "... on base", "... on base sepolia": the last "on" ends the name and
    # ticker, but only when a network follows it, so "Hold On HODL" is a name.
    ons = [i for i, w in enumerate(words) if w.lower() == "on"]
    if ons and (named := _network_named(" ".join(words[ons[-1] + 1 :]))):
        network, words = named, words[: ons[-1]]
    if len(words) < 2:
        raise LaunchRequestError("Send the name and then the ticker, like <code>/launch Moon Cat MCAT</code>.")
    ticker = _TICKER.match(words[-1])
    if ticker is None:
        raise LaunchRequestError("The ticker is the last word: up to 16 letters and numbers, like MCAT.")
    name = " ".join(words[:-1])
    if len(name) > MAX_NAME_LENGTH:
        raise LaunchRequestError(f"Keep the name to {MAX_NAME_LENGTH} characters.")
    if network not in _curve_networks():
        raise LaunchRequestError(f"Curves can't launch on {html.escape(network)} here.")
    return name, ticker.group(1).upper(), network


def launch_link(name: str, symbol: str, network: str) -> str:
    query = urlencode({"name": name, "symbol": symbol, "network": network, "ref": "telegram"})
    return f"{current_app.config['PUBLIC_APP_URL']}/tokens/curve?{query}"


def _reply(chat_id: int | str, text: str, button: tuple[str, str] | None = None) -> dict[str, Any]:
    reply: dict[str, Any] = {
        "method": "sendMessage",
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
    }
    # Telegram refuses a button whose URL isn't public https (localhost, a
    # LAN address), failing the whole message, so locally the link in the
    # text is all there is.
    if button and button[1].startswith("https://"):
        reply["reply_markup"] = {"inline_keyboard": [[{"text": button[0], "url": button[1]}]]}
    return reply


def handle_update(update: dict[str, Any]) -> dict[str, Any] | None:
    """The sendMessage call that answers this update, or None."""
    message = update.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("text"), str):
        return None
    chat_id = (message.get("chat") or {}).get("id")
    command = _COMMAND.match(message["text"].strip())
    if chat_id is None or command is None:
        return None
    name, args = command.group(1).lower(), (command.group(2) or "").strip()

    if name in ("start", "help"):
        return _reply(chat_id, HELP.format(networks=", ".join(_curve_networks())))
    if name != "launch":
        return None
    if not args:
        return _reply(chat_id, "Send the name and then the ticker, like <code>/launch Moon Cat MCAT</code>.")
    try:
        token_name, symbol, network = parse_launch(args)
    except LaunchRequestError as exc:
        return _reply(chat_id, str(exc))
    link = launch_link(token_name, symbol, network)
    label = blockchain.EVM_NETWORKS[network]["name"]
    text = (
        f"<b>{html.escape(token_name)}</b> (${symbol}) on {html.escape(label)}\n\n"
        "Open the link, connect your wallet and sign to launch it. You pay the gas, "
        "and you earn 0.3% of every trade.\n\n"
        f"{html.escape(link)}"
    )
    return _reply(chat_id, text, ("Launch it", link))


def call(method: str, payload: dict[str, Any] | None = None, timeout: float = REQUEST_TIMEOUT_SECONDS) -> Any:
    """One Bot API call; returns its result or raises with Telegram's reason."""
    token = current_app.config.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise TelegramNotConfiguredError("TELEGRAM_BOT_TOKEN is not set")
    response = requests.post(API_URL.format(token=token, method=method), json=payload or {}, timeout=timeout)
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {body.get('description', response.status_code)}")
    return body["result"]


def send(reply: dict[str, Any]) -> None:
    payload = dict(reply)
    call(payload.pop("method"), payload)


def poll_once(offset: int | None) -> int | None:
    """Fetches the next updates (waiting up to POLL_TIMEOUT_SECONDS), answers
    each one, and returns the offset to ask for next."""
    payload: dict[str, Any] = {"timeout": POLL_TIMEOUT_SECONDS, "allowed_updates": ["message"]}
    if offset is not None:
        payload["offset"] = offset
    for update in call("getUpdates", payload, timeout=POLL_TIMEOUT_SECONDS + REQUEST_TIMEOUT_SECONDS):
        offset = update["update_id"] + 1
        reply = handle_update(update)
        if reply is not None:
            try:
                send(reply)
            except Exception:  # one chat that can't be answered mustn't stop the bot
                current_app.logger.exception("telegram reply failed")
    return offset


def _should_announce(deployment: ContractDeployment) -> bool:
    config = current_app.config
    if deployment.template_id != "curve_token" or not config.get("TELEGRAM_ANNOUNCE_CHAT") or not is_configured():
        return False
    network = blockchain.EVM_NETWORKS.get(deployment.network)
    return network is not None and (not network["is_testnet"] or config.get("TELEGRAM_ANNOUNCE_TESTNETS"))


def announcement(deployment: ContractDeployment) -> dict[str, Any]:
    """The channel post for a new curve launch."""
    params = deployment.parameters or {}
    network = blockchain.EVM_NETWORKS[deployment.network]
    symbol = str(params.get("TOKEN_SYMBOL") or "")
    page = f"{current_app.config['PUBLIC_APP_URL']}/token/{deployment.network}/{deployment.contract_address}"
    target = Decimal(int(params.get("GRADUATION_TARGET") or 0)) / Decimal(10**18)
    dex = liquidity.dexes().get(deployment.network, {}).get("name", "a DEX")
    text = (
        f"New launch on {html.escape(network['name'])}\n\n"
        f"<b>{html.escape(str(params.get('TOKEN_NAME') or ''))}</b> (${html.escape(symbol)})\n"
        f"Buy it now on its bonding curve. At {target.normalize():f} {network['native_token']} raised it moves "
        f"to {html.escape(dex)}, with the liquidity burned.\n\n"
        f"<code>{html.escape(deployment.contract_address)}</code>\n"
        f"{html.escape(page)}"
    )
    # Every post is also an invitation to launch one.
    username = bot_username()
    if username:
        text += f"\n\nLaunch your own: send /launch to @{username}"
    return _reply(current_app.config["TELEGRAM_ANNOUNCE_CHAT"], text, (f"Buy ${symbol}", page))


def announce_launch(deployment: ContractDeployment, timeout: float = ANNOUNCE_TIMEOUT_SECONDS) -> bool:
    """Posts a curve launch to the launch channel, once. Returns whether this
    call posted it. Never raises: a launch is recorded whether or not
    Telegram answers, and one that wasn't posted is tried again later."""
    if not _should_announce(deployment):
        return False
    # The claim: only one caller (the launch's own request, or the retry
    # command running at the same moment) gets to set it.
    claimed = (
        ContractDeployment.query.filter_by(id=deployment.id, announced_at=None)
        .update({"announced_at": datetime.now(timezone.utc)}, synchronize_session=False)
    )
    db.session.commit()
    if not claimed:
        return False
    try:
        payload = announcement(deployment)
        call(payload.pop("method"), payload, timeout=timeout)
        return True
    except Exception:
        current_app.logger.exception("posting launch %s to Telegram failed", deployment.id)
        ContractDeployment.query.filter_by(id=deployment.id).update({"announced_at": None}, synchronize_session=False)
        db.session.commit()
        return False


def announce_pending() -> int:
    """Posts the recent curve launches that haven't been posted yet (Telegram
    was down, or the post timed out). Returns how many were posted."""
    if not current_app.config.get("TELEGRAM_ANNOUNCE_CHAT") or not is_configured():
        return 0
    since = datetime.now(timezone.utc) - ANNOUNCE_WINDOW
    pending = (
        ContractDeployment.query.filter(
            ContractDeployment.template_id == "curve_token",
            ContractDeployment.announced_at.is_(None),
            ContractDeployment.created_at >= since,
        )
        .order_by(ContractDeployment.created_at)
        .all()
    )
    return sum(announce_launch(deployment, timeout=REQUEST_TIMEOUT_SECONDS) for deployment in pending)
