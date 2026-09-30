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


def _apply_opacity(img: Image.Image, opacity: float) -> Image.Image:
    """Multiply this layer's RGBA alpha (normal blend). RGB is left as-is."""
    if opacity >= 1.0:
        return img
    if opacity <= 0.0:
        return Image.new("RGBA", img.size, (0, 0, 0, 0))
    r, g, b, a = img.split()
    a = a.point(lambda p: int(p * opacity))
    return Image.merge("RGBA", (r, g, b, a))


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
    """Stack the *visible* layers bottom→top. Canvas x/y/w/h is deliberately ignored.

    Per-layer ``opacity`` multiplies that layer's alpha before compositing;
    ``visible=false`` still excludes the layer entirely.
    """
    root = Path(project_root)
    ordered = visible_layers(layers)
    if not ordered:
        raise LayersError("no visible layers to compose")
    images = [_load_rgba(layer.resolved_path(root)) for layer in ordered]
    images = _align_height(images)
    images = [_apply_opacity(img, layer.opacity) for img, layer in zip(images, ordered)]
    combined = images[0]
    for img in images[1:]:
        combined = Image.alpha_composite(combined, img)
    return combined


def compose_project(
    project_root: Path | str,
    output_name: str = "composite.png",
    layer_ids: list[str] | None = None,
) -> Path:
    """Compose all visible layers, or only those in ``layer_ids`` (still visible-filtered)."""
    from .layers import load_layers

    root = Path(project_root)
    layers = load_layers(root)
    if layer_ids is not None:
        wanted = set(layer_ids)
        layers = [layer for layer in layers if layer.id in wanted]
    composite = compose_layers(root, layers)
    out = root / output_name
    out.parent.mkdir(parents=True, exist_ok=True)
    composite.save(out)
    return out


def compose_group(project_root: Path | str, group_id: str) -> Path:
    """Compose one group's members to ``groups/<group_id>.png``."""
    from .layers import load_layers_document

    root = Path(project_root)
    doc = load_layers_document(root)
    group = next((g for g in doc.groups if g.id == group_id), None)
    if group is None:
        raise LayersError(f"unknown group id: {group_id}")
    return compose_project(root, output_name=f"groups/{group_id}.png", layer_ids=list(group.memberIds))
