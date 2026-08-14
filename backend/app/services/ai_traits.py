"""
AI Trait Identifier: real computer-vision trait extraction, plus a real
(optional) AI-vision pass.

Ported near-verbatim from the old root-level ai_image_analyzer.py's color /
visual-element / composition / technical analysis and the batch rarity /
diversity-score math — that part was genuinely computed from real pixel data
(PIL + numpy + colorsys), not simulated.

The one thing NOT ported as-is: the old `_analyze_with_ai()` was a stub that
returned hardcoded values ("simulated for now", per its own comment) even
when an OpenAI key was configured. Replaced here with an actual OpenAI vision
call, gated on OPENAI_API_KEY — when it's not set, the response just omits
the AI section instead of fabricating one. Uses the current `openai` v1.x
client interface correctly; the old app.py had unrelated code elsewhere that
called the pre-1.0 `openai.ChatCompletion.create(...)` syntax against the
same SDK version, which would have raised immediately.
"""

from __future__ import annotations

import base64
import colorsys
import hashlib
import io
import json
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
from PIL import Image, ImageFilter, ImageStat

AI_VISION_MODEL = "gpt-4o-mini"  # check for a current vision-capable model before relying on this


def analyze_single_image(image_bytes: bytes, filename: str, openai_api_key: str = "") -> dict[str, Any]:
    image = Image.open(io.BytesIO(image_bytes))

    traits: dict[str, Any] = {}
    traits.update(_analyze_colors(image))
    traits.update(_analyze_visual_elements(image))
    traits.update(_analyze_composition(image))
    traits.update(_analyze_technical_aspects(image, filename))

    ai_error = None
    if openai_api_key:
        try:
            traits.update(_analyze_with_ai_vision(image_bytes, openai_api_key))
        except Exception as exc:  # noqa: BLE001 — AI section is best-effort, never blocks the real analysis
            ai_error = str(exc)

    return {
        "filename": filename,
        "analysis_id": _generate_analysis_id(image_bytes),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "traits": traits,
        "suggested_rarity": _calculate_rarity_suggestion(traits),
        "confidence_scores": _calculate_confidence_scores(),
        "ai_error": ai_error,
    }


def batch_analyze_images(images: list[dict[str, Any]], openai_api_key: str = "") -> dict[str, Any]:
    batch_id = f"batch_{int(datetime.now(timezone.utc).timestamp())}"
    results = []
    trait_frequency: dict[str, dict[str, int]] = {}

    for i, image_info in enumerate(images):
        filename = image_info.get("filename", f"image_{i + 1}.png")
        analysis = analyze_single_image(image_info["data"], filename, openai_api_key)
        results.append(analysis)

        for trait_name, trait_value in analysis["traits"].items():
            trait_frequency.setdefault(trait_name, {})
            trait_key = str(trait_value)
            trait_frequency[trait_name][trait_key] = trait_frequency[trait_name].get(trait_key, 0) + 1

    return {
        "batch_id": batch_id,
        "total_images": len(images),
        "results": results,
        "trait_frequency": trait_frequency,
        "rarity_scores": _calculate_collection_rarity(results, trait_frequency),
        "collection_insights": _generate_collection_insights(results, trait_frequency),
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }


# --- Real AI vision (new) -----------------------------------------------------------


def _analyze_with_ai_vision(image_bytes: bytes, api_key: str) -> dict[str, Any]:
    from openai import OpenAI  # imported lazily so the package is only required when a key is set

    client = OpenAI(api_key=api_key)
    encoded = base64.b64encode(image_bytes).decode("utf-8")

    response = client.chat.completions.create(
        model=AI_VISION_MODEL,
        response_format={"type": "json_object"},
        max_tokens=300,
        messages=[
            {
                "role": "system",
                "content": (
                    "You analyze NFT trait artwork. Respond with a JSON object with keys: "
                    "detected_objects (array of short strings), style_classification (string), "
                    "mood (string), rarity_suggestion (one of 'common', 'uncommon', 'rare', 'legendary')."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze this NFT trait image."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
                ],
            },
        ],
    )

    parsed = json.loads(response.choices[0].message.content or "{}")
    return {
        "ai_detected_objects": parsed.get("detected_objects", []),
        "ai_style_classification": parsed.get("style_classification", "unknown"),
        "ai_mood_detection": parsed.get("mood", "unknown"),
        "ai_rarity_suggestion": parsed.get("rarity_suggestion", "common"),
    }


