import secrets
from datetime import datetime, timedelta
from urllib.parse import urlsplit

import base58
from eth_account import Account
from eth_utils import to_checksum_address
from eth_account.messages import encode_defunct
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from ..models.user import Chain


class SignatureVerificationError(ValueError):
    """Raised when a signature can't be checked at all (bad encoding, wrong chain, etc)."""


def generate_nonce() -> str:
    return secrets.token_hex(16)


def build_sign_message(nonce: str, wallet_address: str, chain: str, app_url: str, issued_at: datetime, ttl_seconds: int) -> str:
    """A Sign-In with Ethereum (EIP-4361) message, or its Solana counterpart
    (Phantom's Sign In With Solana uses the same layout). Naming the site's
    domain is what defeats phishing: a look-alike site can fetch a real nonce
    for a victim's wallet, but MetaMask and Phantom warn when the domain in
    the message isn't the site asking for the signature."""
    if chain == Chain.EVM:
        # EIP-4361 requires the checksummed form, and wallets parse it.
        account_line = f"wants you to sign in with your Ethereum account:\n{to_checksum_address(wallet_address)}"
        chain_id = "1"
    else:
        account_line = f"wants you to sign in with your Solana account:\n{wallet_address}"
        chain_id = "mainnet"
    return (
        f"{urlsplit(app_url).netloc} {account_line}\n\n"
        "Sign in to NewCodeLaunch. This request will not trigger a blockchain transaction or cost any gas.\n\n"
        f"URI: {app_url}\n"
        "Version: 1\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {_iso(issued_at)}\n"
        f"Expiration Time: {_iso(issued_at + timedelta(seconds=ttl_seconds))}"
    )


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


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
