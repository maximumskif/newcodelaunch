"""
Real layer-based NFT image compositing.

The old app never did this at all — `generate_nft_collection` in the old
app.py wrote fake image URLs (f"ipfs://generated_image_{i+1}") without
producing any actual image. This is new code, not a port.
"""

from __future__ import annotations

import io

from PIL import Image


def composite_layers(image_paths: list[str], canvas_size: int) -> bytes:
    """Stack trait images (bottom layer first, by NFTLayer.order_index) onto a
    square transparent canvas and return the result as PNG bytes."""
    if not image_paths:
        raise ValueError("At least one layer image is required")

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    for path in image_paths:
        layer_image = Image.open(path).convert("RGBA")
        if layer_image.size != (canvas_size, canvas_size):
            layer_image = layer_image.resize((canvas_size, canvas_size), Image.LANCZOS)
        canvas = Image.alpha_composite(canvas, layer_image)

    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()
