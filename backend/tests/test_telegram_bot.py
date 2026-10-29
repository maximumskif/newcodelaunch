from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse

import pytest

from app.commands import telegram_set_webhook_command
from app.services import telegram_bot

SECRET = "hook-secret"


@pytest.fixture
def bot(app):
    app.config.update(
        TELEGRAM_BOT_TOKEN="123:abc",
        TELEGRAM_WEBHOOK_SECRET=SECRET,
        PUBLIC_APP_URL="https://launch.example",
        TELEGRAM_LAUNCH_NETWORK="base",
    )
    return app


def _update(text, chat_id=42):
    return {"update_id": 7, "message": {"message_id": 1, "chat": {"id": chat_id}, "text": text}}


def _link(reply):
    return reply["reply_markup"]["inline_keyboard"][0][0]["url"]


def _query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def test_launch_answers_with_a_prefilled_link(bot):
    reply = telegram_bot.handle_update(_update("/launch Moon Cat mcat"))
    assert reply["method"] == "sendMessage" and reply["chat_id"] == 42
    url = _link(reply)
    assert url.startswith("https://launch.example/tokens/curve?")
    assert _query(url) == {"name": "Moon Cat", "symbol": "MCAT", "network": "base", "ref": "telegram"}
    assert "<b>Moon Cat</b> ($MCAT) on Base" in reply["text"]
    assert "0.3% of every trade" in reply["text"]


@pytest.mark.parametrize(
    ("text", "network"),
    [
        ("/launch Moon Cat MCAT on sepolia", "sepolia"),
        ("/launch Moon Cat MCAT on Base Sepolia", "base_sepolia"),
        ("/launch Moon Cat MCAT on bnb", "bsc"),
        ("/launch@NovaLaunchBot Moon Cat $MCAT on eth", "ethereum"),
    ],
)
def test_launch_can_name_the_network(bot, text, network):
    query = _query(_link(telegram_bot.handle_update(_update(text))))
    assert (query["name"], query["symbol"], query["network"]) == ("Moon Cat", "MCAT", network)


def test_on_without_a_network_after_it_is_part_of_the_name(bot):
    query = _query(_link(telegram_bot.handle_update(_update("/launch Hold On HODL"))))
    assert (query["name"], query["symbol"], query["network"]) == ("Hold On", "HODL", "base")


def test_a_name_is_escaped_in_the_reply(bot):
    reply = telegram_bot.handle_update(_update("/launch <i>Cat</i> & Co CAT"))
    assert "<b>&lt;i&gt;Cat&lt;/i&gt; &amp; Co</b>" in reply["text"]


@pytest.mark.parametrize(
    ("text", "says"),
    [
        ("/launch", "the name and then the ticker"),
        ("/launch MCAT", "the name and then the ticker"),
        ("/launch Moon Cat MC-AT", "The ticker is the last word"),
        ("/launch Moon Cat ABCDEFGHIJKLMNOPQ", "The ticker is the last word"),
        ("/launch " + "x" * 65 + " CAT", "64 characters"),
    ],
)
def test_a_launch_it_cant_read_says_why_and_has_no_link(bot, text, says):
    reply = telegram_bot.handle_update(_update(text))
    assert says in reply["text"] and "reply_markup" not in reply


def test_the_default_network_needs_a_dex(bot):
    bot.config["TELEGRAM_LAUNCH_NETWORK"] = "polygon_amoy"
    reply = telegram_bot.handle_update(_update("/launch Moon Cat MCAT"))
    assert "can't launch on polygon_amoy" in reply["text"]


def test_help_lists_the_curve_networks(bot):
    reply = telegram_bot.handle_update(_update("/start"))
    assert "/launch Moon Cat MCAT" in reply["text"]
    assert "base_sepolia" in reply["text"] and "polygon_amoy" not in reply["text"]


@pytest.mark.parametrize(
    "update",
    [
        _update("gm"),
        _update("/price MCAT"),
        {"update_id": 1, "edited_message": {"chat": {"id": 1}, "text": "/launch A B"}},
        {"update_id": 1, "message": {"chat": {"id": 1}, "photo": []}},
    ],
)
def test_other_messages_get_no_answer(bot, update):
    assert telegram_bot.handle_update(update) is None


