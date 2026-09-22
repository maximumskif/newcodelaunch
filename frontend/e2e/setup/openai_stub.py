"""Tiny local stand-in for OpenAI's Chat Completions API, used only by the
e2e suite so the AI Trait Identifier's optional vision pass
(backend/app/services/ai_traits.py's _analyze_with_ai_vision) doesn't need a
real, paid OpenAI account. The real backend logic is completely unchanged
and still makes a real `openai` client call with a real API-key header and
the real request/response shape — it lands here instead of api.openai.com
(via the OPENAI_BASE_URL override), same pattern as pinata_stub.py for
Pinata. Both PINATA_BASE_URL and OPENAI_BASE_URL are set by run-backend.sh
during e2e runs.

Response content is deterministic and based on nothing in the request beyond
its own presence — there's no local open-source equivalent of "really
classify this image," so unlike the Pinata stub (which really stores and
serves back byte-for-byte what it's given), this fakes only the third-party
model's *judgment*, not a resolvable resource. What's real either side of
that: a real network round trip, real client-library request construction,
real JSON parsing of the response on the backend side, and the real CV
analysis this feature always runs regardless of a key. See
frontend/e2e/README.md.

Run via e2e/setup/run-openai-stub.sh, not directly.
"""

from __future__ import annotations

import json
import time

from flask import Flask, jsonify, request

app = Flask(__name__)

_FAKE_VISION_RESULT = {
    "detected_objects": ["shape", "background"],
    "style_classification": "digital art",
    "mood": "neutral",
    "rarity_suggestion": "uncommon",
}


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/v1/chat/completions")
def chat_completions():
    body = request.get_json(silent=True) or {}
    return jsonify(
        id="chatcmpl-e2e-stub",
        object="chat.completion",
        created=int(time.time()),
        model=body.get("model", "gpt-4o-mini"),
        choices=[
            {
                "index": 0,
                "message": {"role": "assistant", "content": json.dumps(_FAKE_VISION_RESULT)},
                "finish_reason": "stop",
            }
        ],
        usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    )


if __name__ == "__main__":
    app.run(port=5556)
