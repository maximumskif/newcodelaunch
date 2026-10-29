import hmac

from flask import Blueprint, current_app, jsonify, request

from ..services import telegram_bot

telegram_bp = Blueprint("telegram", __name__)


@telegram_bp.post("/webhook")
def webhook():
    """Telegram posts each bot update here (see `flask telegram-set-webhook`).
    The answer goes back in the response body, which Telegram runs as a Bot
    API call, so replying needs no request of our own."""
    secret = current_app.config.get("TELEGRAM_WEBHOOK_SECRET")
    if not telegram_bot.is_configured() or not secret:
        return jsonify(error="Not found"), 404
    sent = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not hmac.compare_digest(sent.encode(), secret.encode()):
        return jsonify(error="Forbidden"), 403
    update = request.get_json(silent=True)
    try:
        reply = telegram_bot.handle_update(update) if isinstance(update, dict) else None
    except Exception:
        # Anything but a 200 makes Telegram resend the same update over and
        # over, so a message that breaks the bot is logged and dropped.
        current_app.logger.exception("telegram update failed")
        reply = None
    return jsonify(reply or {})
