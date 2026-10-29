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
from typing import Any
from urllib.parse import urlencode

import requests
from flask import current_app

from . import blockchain, liquidity

API_URL = "https://api.telegram.org/bot{token}/{method}"
REQUEST_TIMEOUT_SECONDS = 10
POLL_TIMEOUT_SECONDS = 30
MAX_NAME_LENGTH = 64
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


def _reply(chat_id: int, text: str, button: tuple[str, str] | None = None) -> dict[str, Any]:
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
