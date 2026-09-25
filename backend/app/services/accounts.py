"""
Accounts that span wallets: one account, any number of linked wallets, on
either chain family. Before this an account *was* one wallet on one chain —
sign in with MetaMask and the tokens you launched with Phantom weren't
there. See models/user.py's WalletIdentity.
"""

from __future__ import annotations

from typing import Any

from ..extensions import db
from ..models.candy_machine import CandyMachineDeployment
from ..models.deployment import ContractDeployment
from ..models.liquidity import LiquidityProvision
from ..models.nft import NFTCollection
from ..models.project import Project
from ..models.solana_token import SolanaPoolAction, SolanaTokenLaunch
from ..models.user import User, WalletIdentity

# Every table whose rows belong to an account. A merge moves all of them;
# a new user-owned table has to be added here too (see test_accounts.py,
# which checks this list against every users.id foreign key).
OWNED_MODELS = (Project, NFTCollection, ContractDeployment, CandyMachineDeployment, SolanaTokenLaunch, LiquidityProvision, SolanaPoolAction)


class AccountError(ValueError):
    pass


def _identity(wallet_address: str, chain: str) -> WalletIdentity | None:
    return WalletIdentity.query.filter_by(wallet_address=wallet_address, chain=chain).first()


def resolve_sign_in(wallet_address: str, chain: str) -> User:
    """The account a verified wallet signs in to — creating one on a
    wallet's first sign-in."""
    identity = _identity(wallet_address, chain)
    if identity is not None:
        return db.session.get(User, identity.user_id)
    user = User(wallet_address=wallet_address, chain=chain)
    db.session.add(user)
    db.session.flush()
    db.session.add(WalletIdentity(user_id=user.id, wallet_address=wallet_address, chain=chain))
    return user


def account_view(user: User, session_wallet: str, session_chain: str) -> dict[str, Any]:
    """The signed-in user as the frontend sees it: wallet_address/chain are
    the wallet this session signed in with (what the app checks the
    connected wallet against), `wallets` everything linked to the account."""
    wallets = WalletIdentity.query.filter_by(user_id=user.id).order_by(WalletIdentity.created_at).all()
    return {
        "id": user.id,
        "wallet_address": session_wallet,
        "chain": session_chain,
        "wallets": [wallet.to_dict() for wallet in wallets],
        "created_at": user.created_at.isoformat(),
    }


def link_wallet(user: User, wallet_address: str, chain: str) -> dict[str, int]:
    """Links a wallet whose ownership the caller has already proven (a
    verified signature) to `user`. If that wallet has its own account, the
    two accounts merge into `user`: every owned record and every linked
    wallet moves over, in one transaction — the caller has proven control
    of both (this session, plus the wallet's signature). Returns how many
    records moved per table (all zero when there was nothing to merge)."""
    identity = _identity(wallet_address, chain)
    moved = {model.__tablename__: 0 for model in OWNED_MODELS}
    if identity is not None and identity.user_id == user.id:
        return moved
    if identity is None:
        db.session.add(WalletIdentity(user_id=user.id, wallet_address=wallet_address, chain=chain))
        db.session.commit()
        return moved

    other_id = identity.user_id
    for model in OWNED_MODELS:
        moved[model.__tablename__] = model.query.filter_by(user_id=other_id).update(
            {"user_id": user.id}, synchronize_session=False
        )
    WalletIdentity.query.filter_by(user_id=other_id).update({"user_id": user.id}, synchronize_session=False)
    db.session.delete(db.session.get(User, other_id))
    db.session.commit()
    db.session.expire_all()
    return moved


def unlink_wallet(user: User, wallet_address: str, chain: str, session_wallet: str, session_chain: str) -> None:
    """Removes a wallet from the account. Its records stay with the account
    (they're the account's, not the wallet's). Refuses the wallet this
    session signed in with, and the account's last wallet."""
    identity = _identity(wallet_address, chain)
    if identity is None or identity.user_id != user.id:
        raise AccountError("That wallet isn't linked to this account")
    if (wallet_address, chain) == (session_wallet, session_chain):
        raise AccountError("You can't unlink the wallet you're signed in with — sign in with another linked wallet first")
    if WalletIdentity.query.filter_by(user_id=user.id).count() <= 1:
        raise AccountError("An account needs at least one wallet")
    db.session.delete(identity)
    db.session.commit()
