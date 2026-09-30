"""Export layer assets: zip of ordered PNGs, PNG sequence, composite-only."""

from __future__ import annotations

import zipfile
from pathlib import Path

from PIL import Image

from .compose import compose_layers
from .layers import Layer, sort_layers_bottom_to_top


def export_layers(
    project_root: Path | str,
    layers: list[Layer],
    out_dir: Path | str,
    formats: tuple[str, ...] = ("png-seq", "zip", "composite"),
) -> list[Path]:
    """Write export artifacts under out_dir. Returns created paths.

    formats:
      - png-seq: 00_<id>.png, 01_<id>.png ... bottom→top
      - zip:     layers.zip containing the same ordered PNGs
      - composite: composite.png
    """
    root = Path(project_root)
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    ordered = sort_layers_bottom_to_top(layers)
    created: list[Path] = []
    wanted = set(formats)

    seq_paths: list[Path] = []
    if "png-seq" in wanted or "zip" in wanted:
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

    return created
