from datetime import datetime, timezone

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from app.services import auth


def test_normalize_address_lowercases_evm_but_not_solana():
    assert auth.normalize_address("0xABCDEF", "evm") == "0xabcdef"
    assert auth.normalize_address("SoLaNaAddrCaseSensitive", "solana") == "SoLaNaAddrCaseSensitive"


ISSUED_AT = datetime(2026, 10, 30, 12, 0, 5, 123456, tzinfo=timezone.utc)


def _message(wallet_address="0xab5801a7d398351b8be11c439e05c5b3259aec9b", chain="evm", nonce="a1b2c3d4e5f60718"):
    return auth.build_sign_message(nonce, wallet_address, chain, "https://newcodelaunch.example", ISSUED_AT, 300)


def test_sign_message_is_eip4361_with_the_sites_domain():
    assert _message() == (
        "newcodelaunch.example wants you to sign in with your Ethereum account:\n"
        "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B\n\n"
        "Sign in to NewCodeLaunch. This request will not trigger a blockchain transaction or cost any gas.\n\n"
        "URI: https://newcodelaunch.example\n"
        "Version: 1\n"
        "Chain ID: 1\n"
        "Nonce: a1b2c3d4e5f60718\n"
        "Issued At: 2026-10-30T12:00:05Z\n"
        "Expiration Time: 2026-10-30T12:05:05Z"
    )


def test_sign_message_for_solana_keeps_the_address_as_is():
    address = "SoLaNaAddrCaseSensitive1111111111111111111"
    message = _message(address, "solana")
    assert message.startswith(f"newcodelaunch.example wants you to sign in with your Solana account:\n{address}\n")
    assert "\nChain ID: mainnet\n" in message


def test_verify_signature_evm_accepts_the_real_signer():
    account = Account.create()
    message = _message(account.address)
    signed = account.sign_message(encode_defunct(text=message))
    assert auth.verify_signature("evm", account.address, message, signed.signature.hex()) is True


def test_verify_signature_evm_rejects_a_different_signer():
    signer = Account.create()
    impersonated = Account.create()
    message = _message(signer.address)
    signed = signer.sign_message(encode_defunct(text=message))
    assert auth.verify_signature("evm", impersonated.address, message, signed.signature.hex()) is False


def test_verify_signature_unsupported_chain_raises():
    with pytest.raises(auth.SignatureVerificationError):
        auth.verify_signature("bitcoin", "some-address", "some-message", "some-signature")


def test_generate_nonce_is_unique_per_call():
    assert auth.generate_nonce() != auth.generate_nonce()
