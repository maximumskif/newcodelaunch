from flask import Blueprint, jsonify

from ...services import blockchain

blockchain_bp = Blueprint("blockchain", __name__)


@blockchain_bp.get("/networks")
def networks():
    return jsonify(networks=blockchain.get_supported_networks())


@blockchain_bp.get("/<network>/status")
def status(network):
    try:
        return jsonify(blockchain.get_network_status(network))
    except blockchain.UnknownNetworkError as exc:
        return jsonify(error=str(exc)), 404


@blockchain_bp.get("/<network>/gas-price")
def gas_price(network):
    if network not in blockchain.EVM_NETWORKS and network not in blockchain.SOLANA_NETWORKS:
        return jsonify(error=f"Unknown network: {network}"), 404
    try:
        price = blockchain.get_gas_price_gwei(network)
    except Exception as exc:  # noqa: BLE001 — public RPC endpoints do go down; a flaky
        # upstream must surface as a clean 502, not an unhandled 500 (which, with
        # debug=True, leaks a full traceback — internal paths, RPC URLs — to the caller).
        return jsonify(error=f"Could not fetch gas price: {exc}"), 502
    if price is None:
        return jsonify(error=f"No gas price concept for network '{network}'"), 400
    return jsonify(network=network, gas_price_gwei=price)


@blockchain_bp.get("/<network>/transaction/<tx_hash>")
def transaction_status(network, tx_hash):
    try:
        return jsonify(blockchain.get_transaction_status(network, tx_hash))
    except blockchain.UnknownNetworkError as exc:
        return jsonify(error=str(exc)), 404
