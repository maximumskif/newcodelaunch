"""Tiny local stand-in for Pinata's pinning API *and* its public gateway,
used only by the e2e suite so Candy Machine and NFT Generator's "publish to
IPFS" steps don't need a real Pinata account or network access. The real
backend logic (backend/app/services/ipfs.py) is completely unchanged and
still makes real HTTP calls — pins land here instead of api.pinata.cloud
(via the PINATA_BASE_URL override), and metadata-preview reads land here
instead of gateway.pinata.cloud (via the PINATA_GATEWAY_URL override) —
both set by run-backend.sh during e2e runs.

Pinned content is kept in memory (this process's whole lifetime is one e2e
run) and served back byte-for-byte at /ipfs/<hash>, so a "fetch what's
pinned" read — like the NFT Generator's metadata-preview feature — gets a
real round trip through this app's own real upload, not just a fake hash
nothing ever reads back. The one thing still not real is global IPFS
availability itself — nothing outside this process can resolve these
hashes, which is the one gap left, same as before.

Run via e2e/setup/run-pinata-stub.sh, not directly.
"""

from __future__ import annotations

import hashlib
import json

from flask import Flask, Response, jsonify, request

app = Flask(__name__)

_PINNED: dict[str, tuple[bytes, str]] = {}


def _fake_hash(payload: bytes) -> str:
    return "Qm" + hashlib.sha256(payload).hexdigest()[:44]


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/pinning/pinFileToIPFS")
def pin_file():
    files = request.files.getlist("file")
    # Real Pinata semantics: several parts whose filenames share a leading
    # folder ("folder/1.json", "folder/2.json") pin as ONE directory, and
    # the returned hash is the directory's — `<hash>/1.json` resolves each
    # file. That's what ipfs.upload_directory sends for an ERC-721's
    # metadata folder.
    if len(files) > 1 or "/" in (files[0].filename or ""):
        entries = [(file.filename.split("/", 1)[-1], file.read(), file.mimetype) for file in files]
        ipfs_hash = _fake_hash(b"".join(name.encode() + data for name, data, _ in entries))
        for name, data, mimetype in entries:
            content_type = "application/json" if name.endswith(".json") else (mimetype or "application/octet-stream")
            _PINNED[f"{ipfs_hash}/{name}"] = (data, content_type)
        size = sum(len(data) for _, data, _ in entries)
        return jsonify(IpfsHash=ipfs_hash, PinSize=size, Timestamp="2026-01-01T00:00:00.000Z")

    file = files[0]
    data = file.read()
    ipfs_hash = _fake_hash(data)
    _PINNED[ipfs_hash] = (data, file.mimetype or "application/octet-stream")
    return jsonify(IpfsHash=ipfs_hash, PinSize=len(data), Timestamp="2026-01-01T00:00:00.000Z")


@app.post("/pinning/pinJSONToIPFS")
def pin_json():
    # Real Pinata pins (and its gateway serves back) only `pinataContent` —
    # `pinataMetadata` is Pinata's own bookkeeping. This used to store the
    # whole request wrapper, so everything read back through the gateway was
    # one level too deep: invisible until a token's description had to be
    # read back after an edit (the NFT metadata-preview spec only asserted
    # its label, not what it showed).
    data = json.dumps(request.get_json()["pinataContent"]).encode()
    ipfs_hash = _fake_hash(data)
    _PINNED[ipfs_hash] = (data, "application/json")
    return jsonify(IpfsHash=ipfs_hash, PinSize=len(data), Timestamp="2026-01-01T00:00:00.000Z")


@app.get("/ipfs/<path:ipfs_path>")
def get_pinned(ipfs_path: str):
    pinned = _PINNED.get(ipfs_path)
    if pinned is None:
        return jsonify(error="not found"), 404
    data, content_type = pinned
    return Response(data, mimetype=content_type)


if __name__ == "__main__":
    app.run(port=5555)
