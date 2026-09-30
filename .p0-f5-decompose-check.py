"""F5: re-decompose with a different source must refresh layer images (no stale cache)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent
TMP = REPO / ".tmp-lf-test"
PROJ = TMP / "demo"
ENV_PY = str(REPO / "packages" / "layer-core")
os.environ["PYTHONPATH"] = ENV_PY + os.pathsep + os.environ.get("PYTHONPATH", "")


def cli(*args: str) -> str:
    proc = subprocess.run(
        [sys.executable, "-m", "layer_core.cli", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"{args}\n{proc.stderr or proc.stdout}"
    return proc.stdout.strip()


def make_src(path: Path, size: tuple[int, int], color: tuple[int, int, int]) -> None:
    Image.new("RGB", size, color).save(path)


def layer_urls(rev: int, ids: list[str]) -> dict[str, str]:
    return {i: f"layers/{i}.png?v={rev}" for i in ids}


def main() -> int:
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    PROJ.mkdir(parents=True)

    src_a = TMP / "a.png"
    src_b = TMP / "b.png"
    make_src(src_a, (720, 960), (200, 40, 40))
    make_src(src_b, (1200, 800), (40, 80, 200))  # different aspect

    cli("decompose", str(PROJ), "--source", str(src_a), "--layers", "3")
    doc1 = json.loads((PROJ / "layers.json").read_text(encoding="utf-8"))
    rev1 = doc1["rev"]
    ids1 = [l["id"] for l in doc1["layers"]]
    sizes1 = [(l["id"], l["imgW"], l["imgH"], l["w"], l["h"]) for l in doc1["layers"]]
    png1 = (PROJ / "layers" / "base.png").read_bytes()

    # second decompose, different image
    cli("decompose", str(PROJ), "--source", str(src_b), "--layers", "3")
    doc2 = json.loads((PROJ / "layers.json").read_text(encoding="utf-8"))
    rev2 = doc2["rev"]
    ids2 = [l["id"] for l in doc2["layers"]]
    sizes2 = [(l["id"], l["imgW"], l["imgH"], l["w"], l["h"]) for l in doc2["layers"]]
    png2 = (PROJ / "layers" / "base.png").read_bytes()

    assert rev2 > rev1, f"rev must increase on re-decompose: {rev1} -> {rev2}"
    assert png1 != png2, "layer PNG bytes unchanged after re-decompose (stale cache)"

    # cache-buster must change so the browser refetches
    u1 = layer_urls(rev1, ids1)
    u2 = layer_urls(rev2, ids2)
    assert u1 != u2, f"layer urls unchanged: {u1} vs {u2}"

    # aspect follows the new source (1200x800 → w/h = 3/2, not 3/4)
    for lid, iw, ih, w, h in sizes2:
        assert iw == 1200 and ih == 800, (lid, iw, ih)
        assert abs((w / h) - (1200 / 800)) < 0.02, (lid, w, h)
        assert abs(h - (280 * 800 / 1200)) < 1.5, (lid, h)

    # 720x960 run was 3:4 cards
    for lid, iw, ih, w, h in sizes1:
        assert iw == 720 and ih == 960, (lid, iw, ih)
        assert abs((w / h) - (720 / 960)) < 0.02, (lid, w, h)

    print("F5 re-decompose PASS", {"rev1": rev1, "rev2": rev2, "ids": ids2, "sizes2": sizes2})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
