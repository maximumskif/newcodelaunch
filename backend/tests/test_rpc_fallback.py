import pytest
import requests

from app.services import blockchain


class _Session:
    """Stands in for web3's HTTP session manager: answers per endpoint."""

    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    def make_post_request(self, uri, data, **kwargs):
        self.calls.append(uri)
        outcome = self.behaviour[uri]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


OK = b'{"jsonrpc":"2.0","id":0,"result":"0xaa36a7"}'


@pytest.fixture(autouse=True)
def fresh_preferences():
    blockchain._preferred.clear()
    yield
    blockchain._preferred.clear()


def _provider(urls, behaviour):
    provider = blockchain.FallbackHTTPProvider(urls)
    provider._request_session_manager = _Session(behaviour)
    return provider


def test_moves_past_unreachable_blocked_and_erroring_endpoints():
    urls = ["https://down", "https://blocked", "https://limited", "https://good"]
    limited = requests.HTTPError("429 Too Many Requests")
    provider = _provider(urls, {
        "https://down": requests.ConnectionError("refused"),
        "https://blocked": requests.exceptions.SSLError("wrong version number"),
        "https://limited": limited,
        "https://good": OK,
    })

    assert provider.make_request("eth_chainId", [])["result"] == "0xaa36a7"
    assert provider._request_session_manager.calls == urls


def test_later_requests_start_from_the_endpoint_that_worked():
    urls = ["https://down", "https://good"]
    behaviour = {"https://down": requests.Timeout("slow"), "https://good": OK}
    _provider(urls, behaviour).make_request("eth_chainId", [])

    second = _provider(urls, behaviour)  # a new Web3 for the next request
    second.make_request("eth_blockNumber", [])
    assert second._request_session_manager.calls == ["https://good"]
    assert second.endpoint_uri == "https://good"


def test_all_failing_raises_the_last_error():
    provider = _provider(["https://a", "https://b"], {
        "https://a": requests.ConnectionError("a"),
        "https://b": requests.ConnectionError("b"),
    })
    with pytest.raises(requests.ConnectionError, match="b"):
        provider.make_request("eth_chainId", [])


def test_config_puts_an_override_first_then_the_public_fallbacks(monkeypatch):
    from app.config import _rpc_urls_env

    monkeypatch.setenv("X_RPC_URL", "https://mine, https://backup")
    assert _rpc_urls_env("X_RPC_URL", ["https://public", "https://backup"]) == ["https://mine", "https://backup", "https://public"]
    monkeypatch.setenv("X_RPC_URL", "")
    assert _rpc_urls_env("X_RPC_URL", ["https://public"]) == ["https://public"]
    monkeypatch.setenv("X_RPC_URL", "http://127.0.0.1:8545")
    assert _rpc_urls_env("X_RPC_URL", ["https://public"]) == ["http://127.0.0.1:8545"]
