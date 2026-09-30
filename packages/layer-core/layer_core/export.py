"""Export layer assets: png-seq, zip, composite, pptx, psd.

pptx/psd writers copied from reference/qwen-image-layered/src/app.py
(imagelist_to_pptx / imagelist_to_psd).
"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from PIL import Image

from .compose import compose_layers
from .layers import Layer, sort_layers_bottom_to_top


def imagelist_to_pptx(img_files: list[str | Path]) -> Path:
    """From qwen-image-layered/src/app.py — stacked layers on one slide."""
    from pptx import Presentation

    paths = [str(p) for p in img_files]
    with Image.open(paths[0]) as img:
        img_width_px, img_height_px = img.size

    def px_to_emu(px: float, dpi: int = 96) -> int:
        # python-pptx requires slide size ≥ 1 inch (914400 EMU)
        inch = max(px / dpi, 1.0)
        emu = inch * 914400
        return int(emu)

    prs = Presentation()
    prs.slide_width = px_to_emu(img_width_px)
    prs.slide_height = px_to_emu(img_height_px)
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    left = top = 0
    for img_path in paths:
        slide.shapes.add_picture(
            img_path, left, top, width=px_to_emu(img_width_px), height=px_to_emu(img_height_px)
        )
    out = Path(tempfile.mkdtemp()) / "layers.pptx"
    prs.save(str(out))
    return out


def imagelist_to_psd(img_files: list[str | Path]) -> Path:
    """From qwen-image-layered/src/app.py — RGBA pixel layers bottom→top."""
    try:
        from psd_tools import PSDImage
    except ImportError as exc:  # optional dep (qwen README: pip install psd-tools)
        raise RuntimeError(
            "psd export requires psd-tools (pip install psd-tools); other formats still work"
        ) from exc

    layers = [Image.open(str(p)).convert("RGBA") for p in img_files]
    width, height = layers[0].size
    psd = PSDImage.new(mode="RGBA", size=(width, height))
    for i, img in enumerate(layers):
        name = f"Layer {i + 1}"
        layer = psd.create_pixel_layer(image=img, name=name)
        psd.append(layer)
    out = Path(tempfile.mkdtemp()) / "layers.psd"
    psd.save(str(out))
    return out


def export_layers(
    project_root: Path | str,
    layers: list[Layer],
    out_dir: Path | str,
    formats: tuple[str, ...] = ("png-seq", "zip", "composite"),
) -> list[Path]:
    """Write export artifacts under out_dir. Returns created paths.

    formats: png-seq | zip | composite | pptx | psd
    """
    root = Path(project_root)
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    ordered = sort_layers_bottom_to_top(layers)
    created: list[Path] = []
    wanted = set(formats)

    seq_paths: list[Path] = []
    if wanted & {"png-seq", "zip", "pptx", "psd"}:
        for index, layer in enumerate(ordered):
            src = layer.resolved_path(root)
            if not src.is_file():
                raise FileNotFoundError(f"layer file not found: {src}")
            target = dest / f"{index:02d}_{layer.id}.png"
            img = Image.open(src).convert("RGBA")
            img.save(target)
            seq_paths.append(target)
            if "png-seq" in wanted:
                created.append(target)

    if "zip" in wanted:
        zip_path = dest / "layers.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for path in seq_paths:
                zf.write(path, arcname=path.name)
        created.append(zip_path)

    if "composite" in wanted:
        composite = compose_layers(root, ordered)
        composite_path = dest / "composite.png"
        composite.save(composite_path)
        created.append(composite_path)

    if "pptx" in wanted and seq_paths:
        created.append(imagelist_to_pptx(seq_paths))

    if "psd" in wanted and seq_paths:
        created.append(imagelist_to_psd(seq_paths))

    return created
