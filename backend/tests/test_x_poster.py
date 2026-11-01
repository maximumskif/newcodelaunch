from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services import telegram_bot, x_poster
from tests.test_telegram_bot import CURVE, _curve_launch


@pytest.fixture
def x(app, monkeypatch):
    app.config.update(
        X_API_KEY="key",
        X_API_SECRET="key-secret",
        X_ACCESS_TOKEN="token",
        X_ACCESS_TOKEN_SECRET="token-secret",
        X_ANNOUNCE_TESTNETS=False,
        X_DAILY_POST_LIMIT=15,
        PUBLIC_APP_URL="https://launch.example",
        TELEGRAM_ANNOUNCE_CHAT="",
    )
    return app


def _x(monkeypatch, status=201, body=None):
    """Stands in for X's API; returns the list of posts sent."""
    posts = []

    def post(url, json, headers, timeout):
        posts.append(json["text"])
        assert url == x_poster.POST_URL and headers["Authorization"].startswith("OAuth ")
        response = MagicMock(status_code=status)
        response.json.return_value = body if body is not None else {"data": {"id": str(len(posts)), "text": json["text"]}}
        return response

    monkeypatch.setattr(x_poster.requests, "post", post)
    return posts


def test_the_signature_matches_xs_documented_example(app):
    # The worked example in X's "Creating a signature" docs.
    app.config.update(
        X_API_KEY="xvz1evFS4wEEPTGEFPHBog",
        X_API_SECRET="kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        X_ACCESS_TOKEN="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        X_ACCESS_TOKEN_SECRET="LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    )
    header = x_poster.oauth_header(
        "POST",
        "https://api.twitter.com/1.1/statuses/update.json",
        {"include_entities": "true", "status": "Hello Ladies + Gentlemen, a signed OAuth request!"},
        nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        timestamp="1318622958",
    )
    assert 'oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"' in header
    # The body's parameters are signed, not sent in the header.
    assert "status" not in header


def test_a_curve_launch_is_posted_once(x, monkeypatch):
    posts = _x(monkeypatch)
    launch = _curve_launch()
    assert x_poster.announce_launch(launch) is True
    (text,) = posts
    assert text.startswith("New launch on Base: Moon <Cat> $MCAT\n\n")
    assert "At 4.5 ETH raised it moves to Uniswap V2, with the liquidity burned." in text
    assert f"CA: {CURVE}\nhttps://launch.example/token/base/{CURVE}" in text
    assert text.endswith("Launch your own: https://launch.example/tokens/curve")
    assert x_poster.weighted_length(text) <= 280
    assert launch.x_announced_at is not None
    assert x_poster.announce_launch(launch) is False
    assert x_poster.announce_pending() == 0
    assert len(posts) == 1


def test_a_long_name_drops_the_invitation_then_is_shortened(x):
    launch = _curve_launch()
    launch.parameters = {**launch.parameters, "TOKEN_NAME": "Moon " * 12}
    text = x_poster.announcement(launch)
    assert "Launch your own" not in text and x_poster.weighted_length(text) <= 280
    launch.parameters = {**launch.parameters, "TOKEN_NAME": "月" * 64}
    text = x_poster.announcement(launch)
    assert "月…" in text and x_poster.weighted_length(text) <= 280
    assert f"https://launch.example/token/base/{CURVE}" in text


def test_links_count_as_23_and_wide_characters_as_2(x):
    assert x_poster.weighted_length("see https://example.com/a/very/long/path/indeed") == 4 + 23
    assert x_poster.weighted_length("月 é —") == 2 + 1 + 1 + 1 + 1


def test_a_refused_post_is_tried_again_later(x, monkeypatch):
    _x(monkeypatch, status=429, body={"title": "Too Many Requests", "detail": "Too Many Requests"})
    launch = _curve_launch()
    assert x_poster.announce_launch(launch) is False
    assert launch.x_announced_at is None
    posts = _x(monkeypatch)
    assert x_poster.announce_pending() == 1 and len(posts) == 1


def test_an_error_says_what_x_answered(x, monkeypatch):
    _x(monkeypatch, status=403, body={"title": "Forbidden", "detail": "You are not permitted to perform this action."})
    with pytest.raises(x_poster.XError, match="403: You are not permitted"):
        x_poster.post("hi")


def test_the_daily_limit_holds_the_rest_for_later(x, monkeypatch):
    x.config["X_DAILY_POST_LIMIT"] = 2
    posts = _x(monkeypatch)
    launches = [_curve_launch() for _ in range(3)]
    assert [x_poster.announce_launch(launch) for launch in launches] == [True, True, False]
    assert launches[2].x_announced_at is None
    assert x_poster.announce_pending() == 0
    # A day later the first two no longer count, and the third goes out.
    for launch in launches[:2]:
        launch.x_announced_at = datetime.now(timezone.utc) - timedelta(days=1, minutes=1)
        launch.created_at = launch.x_announced_at
    from app.extensions import db

    db.session.commit()
    assert x_poster.announce_pending() == 1 and len(posts) == 3


@pytest.mark.parametrize(
    ("network", "template_id", "testnets", "posted"),
    [
        ("base", "erc20_basic", False, False),
        ("base_sepolia", "curve_token", False, False),
        ("base_sepolia", "curve_token", True, True),
    ],
)
def test_what_gets_posted(x, monkeypatch, network, template_id, testnets, posted):
    x.config["X_ANNOUNCE_TESTNETS"] = testnets
    posts = _x(monkeypatch)
    assert x_poster.announce_launch(_curve_launch(network=network, template_id=template_id)) is posted
    assert len(posts) == int(posted)


def test_nothing_is_posted_without_all_four_keys(x, monkeypatch):
    x.config["X_ACCESS_TOKEN_SECRET"] = ""
    posts = _x(monkeypatch)
    assert x_poster.announce_launch(_curve_launch()) is False
    assert x_poster.announce_pending() == 0 and posts == []


def test_telegram_down_doesnt_hold_back_x(x, monkeypatch):
    x.config.update(TELEGRAM_BOT_TOKEN="123:abc", TELEGRAM_ANNOUNCE_CHAT="@launches")
    monkeypatch.setattr(telegram_bot, "_usernames", {"123:abc": "NovaLaunchBot"})
    monkeypatch.setattr(telegram_bot, "call", MagicMock(side_effect=RuntimeError("down")))
    posts = _x(monkeypatch)
    launch = _curve_launch()
    assert telegram_bot.announce_launch(launch) is False
    assert x_poster.announce_launch(launch) is True
    assert launch.announced_at is None and launch.x_announced_at is not None and len(posts) == 1


def test_the_retry_command_reports_both(x, monkeypatch):
    _curve_launch()
    _x(monkeypatch)
    result = x.test_cli_runner().invoke(args=["announce-launches"])
    assert result.exit_code == 0
    assert "Posted 0 launch(es) to Telegram." in result.output and "Posted 1 launch(es) to X." in result.output


def test_recording_a_launch_posts_it(x, client, monkeypatch):
    from flask_jwt_extended import create_access_token

    from app.services import contracts

    launch = _curve_launch()
    monkeypatch.setattr(contracts, "record_deployment", lambda **_: launch)
    posted = MagicMock(return_value=True)
    monkeypatch.setattr(x_poster, "announce_launch", posted)
    response = client.post(
        "/api/contracts/deployments",
        json={"template_id": "curve_token", "network": "base", "contract_address": CURVE, "transaction_hash": "0x1", "deployer_address": "0x2"},
        headers={"Authorization": f"Bearer {create_access_token(identity=launch.user_id)}"},
    )
    assert response.status_code == 201
    posted.assert_called_once_with(launch)


def test_whoami_names_the_account(x, monkeypatch):
    response = MagicMock(status_code=200)
    response.json.return_value = {"data": {"id": "1", "username": "NovaLaunches"}}
    get = MagicMock(return_value=response)
    monkeypatch.setattr(x_poster.requests, "get", get)
    result = x.test_cli_runner().invoke(args=["x-whoami"])
    assert result.exit_code == 0 and "@NovaLaunches" in result.output
    assert get.call_args.kwargs["headers"]["Authorization"].startswith("OAuth ")


def test_whoami_without_keys_says_what_to_set(app):
    app.config.update(X_API_KEY="")
    result = app.test_cli_runner().invoke(args=["x-whoami"])
    assert result.exit_code != 0 and "X_API_KEY" in result.output
