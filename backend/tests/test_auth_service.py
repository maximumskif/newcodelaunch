import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from app.services import auth


def test_normalize_address_lowercases_evm_but_not_solana():
    assert auth.normalize_address("0xABCDEF", "evm") == "0xabcdef"
    assert auth.normalize_address("SoLaNaAddrCaseSensitive", "solana") == "SoLaNaAddrCaseSensitive"


def test_verify_signature_evm_accepts_the_real_signer():
    account = Account.create()
    message = auth.build_sign_message(auth.generate_nonce())
    signed = account.sign_message(encode_defunct(text=message))
    assert auth.verify_signature("evm", account.address, message, signed.signature.hex()) is True


def test_verify_signature_evm_rejects_a_different_signer():
    signer = Account.create()
    impersonated = Account.create()
    message = auth.build_sign_message(auth.generate_nonce())
    signed = signer.sign_message(encode_defunct(text=message))
    assert auth.verify_signature("evm", impersonated.address, message, signed.signature.hex()) is False


def test_verify_signature_unsupported_chain_raises():
    with pytest.raises(auth.SignatureVerificationError):
        auth.verify_signature("bitcoin", "some-address", "some-message", "some-signature")


def test_generate_nonce_is_unique_per_call():
    assert auth.generate_nonce() != auth.generate_nonce()
