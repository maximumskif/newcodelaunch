"""Tiny local stand-in for Pinata's pinning API, used only by the e2e suite
so Candy Machine's "publish to IPFS" step doesn't need a real Pinata account
or network access. The real backend logic (backend/app/services/ipfs.py) is
completely unchanged and still makes real HTTP calls — they land here
instead of api.pinata.cloud, via the PINATA_BASE_URL override run-backend.sh
sets during e2e runs. Returns a fake but stable IpfsHash; nothing else in
this app ever verifies that hash resolves on real IPFS, so this is safe to
fake at this one boundary (there's no local-open-source equivalent of
"pin something to global IPFS" the way anvil/solana-test-validator are for a
real chain).

Run via e2e/setup/run-pinata-stub.sh, not directly.
"""

from __future__ import annotations

import hashlib

from flask import Flask, jsonify, request

app = Flask(__name__)


def _fake_hash(payload: bytes) -> str:
    return "Qm" + hashlib.sha256(payload).hexdigest()[:44]


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/pinning/pinFileToIPFS")
def pin_file():
    data = request.files["file"].read()
    return jsonify(IpfsHash=_fake_hash(data), PinSize=len(data), Timestamp="2026-01-01T00:00:00.000Z")


@app.post("/pinning/pinJSONToIPFS")
def pin_json():
    data = request.get_data()
    return jsonify(IpfsHash=_fake_hash(data), PinSize=len(data), Timestamp="2026-01-01T00:00:00.000Z")


if __name__ == "__main__":
    app.run(port=5555)
