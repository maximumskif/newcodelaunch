"""
IPFS uploads via Pinata.

Ported from the real parts of the old root-level ipfs_integration.py, which
supported Infura, Pinata, and a local node. Infura's public IPFS pinning
service was shut down years ago, so that branch (and the 'local' node branch,
which nobody in this project runs) are dropped — Pinata is the only supported
provider now.

Two Pinata upload APIs, both supported:
- the v3 Files API (uploads.pinata.cloud/v3/files, JWT only) — what keys
  created in Pinata's dashboard today are scoped for. Found 2026-09-29 with a
  real new key: it authenticated, but every classic pinning call failed with
  NO_SCOPES_FOUND, so publishing didn't work at all with a fresh account;
- the classic pinning API (api.pinata.cloud/pinning/*), for older keys or
  the legacy api-key + secret header pair.
PINATA_API picks one; "auto" (the default) tries v3 when there's a JWT and
falls back to classic on a 401/403, remembering which worked for that key.
Both produce the same CIDs for the same bytes, so nothing downstream cares.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import requests
from flask import current_app

# Overridable so the e2e suite (frontend/e2e/) can point this at a tiny local
# stub instead of a real Pinata account — real chain, real signing, real
# backend logic; only the third-party pinning call itself is faked, since
# there's no local-open-source equivalent of "pin something to global IPFS"
# the way anvil/solana-test-validator are for a real chain. See
# frontend/e2e/README.md.
#
# `or`, not os.environ.get's default argument: backend/.env.example ships
# both of these as blank lines ("leave unset for normal use"), and
# python-dotenv loads a blank line as "", not unset — so copying that file
# verbatim, as README's setup says to, left both URLs empty and every pin
# request went to "/pinning/..." with no host (found 2026-09-24 by loading
# .env.example and printing these; the e2e suite always sets both, which is
# why it never showed). Same blank-means-default rule as config.py's
# _rpc_url_env.
def _url_from_env(name: str, default: str) -> str:
    return os.environ.get(name, "").strip() or default


PINATA_BASE_URL = _url_from_env("PINATA_BASE_URL", "https://api.pinata.cloud")
# Also overridable, same reason: get_item_metadata() (nft_collections.py)
# fetches a published item's real pinned JSON back from this URL — the e2e
# stub serves what it was actually given at pin time, so this needs its own
# seam distinct from PINATA_BASE_URL (a real Pinata deployment's API and
# gateway are already different hosts).
PINATA_GATEWAY = _url_from_env("PINATA_GATEWAY_URL", "https://gateway.pinata.cloud/ipfs/")
PINATA_UPLOADS_URL = _url_from_env("PINATA_UPLOADS_URL", "https://uploads.pinata.cloud")

# Which API worked for a given credential in "auto" mode, so the fallback
# isn't re-tried on every upload. Keyed by the credential itself.
_api_for_credential: dict[str, str] = {}


class IPFSUploadError(RuntimeError):
    pass


class IPFSNotConfiguredError(RuntimeError):
    pass


def _auth_headers() -> dict[str, str]:
    jwt = current_app.config.get("PINATA_JWT")
    if jwt:
        return {"Authorization": f"Bearer {jwt}"}

    api_key = current_app.config.get("PINATA_API_KEY")
    secret_key = current_app.config.get("PINATA_SECRET_KEY")
    if api_key and secret_key:
        return {"pinata_api_key": api_key, "pinata_secret_api_key": secret_key}

    raise IPFSNotConfiguredError(
        "Publishing to IPFS isn't set up on this server yet: it needs a Pinata API key "
        "(PINATA_JWT, or PINATA_API_KEY + PINATA_SECRET_KEY, in backend/.env)"
    )


def _mode_order() -> list[str]:
    mode = current_app.config.get("PINATA_API", "auto")
    has_jwt = bool(current_app.config.get("PINATA_JWT"))
    if mode == "v3":
        if not has_jwt:
            raise IPFSNotConfiguredError("PINATA_API=v3 needs PINATA_JWT — the v3 Files API only accepts a JWT")
        return ["v3"]
    if mode == "legacy" or not has_jwt:
        return ["legacy"]
    remembered = _api_for_credential.get(current_app.config["PINATA_JWT"])
    return [remembered] if remembered else ["v3", "legacy"]


def _upload(parts: list[tuple[str, tuple[str, bytes, str]]], legacy_path: str, what: str, timeout: int) -> str:
    """Sends `parts` (multipart "file" fields) to Pinata and returns the CID.
    One part is one file; several parts sharing a leading folder name become
    one IPFS directory, on both APIs."""
    headers = _auth_headers()
    last_refusal = ""
    for mode in _mode_order():
        if mode == "v3":
            url, data = f"{PINATA_UPLOADS_URL}/v3/files", {"network": "public"}
        else:
            url, data = f"{PINATA_BASE_URL}{legacy_path}", None
        try:
            response = requests.post(url, files=parts, data=data, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            raise IPFSUploadError(f"Pinata {what} upload request failed: {exc}") from exc
        if response.status_code in (401, 403) and current_app.config.get("PINATA_API", "auto") == "auto" and mode == "v3":
            last_refusal = response.text
            continue  # a key without v3 scopes: try the classic API
        if response.status_code != 200:
            raise IPFSUploadError(f"Pinata {what} upload failed ({response.status_code}): {response.text or last_refusal}")
        body = response.json()
        cid = body["data"]["cid"] if mode == "v3" else body["IpfsHash"]
        if current_app.config.get("PINATA_JWT"):
            _api_for_credential[current_app.config["PINATA_JWT"]] = mode
        return cid
    raise IPFSUploadError(f"Pinata {what} upload failed: {last_refusal}")


def upload_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    ipfs_hash = _upload([("file", (filename, file_bytes, "application/octet-stream"))], "/pinning/pinFileToIPFS", "file", 60)
    return {
        "hash": ipfs_hash,
        "url": f"ipfs://{ipfs_hash}",
        "gateway_url": f"{PINATA_GATEWAY}{ipfs_hash}",
    }


def upload_json(data: dict[str, Any], filename: str) -> dict[str, Any]:
    """Pins a JSON document as a file (both APIs; the gateway serves it as
    application/json either way)."""
    body = json.dumps(data).encode()
    ipfs_hash = _upload([("file", (filename, body, "application/json"))], "/pinning/pinFileToIPFS", "JSON", 30)
    return {
        "hash": ipfs_hash,
        "url": f"ipfs://{ipfs_hash}",
        "gateway_url": f"{PINATA_GATEWAY}{ipfs_hash}",
    }


def upload_directory(files: dict[str, bytes], folder_name: str) -> dict[str, Any]:
    """Pins several files as ONE IPFS directory and returns the directory's
    CID — so `<cid>/<filename>` resolves each file. Both Pinata APIs treat a
    multi-file upload as a directory when every part's filename shares a
    leading folder, which is what this sends (checked on real v3: the result
    is mime_type "directory" and <cid>/2.json resolves on the gateway).
    Needed for an ERC-721 whose tokenURI is baseURI + tokenId + ".json"."""
    if not files:
        raise ValueError("upload_directory needs at least one file")
    parts = [("file", (f"{folder_name}/{name}", data, "application/json")) for name, data in files.items()]
    ipfs_hash = _upload(parts, "/pinning/pinFileToIPFS", "directory", 120)
    return {"hash": ipfs_hash, "url": f"ipfs://{ipfs_hash}/", "gateway_url": f"{PINATA_GATEWAY}{ipfs_hash}/"}


def upload_nft_metadata(
    name: str,
    description: str,
    image_ipfs_hash: str,
    attributes: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    metadata = {
        "name": name,
        "description": description,
        "image": f"ipfs://{image_ipfs_hash}",
        "attributes": attributes or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return upload_json(metadata, f"{name.replace(' ', '_')}_metadata.json")