# --- Real CV analysis (ported from ai_image_analyzer.py) ---------------------------


def _generate_analysis_id(image_bytes: bytes) -> str:
    return f"analysis_{hashlib.md5(image_bytes).hexdigest()[:12]}"


def _analyze_colors(image: Image.Image) -> dict[str, Any]:
    if image.mode != "RGB":
        image = image.convert("RGB")

    stat = ImageStat.Stat(image)
    colors = image.getcolors(maxcolors=256 * 256 * 256) or []
    colors.sort(key=lambda x: x[0], reverse=True)

    dominant_colors = []
    total = sum(c[0] for c in colors) or 1
    for count, color in colors[:5]:
        if isinstance(color, int):
            color = (color, color, color)
        h, s, v = colorsys.rgb_to_hsv(color[0] / 255, color[1] / 255, color[2] / 255)
        dominant_colors.append({"name": _get_color_name(h, s, v), "percentage": (count / total) * 100})

    brightness = sum(stat.mean) / len(stat.mean) / 255 * 100

    pixels = list(image.getdata())
    saturations = []
    for pixel in pixels[::100]:
        if isinstance(pixel, int):
            pixel = (pixel, pixel, pixel)
        _, s, _ = colorsys.rgb_to_hsv(pixel[0] / 255, pixel[1] / 255, pixel[2] / 255)
        saturations.append(s)
    avg_saturation = (sum(saturations) / len(saturations) * 100) if saturations else 0

    return {
        "dominant_color": dominant_colors[0]["name"] if dominant_colors else "unknown",
        "color_palette": [c["name"] for c in dominant_colors[:3]],
        "color_scheme": _determine_color_scheme(dominant_colors),
        "brightness_level": _categorize_brightness(brightness),
        "saturation_level": _categorize_saturation(avg_saturation),
        "color_diversity": len({c["name"] for c in dominant_colors}),
    }


def _get_color_name(h: float, s: float, v: float) -> str:
    if v < 0.2:
        return "black"
    if v > 0.8 and s < 0.2:
        return "white"
    if s < 0.2:
        return "gray"

    hue_degree = h * 360
    if hue_degree < 15 or hue_degree >= 345:
        return "red"
    if hue_degree < 45:
        return "orange"
    if hue_degree < 75:
        return "yellow"
    if hue_degree < 150:
        return "green"
    if hue_degree < 210:
        return "cyan"
    if hue_degree < 270:
        return "blue"
    if hue_degree < 330:
        return "purple"
    return "pink"


def _determine_color_scheme(dominant_colors: list[dict[str, Any]]) -> str:
    if not dominant_colors:
        return "unknown"

    color_names = [c["name"] for c in dominant_colors[:3]]
    if len(set(color_names)) == 1:
        return "monochromatic"
    if all(color in ["black", "white", "gray"] for color in color_names):
        return "grayscale"

    warm_colors = {"red", "orange", "yellow", "pink"}
    cool_colors = {"blue", "green", "cyan", "purple"}
    warm_count = sum(1 for c in color_names if c in warm_colors)
    cool_count = sum(1 for c in color_names if c in cool_colors)

    if warm_count > cool_count:
        return "warm"
    if cool_count > warm_count:
        return "cool"
    return "mixed"


def _categorize_brightness(brightness: float) -> str:
    if brightness < 30:
        return "dark"
    if brightness < 70:
        return "medium"
    return "bright"


