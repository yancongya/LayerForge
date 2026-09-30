"""Generate projects/demo assets: 2–3 PNG layers + layers.json.

Run from repo root:
  $env:PYTHONPATH = "packages/layer-core"
  python packages/layer-core/scripts/make_demo_project.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO = REPO_ROOT / "projects" / "demo"
LAYERS_DIR = DEMO / "layers"

SIZE = (720, 960)


def _bg() -> Image.Image:
    img = Image.new("RGBA", SIZE, (24, 28, 48, 255))
    draw = ImageDraw.Draw(img)
    for y in range(0, SIZE[1], 40):
        draw.rectangle((0, y, SIZE[0], y + 20), fill=(32, 38, 64, 255))
    draw.rounded_rectangle((48, 80, 672, 880), radius=32, outline=(90, 120, 220, 255), width=4)
    return img


def _mid() -> Image.Image:
    img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((180, 220, 540, 580), fill=(255, 120, 90, 255))
    draw.ellipse((260, 300, 340, 380), fill=(24, 28, 48, 255))
    draw.ellipse((380, 300, 460, 380), fill=(24, 28, 48, 255))
    draw.polygon([(360, 420), (320, 500), (400, 500)], fill=(24, 28, 48, 255))
    draw.rounded_rectangle((220, 620, 500, 720), radius=24, fill=(80, 200, 160, 255))
    return img


def _fg() -> Image.Image:
    img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((120, 760, 600, 860), radius=20, fill=(250, 250, 255, 235))
    draw.rectangle((150, 800, 420, 824), fill=(40, 48, 80, 255))
    draw.rectangle((150, 832, 360, 848), fill=(120, 130, 170, 255))
    return img


def main() -> None:
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    assets = {
        "bg": ("Background", _bg()),
        "mid": ("Subject", _mid()),
        "fg": ("Label", _fg()),
    }
    layers = []
    for order, (lid, (name, img)) in enumerate(assets.items()):
        rel = f"layers/{lid}.png"
        img.save(LAYERS_DIR / f"{lid}.png")
        layers.append({"id": lid, "name": name, "file": rel, "order": order})
    payload = {"version": 1, "layers": layers}
    (DEMO / "layers.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(DEMO)


if __name__ == "__main__":
    main()
