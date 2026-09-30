"""Layer composition.

Adapted from reference/qwen-image-layered/src/tool/combine_layers.py:
- load each layer as RGBA
- align heights when needed (LANCZOS resize, keep aspect)
- alpha_composite bottom → top
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from .layers import Layer, LayersError, visible_layers


def _load_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"layer file not found: {path}")
    return Image.open(path).convert("RGBA")


def _align_height(images: list[Image.Image]) -> list[Image.Image]:
    """Match combine_layers.py: scale so all images share min height."""
    if not images:
        return []
    min_height = min(img.height for img in images)
    if all(img.height == min_height for img in images):
        return images
    resized: list[Image.Image] = []
    for img in images:
        if img.height == min_height:
            resized.append(img)
            continue
        new_w = int(img.width * min_height / img.height)
        resized.append(img.resize((new_w, min_height), Image.LANCZOS))
    return resized


def compose_layers(project_root: Path | str, layers: list[Layer]) -> Image.Image:
    """Stack the *visible* layers bottom→top. Canvas x/y/w/h is deliberately ignored."""
    root = Path(project_root)
    ordered = visible_layers(layers)
    if not ordered:
        raise LayersError("no visible layers to compose")
    images = [_load_rgba(layer.resolved_path(root)) for layer in ordered]
    images = _align_height(images)
    combined = images[0]
    for img in images[1:]:
        combined = Image.alpha_composite(combined, img)
    return combined


def compose_project(project_root: Path | str, output_name: str = "composite.png") -> Path:
    from .layers import load_layers

    root = Path(project_root)
    layers = load_layers(root)
    composite = compose_layers(root, layers)
    out = root / output_name
    composite.save(out)
    return out
