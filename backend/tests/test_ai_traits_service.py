import io

from PIL import Image

from app.services import ai_traits


def _png_bytes(size: tuple[int, int], color=(0, 0, 255, 255)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_analyze_single_image_does_not_crash_on_a_1px_wide_image():
    # Regression: _analyze_composition's width // 2 == 0 for a 1px-wide
    # image produces a zero-area crop, and ImageStat.Stat.mean divides by
    # that crop's pixel count — real ZeroDivisionError, found via a real
    # 1x1 test fixture image in the e2e suite, not a hypothetical.
    result = ai_traits.analyze_single_image(_png_bytes((1, 1)), "tiny.png")
    assert result["traits"]["symmetry"] in {"symmetric", "somewhat_symmetric", "asymmetric"}
    assert result["traits"]["balance"] == "balanced"


def test_analyze_single_image_does_not_crash_on_a_1px_tall_image():
    result = ai_traits.analyze_single_image(_png_bytes((10, 1)), "tiny.png")
    assert result["traits"]["balance"] == "balanced"


def test_batch_analyze_images_computes_zero_diversity_for_identical_images():
    images = [{"filename": "a.png", "data": _png_bytes((4, 4))}, {"filename": "b.png", "data": _png_bytes((4, 4))}]
    result = ai_traits.batch_analyze_images(images)

    assert result["total_images"] == 2
    assert result["collection_insights"]["diversity_score"] == 0.0