def _categorize_saturation(saturation: float) -> str:
    if saturation < 20:
        return "muted"
    if saturation < 60:
        return "moderate"
    return "vibrant"


def _analyze_visual_elements(image: Image.Image) -> dict[str, Any]:
    width, height = image.size

    gray_image = image.convert("L")
    edges = gray_image.filter(ImageFilter.FIND_EDGES)
    edge_pixels = sum(1 for pixel in edges.getdata() if pixel > 50)
    complexity = edge_pixels / (width * height)

    return {
        "art_style": _determine_art_style(complexity),
        "complexity_level": _categorize_complexity(complexity),
        "background_type": _classify_background(image, width, height),
        "aspect_ratio": _get_aspect_ratio(width, height),
        "resolution_category": _categorize_resolution(width, height),
    }


def _determine_art_style(complexity: float) -> str:
    if complexity < 0.1:
        return "minimalist"
    if complexity < 0.3:
        return "clean"
    if complexity < 0.5:
        return "detailed"
    return "complex"


def _categorize_complexity(complexity: float) -> str:
    if complexity < 0.2:
        return "simple"
    if complexity < 0.4:
        return "moderate"
    return "complex"


def _classify_background(image: Image.Image, width: int, height: int) -> str:
    corner_size = max(1, min(width, height) // 10)
    corners = [
        (0, 0, corner_size, corner_size),
        (width - corner_size, 0, width, corner_size),
        (0, height - corner_size, corner_size, height),
        (width - corner_size, height - corner_size, width, height),
    ]

    variances = []
    for corner in corners:
        sample = ImageStat.Stat(image.crop(corner)).mean
        if len(sample) >= 3:
            variances.append(np.var(sample[:3]))

    avg_variance = sum(variances) / len(variances) if variances else 0
    if avg_variance < 100:
        return "solid"
    if avg_variance < 1000:
        return "gradient"
    return "textured"


def _get_aspect_ratio(width: int, height: int) -> str:
    ratio = width / height
    if 0.9 <= ratio <= 1.1:
        return "square"
    if ratio > 1.5:
        return "landscape"
    if ratio < 0.7:
        return "portrait"
    return "standard"


def _categorize_resolution(width: int, height: int) -> str:
    total_pixels = width * height
    if total_pixels < 100_000:
        return "low"
    if total_pixels < 1_000_000:
        return "medium"
    if total_pixels < 4_000_000:
        return "high"
    return "ultra_high"


def _analyze_composition(image: Image.Image) -> dict[str, Any]:
    width, height = image.size

    left_half = image.crop((0, 0, width // 2, height))
    right_half = image.crop((width // 2, 0, width, height)).transpose(Image.FLIP_LEFT_RIGHT)

    left_stat = ImageStat.Stat(left_half)
    right_stat = ImageStat.Stat(right_half)
    symmetry_score = 1.0 - (abs(sum(left_stat.mean) - sum(right_stat.mean)) / (255 * 3))

    return {
        "symmetry": _categorize_symmetry(symmetry_score),
        "orientation": "landscape" if width > height else "portrait" if height > width else "square",
        "balance": _analyze_balance(image),
    }


def _categorize_symmetry(score: float) -> str:
    if score > 0.8:
        return "symmetric"
    if score > 0.6:
        return "somewhat_symmetric"
    return "asymmetric"


def _analyze_balance(image: Image.Image) -> str:
    width, height = image.size
    quadrants = [
        image.crop((0, 0, width // 2, height // 2)),
        image.crop((width // 2, 0, width, height // 2)),
        image.crop((0, height // 2, width // 2, height)),
        image.crop((width // 2, height // 2, width, height)),
    ]
    brightness_values = [ImageStat.Stat(q.convert("L")).mean[0] for q in quadrants]
    variance = np.var(brightness_values)

    if variance < 500:
        return "balanced"
    if variance < 1500:
        return "slightly_unbalanced"
    return "unbalanced"


def _analyze_technical_aspects(image: Image.Image, filename: str) -> dict[str, Any]:
    width, height = image.size
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    file_size = len(buffer.getvalue())

    return {
        "dimensions": f"{width}x{height}",
        "megapixels": round((width * height) / 1_000_000, 2),
        "format": image.format or "PNG",
        "file_size_kb": round(file_size / 1024, 2),
        "quality_estimate": _estimate_quality(image),
    }


def _estimate_quality(image: Image.Image) -> str:
    total_pixels = image.size[0] * image.size[1]
    if total_pixels >= 1_000_000 and image.mode in ["RGB", "RGBA"]:
        return "high"
    if total_pixels >= 250_000:
        return "medium"
    return "low"


def _calculate_rarity_suggestion(traits: dict[str, Any]) -> str:
    rarity_factors = []

    if traits.get("color_diversity", 0) >= 4:
        rarity_factors.append("rare")
    elif traits.get("color_diversity", 0) >= 2:
        rarity_factors.append("uncommon")
    else:
        rarity_factors.append("common")

    if traits.get("complexity_level") == "complex":
        rarity_factors.append("rare")
    elif traits.get("complexity_level") == "moderate":
        rarity_factors.append("uncommon")
    else:
        rarity_factors.append("common")

    rare_count = rarity_factors.count("rare")
    uncommon_count = rarity_factors.count("uncommon")
    if rare_count >= 2:
        return "rare"
    if rare_count >= 1 or uncommon_count >= 2:
        return "uncommon"
    return "common"


def _calculate_confidence_scores() -> dict[str, float]:
    # These reflect how reliable each analysis method actually is, not per-image
    # data (same as the old app) — color/technical analysis from real pixel math
    # is highly reliable, style/composition heuristics less so.
    return {"color_analysis": 0.95, "composition": 0.80, "technical": 0.99, "overall": 0.85}


def _calculate_collection_rarity(results: list[dict[str, Any]], trait_frequency: dict[str, dict[str, int]]):
    total_items = len(results) or 1
    rarity_scores = {}

    for result in results:
        trait_scores = []
        for trait_name, trait_value in result["traits"].items():
            if trait_name in trait_frequency:
                frequency = trait_frequency[trait_name].get(str(trait_value), 0)
                trait_scores.append(1.0 - (frequency / total_items))

        overall_rarity = sum(trait_scores) / len(trait_scores) if trait_scores else 0
        percentile = overall_rarity * 100
        tier = "legendary" if percentile >= 90 else "rare" if percentile >= 75 else "uncommon" if percentile >= 50 else "common"

        rarity_scores[result["filename"]] = {"score": overall_rarity, "percentile": percentile, "tier": tier}

    return rarity_scores


def _generate_collection_insights(results: list[dict[str, Any]], trait_frequency: dict[str, dict[str, int]]):
    if not results:
        return {}

    most_common_traits = {}
    for trait_name, frequencies in trait_frequency.items():
        most_common = max(frequencies.items(), key=lambda x: x[1])
        most_common_traits[trait_name] = {
            "value": most_common[0],
            "percentage": (most_common[1] / len(results)) * 100,
        }

    color_distribution = Counter(r["traits"].get("dominant_color") for r in results if r["traits"].get("dominant_color"))

    return {
        "collection_size": len(results),
        "unique_traits": {trait: len(freqs) for trait, freqs in trait_frequency.items()},
        "most_common_traits": most_common_traits,
        "color_distribution": dict(color_distribution.most_common(5)),
        "diversity_score": _calculate_diversity_score(trait_frequency),
    }


def _calculate_diversity_score(trait_frequency: dict[str, dict[str, int]]) -> float:
    if not trait_frequency:
        return 0.0

    diversity_scores = []
    for frequencies in trait_frequency.values():
        total = sum(frequencies.values())
        if total == 0:
            continue
        entropy = -sum((count / total) * np.log2(count / total) for count in frequencies.values() if count > 0)
        diversity_scores.append(entropy)

    return sum(diversity_scores) / len(diversity_scores) if diversity_scores else 0.0
