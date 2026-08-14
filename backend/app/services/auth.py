import secrets

import base58
from eth_account import Account
from eth_account.messages import encode_defunct
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from ..models.user import Chain


class SignatureVerificationError(ValueError):
    """Raised when a signature can't be checked at all (bad encoding, wrong chain, etc)."""


def generate_nonce() -> str:
    return secrets.token_hex(16)


def build_sign_message(nonce: str) -> str:
    return (
        "Sign this message to authenticate with NoCode Launchpad.\n\n"
        "This request will not trigger a blockchain transaction or cost any gas.\n\n"
        f"Nonce: {nonce}"
    )


def normalize_address(wallet_address: str, chain: str) -> str:
    # EVM addresses are case-insensitive (checksum casing is just a checksum, not identity).
    # Solana addresses are base58 and case-sensitive — never lowercase them.
    if chain == Chain.EVM:
        return wallet_address.lower()
    return wallet_address


def verify_signature(chain: str, wallet_address: str, message: str, signature: str) -> bool:
    """Returns True if `signature` over `message` was produced by `wallet_address` on `chain`."""
    if chain == Chain.EVM:
        try:
            recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
        except Exception as exc:
            raise SignatureVerificationError(str(exc)) from exc
        return recovered.lower() == wallet_address.lower()

    if chain == Chain.SOLANA:
        try:
            public_key_bytes = base58.b58decode(wallet_address)
            signature_bytes = base58.b58decode(signature)
        except ValueError as exc:
            raise SignatureVerificationError(f"Invalid base58 encoding: {exc}") from exc
        try:
            VerifyKey(public_key_bytes).verify(message.encode("utf-8"), signature_bytes)
            return True
        except BadSignatureError:
            return False
        except Exception as exc:
            raise SignatureVerificationError(str(exc)) from exc

    raise SignatureVerificationError(f"Unsupported chain: {chain}")