def test_a_local_link_is_text_only(bot):
    # Telegram refuses buttons that don't point at public https.
    bot.config["PUBLIC_APP_URL"] = "http://localhost:5173"
    reply = telegram_bot.handle_update(_update("/launch Moon Cat MCAT"))
    assert "reply_markup" not in reply
    assert "http://localhost:5173/tokens/curve?name=Moon+Cat&amp;symbol=MCAT" in reply["text"]


def test_the_webhook_answers_in_its_response(bot, client):
    response = client.post(
        "/api/telegram/webhook", json=_update("/launch Moon Cat MCAT"), headers={"X-Telegram-Bot-Api-Secret-Token": SECRET}
    )
    assert response.status_code == 200
    assert response.json["method"] == "sendMessage" and "symbol=MCAT" in _link(response.json)


def test_the_webhook_ignores_what_it_doesnt_answer(bot, client):
    response = client.post("/api/telegram/webhook", json=_update("gm"), headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})
    assert response.status_code == 200 and response.json == {}


def test_the_webhook_needs_the_secret(bot, client):
    assert client.post("/api/telegram/webhook", json=_update("/launch A B")).status_code == 403
    wrong = {"X-Telegram-Bot-Api-Secret-Token": "nope"}
    assert client.post("/api/telegram/webhook", json=_update("/launch A B"), headers=wrong).status_code == 403


def test_the_webhook_is_off_without_a_token(app, client):
    app.config.update(TELEGRAM_BOT_TOKEN="", TELEGRAM_WEBHOOK_SECRET=SECRET)
    headers = {"X-Telegram-Bot-Api-Secret-Token": SECRET}
    assert client.post("/api/telegram/webhook", json=_update("/launch A B"), headers=headers).status_code == 404


def test_an_update_that_breaks_the_bot_is_still_acknowledged(bot, client, monkeypatch):
    monkeypatch.setattr(telegram_bot, "handle_update", MagicMock(side_effect=RuntimeError("boom")))
    response = client.post("/api/telegram/webhook", json=_update("/launch A B"), headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})
    assert response.status_code == 200 and response.json == {}


def _telegram(monkeypatch, results):
    """Stands in for the Bot API: each call gets the next result."""
    calls = []

    def post(url, json, timeout):
        calls.append((url.rsplit("/", 1)[1], json))
        response = MagicMock()
        response.json.return_value = {"ok": True, "result": results.pop(0)}
        return response

    monkeypatch.setattr(telegram_bot.requests, "post", post)
    return calls


def test_polling_answers_each_update_and_moves_the_offset(bot, monkeypatch):
    updates = [{**_update("/launch Moon Cat MCAT", chat_id=5), "update_id": 10}, {**_update("gm"), "update_id": 11}]
    calls = _telegram(monkeypatch, [updates, {"message_id": 99}])
    assert telegram_bot.poll_once(None) == 12
    (method, payload), (sent, message) = calls
    assert method == "getUpdates" and "offset" not in payload
    assert sent == "sendMessage" and message["chat_id"] == 5 and "method" not in message
    _telegram(monkeypatch, [[]])
    assert telegram_bot.poll_once(12) == 12


def test_a_failed_bot_api_call_says_why(bot, monkeypatch):
    response = MagicMock()
    response.json.return_value = {"ok": False, "description": "Unauthorized"}
    monkeypatch.setattr(telegram_bot.requests, "post", MagicMock(return_value=response))
    with pytest.raises(RuntimeError, match="Unauthorized"):
        telegram_bot.call("getMe")


def test_set_webhook_points_telegram_at_this_api(bot, monkeypatch):
    bot.config["PUBLIC_API_URL"] = "https://api.launch.example"
    calls = _telegram(monkeypatch, [True, True])
    result = bot.test_cli_runner().invoke(telegram_set_webhook_command)
    assert result.exit_code == 0, result.output
    assert calls[0] == (
        "setWebhook",
        {"url": "https://api.launch.example/api/telegram/webhook", "secret_token": SECRET, "allowed_updates": ["message"]},
    )
    assert calls[1][0] == "setMyCommands"


def test_set_webhook_needs_a_public_https_api(bot):
    bot.config["PUBLIC_API_URL"] = "http://localhost:5000"
    result = bot.test_cli_runner().invoke(telegram_set_webhook_command)
    assert result.exit_code != 0 and "PUBLIC_API_URL" in result.output
