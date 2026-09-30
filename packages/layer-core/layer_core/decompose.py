"""Mock image → multi-layer decomposition for LayerForge MVP.

Does NOT load ML weights. Produces a small set of editable RGBA layers
that sum back toward the source look via alpha_composite (bottom→top).
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from .layers import (
    Layer,
    LayersError,
    ProjectLayers,
    card_size,
    load_layers_document,
    save_layers_document,
)

#: Horizontal gap between cards on first placement (canvas page units).
CARD_GAP = 80


def _place_cards(specs: list[Layer], img_w: int, img_h: int) -> None:
    """Initial canvas layout: one top row, ``x`` = previous right edge + gap, ``y`` pinned to 0.

    Adapted from ``reference/designjs/.../canvas/artboards.ts`` ``findPlacement``, which
    pins ``y`` precisely because following the previous card's ``y`` causes vertical drift
    and overlapping stacks. Card size keeps the image aspect (no more fixed 3:4).
    """
    card_w, card_h = card_size(img_w, img_h)
    x = 0.0
    for layer in specs:
        layer.imgW = img_w
        layer.imgH = img_h
        layer.w = card_w
        layer.h = card_h
        layer.x = x
        layer.y = 0.0
        x += card_w + CARD_GAP


def mock_decompose(
    project_root: Path | str,
    source: Path | str,
    *,
    layer_count: int = 3,
) -> list[Layer]:
    """Split source into mock layers under <project>/layers/ and write layers.json.

    Layout (bottom→top):
      - base: full-frame desaturated copy of the source
      - mid:  soft color wash / vignette derived from source colors
      - fg:   sparse highlight/mask bars so the stack is visibly layered
    """
    root = Path(project_root)
    src = Path(source).expanduser()
    if not src.is_file():
        raise FileNotFoundError(f"source image not found: {src}")
    if layer_count < 2:
        layer_count = 2
    if layer_count > 5:
        layer_count = 5

    layers_dir = root / "layers"
    if layers_dir.exists():
        shutil.rmtree(layers_dir)
    layers_dir.mkdir(parents=True, exist_ok=True)

    # Keep a project-local copy of the source for the audit trail.
    source_copy = root / "source.png"
    with Image.open(src) as im:
        base_rgb = im.convert("RGB")
        # normalize size to keep compose stable
        max_side = 1280
        scale = min(1.0, max_side / max(base_rgb.size))
        if scale < 1.0:
            base_rgb = base_rgb.resize(
                (int(base_rgb.width * scale), int(base_rgb.height * scale)),
                Image.LANCZOS,
            )
        base_rgb.save(source_copy, format="PNG")

    with Image.open(source_copy) as im:
        base_rgb = im.convert("RGB")
    w, h = base_rgb.size

    # --- base: grayscale-ish full frame ---
    base = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    soft = base_rgb.convert("L").convert("RGB")
    base.paste(soft, (0, 0))
    base.save(layers_dir / "base.png")

    # --- mid: tinted wash from average color ---
    avg = base_rgb.resize((1, 1), Image.BOX).getpixel((0, 0))
    mid = Image.new("RGBA", (w, h), (avg[0], avg[1], avg[2], 70))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.ellipse((-w * 0.1, -h * 0.15, w * 0.75, h * 0.7), fill=(255, 255, 255, 50))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=max(8, w // 40)))
    mid = Image.alpha_composite(mid, overlay)
    mid.save(layers_dir / "mid.png")

    # --- fg: highlight bars (optional 3rd+) ---
    if layer_count >= 3:
        fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(fg)
        bar_h = max(12, h // 40)
        d.rectangle((int(w * 0.08), int(h * 0.72), int(w * 0.55), int(h * 0.72) + bar_h),
                    fill=(255, 220, 120, 180))
        d.rectangle((int(w * 0.08), int(h * 0.78), int(w * 0.38), int(h * 0.78) + bar_h // 2),
                    fill=(255, 255, 255, 140))
        fg.save(layers_dir / "fg.png")

    if layer_count >= 4:
        spark = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(spark)
        r = max(6, w // 80)
        d.ellipse((int(w * 0.72), int(h * 0.18), int(w * 0.72) + r * 2, int(h * 0.18) + r * 2),
                  fill=(255, 255, 255, 200))
        spark.save(layers_dir / "spark.png")

    specs = [
        Layer(id="base", name="Base", file="layers/base.png", order=0),
        Layer(id="mid", name="Wash", file="layers/mid.png", order=1),
    ]
    if layer_count >= 3:
        specs.append(Layer(id="fg", name="Highlights", file="layers/fg.png", order=2))
    if layer_count >= 4:
        specs.append(Layer(id="spark", name="Spark", file="layers/spark.png", order=3))

    _place_cards(specs, w, h)
    # Re-decomposing must not rewind `rev`, or the two writers (web API / MCP) lose
    # the only signal they have that the file changed underneath them.
    try:
        prev_rev = load_layers_document(root).rev
    except LayersError:
        prev_rev = 0
    save_layers_document(root, ProjectLayers(layers=specs, groups=[], rev=prev_rev))
    return specs
