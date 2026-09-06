"""
IPFS uploads via Pinata.

Ported from the real parts of the old root-level ipfs_integration.py, which
supported Infura, Pinata, and a local node. Infura's public IPFS pinning
service was shut down years ago, so that branch (and the 'local' node branch,
which nobody in this project runs) are dropped — Pinata is the only supported
provider now.

I'm not fully certain whether Pinata's legacy pinata_api_key/pinata_secret_api_key
header auth still works in 2026 vs. their newer JWT-based auth. This supports
both — a PINATA_JWT bearer token if set, else the legacy header pair — as a
hedge. Verify against Pinata's current docs before relying on this.
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
PINATA_BASE_URL = os.environ.get("PINATA_BASE_URL", "https://api.pinata.cloud")
PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs/"


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
        "Pinata is not configured — set PINATA_JWT or PINATA_API_KEY + PINATA_SECRET_KEY"
    )


def upload_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    response = requests.post(
        f"{PINATA_BASE_URL}/pinning/pinFileToIPFS",
        files={"file": (filename, file_bytes)},
        headers=_auth_headers(),
        timeout=60,
    )
    if response.status_code != 200:
        raise IPFSUploadError(f"Pinata file upload failed ({response.status_code}): {response.text}")

    result = response.json()
    ipfs_hash = result["IpfsHash"]
    return {
        "hash": ipfs_hash,
        "url": f"ipfs://{ipfs_hash}",
        "gateway_url": f"{PINATA_GATEWAY}{ipfs_hash}",
        "size": result.get("PinSize"),
    }


def upload_json(data: dict[str, Any], filename: str) -> dict[str, Any]:
    payload = {
        "pinataContent": data,
        "pinataMetadata": {"name": filename},
    }
    response = requests.post(
        f"{PINATA_BASE_URL}/pinning/pinJSONToIPFS",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=30,
    )
    if response.status_code != 200:
        raise IPFSUploadError(f"Pinata JSON upload failed ({response.status_code}): {response.text}")

    result = response.json()
    ipfs_hash = result["IpfsHash"]
    return {
        "hash": ipfs_hash,
        "url": f"ipfs://{ipfs_hash}",
        "gateway_url": f"{PINATA_GATEWAY}{ipfs_hash}",
    }


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
