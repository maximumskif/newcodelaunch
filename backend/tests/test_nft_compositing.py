import io

import pytest
from PIL import Image

from app.services import nft_compositing


def _save_png(tmp_path, name: str, size: tuple[int, int], color: tuple[int, int, int, int]) -> str:
    path = tmp_path / name
    Image.new("RGBA", size, color).save(path)
    return str(path)


def test_composite_layers_stacks_bottom_to_top(tmp_path):
    # Two fully opaque layers — the visible result must be the TOP layer's
    # color at every pixel, proving layers are actually stacked in the
    # given order and not blended or reversed.
    blue = _save_png(tmp_path, "blue.png", (8, 8), (0, 0, 255, 255))
    red = _save_png(tmp_path, "red.png", (8, 8), (255, 0, 0, 255))

    result = Image.open(io.BytesIO(nft_compositing.composite_layers([blue, red], canvas_size=8)))

    assert result.size == (8, 8)
    assert result.getpixel((0, 0)) == (255, 0, 0, 255)


def test_composite_layers_respects_transparency(tmp_path):
    # A fully transparent top layer must let the opaque bottom layer show
    # through untouched — this is what makes trait layering possible at all.
    blue = _save_png(tmp_path, "blue.png", (8, 8), (0, 0, 255, 255))
    transparent = _save_png(tmp_path, "transparent.png", (8, 8), (255, 0, 0, 0))

    result = Image.open(io.BytesIO(nft_compositing.composite_layers([blue, transparent], canvas_size=8)))

    assert result.getpixel((0, 0)) == (0, 0, 255, 255)


def test_composite_layers_resizes_a_mismatched_layer_to_canvas_size(tmp_path):
    small_red = _save_png(tmp_path, "small_red.png", (4, 4), (255, 0, 0, 255))

    result = Image.open(io.BytesIO(nft_compositing.composite_layers([small_red], canvas_size=16)))

    assert result.size == (16, 16)
    assert result.getpixel((0, 0)) == (255, 0, 0, 255)


def test_composite_layers_rejects_an_empty_list():
    with pytest.raises(ValueError):
        nft_compositing.composite_layers([], canvas_size=8)
