"""P0-B1 layer-core regression check (temp copy; never touches projects/demo)."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
TMP = REPO / ".tmp-lf-test"
PROJ = TMP / "demo"
ENV_PY = str(REPO / "packages" / "layer-core")
os.environ["PYTHONPATH"] = ENV_PY + os.pathsep + os.environ.get("PYTHONPATH", "")


def cli(*args: str) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        [sys.executable, "-m", "layer_core.cli", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(f"cli failed: {args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return proc


def doc() -> dict:
    return json.loads((PROJ / "layers.json").read_text(encoding="utf-8"))


def composite_hash() -> str:
    cli("compose", str(PROJ))
    return hashlib.sha256((PROJ / "composite.png").read_bytes()).hexdigest()


def main() -> int:
    if TMP.exists():
        shutil.rmtree(TMP)
    shutil.copytree(REPO / "projects" / "demo", PROJ)
    checks: list[str] = []

    # v2 file still loads, and the first save upgrades it to v3 with new fields
    cli("rename", str(PROJ), "base", "底板")
    d = doc()
    assert d["version"] == 3, d["version"]
    assert d["rev"] == 1, d["rev"]
    base = next(layer for layer in d["layers"] if layer["id"] == "base")
    assert base["name"] == "底板", base
    for key in ("x", "y", "w", "h", "imgW", "imgH", "visible", "locked"):
        assert key in base, f"missing {key}"
    checks.append("v2→v3 升级 + rename 落盘")

    # rev is monotonic across writers
    cli("flag", str(PROJ), "mid", "--visible", "0")
    assert doc()["rev"] == 2, doc()["rev"]
    mid = next(layer for layer in doc()["layers"] if layer["id"] == "mid")
    assert mid["visible"] is False, mid
    checks.append("rev 单调 + flag 落盘")

    # compose honors visible
    with_all = composite_hash()
    cli("flag", str(PROJ), "mid", "--visible", "1")
    with_mid = composite_hash()
    assert with_all != with_mid, "hiding a layer did not change the composite"
    checks.append("visible=false 时合成确实少一层")

    # canvas layout persists but is not read by compose
    before = composite_hash()
    cli("layout", str(PROJ), json.dumps({"layers": [{"id": "base", "x": 999, "y": -500, "w": 300, "h": 400}]}))
    stored = next(layer for layer in doc()["layers"] if layer["id"] == "base")
    assert (stored["x"], stored["y"], stored["w"], stored["h"]) == (999.0, -500.0, 300.0, 400.0), stored
    assert composite_hash() == before, "canvas geometry leaked into compose"
    checks.append("layout 落盘且不影响合成")

    # unknown ids in layout must fail loudly
    bad = subprocess.run(
        [sys.executable, "-m", "layer_core.cli", "layout", str(PROJ), '{"layers":[{"id":"nope","x":1}]}'],
        cwd=REPO, capture_output=True, text=True,
    )
    assert bad.returncode == 1 and "unknown layer id" in bad.stderr, bad.stderr
    checks.append("layout 未知 id 报错")

    # group keeps member geometry, ungroup restores it exactly
    cli("layout", str(PROJ), json.dumps({"layers": [
        {"id": "mid", "x": 400, "y": 120}, {"id": "fg", "x": 700, "y": 30},
    ]}))
    pre = {layer["id"]: (layer["x"], layer["y"]) for layer in doc()["layers"]}
    cli("group", str(PROJ), "mid,fg", "--name", "叠加组")
    d = doc()
    group = d["groups"][0]
    assert group["collapsed"] is True, group
    assert group["imgW"] == 720 and group["w"] == 280 and group["h"] == 373, group
    assert (group["x"], group["y"]) == (400.0, 30.0), f"group card should sit where the stack was: {group}"
    members = {layer["id"]: (layer["x"], layer["y"]) for layer in d["layers"] if layer["groupId"] == group["id"]}
    assert members == {"mid": pre["mid"], "fg": pre["fg"]}, f"grouping destroyed member layout: {members}"
    cli("ungroup", str(PROJ), group["id"])
    d = doc()
    assert d["groups"] == [], d["groups"]
    post = {layer["id"]: (layer["x"], layer["y"]) for layer in d["layers"]}
    assert all(layer["groupId"] is None for layer in d["layers"]), d["layers"]
    assert post["mid"] == pre["mid"] and post["fg"] == pre["fg"], f"ungroup did not restore layout: {post}"
    checks.append("组卡带几何、成员几何不被销毁、解组原位复原")

    # delete renumbers order and dissolves short groups
    cli("group", str(PROJ), "mid,fg")
    gid = doc()["groups"][0]["id"]
    cli("delete", str(PROJ), "fg")
    d = doc()
    ids = [layer["id"] for layer in sorted(d["layers"], key=lambda l: l["order"])]
    assert "fg" not in ids, ids
    assert [layer["order"] for layer in sorted(d["layers"], key=lambda l: l["order"])] == list(range(len(ids))), d["layers"]
    assert d["groups"] == [], "group should dissolve below 2 members"
    assert all(layer["groupId"] is None for layer in d["layers"]), d["layers"]
    checks.append("delete 重排 order + 解散小组")

    # decompose writes aspect-correct cards and a top-row layout
    rev_before = doc()["rev"]
    cli("decompose", str(PROJ), "--source", str(PROJ / "source.png"), "--layers", "3")
    d = doc()
    assert d["rev"] >= rev_before, f"re-decompose rewound rev {rev_before} → {d['rev']}"
    layers = sorted(d["layers"], key=lambda l: l["order"])
    assert layers[0]["imgW"] == 720 and layers[0]["imgH"] == 960, layers[0]
    assert layers[0]["w"] == 280 and layers[0]["h"] == 373, layers[0]
    assert layers[1]["x"] > layers[0]["x"] and layers[0]["y"] == layers[1]["y"] == 0, layers
    assert d["rev"] >= 1, d["rev"]
    checks.append("decompose 落盘真实比例 + 顶行排布")

    # square source must NOT be squashed into 3:4
    from PIL import Image

    square = TMP / "square.png"
    Image.new("RGB", (960, 960), (200, 30, 30)).save(square)
    sq_proj = TMP / "sq"
    sq_proj.mkdir()
    shutil.copy(REPO / "projects" / "demo" / "layers.json", sq_proj / "layers.json")
    cli("decompose", str(sq_proj), "--source", str(square), "--layers", "2")
    sq = sorted(doc_file(sq_proj / "layers.json")["layers"], key=lambda l: l["order"])[0]
    assert (sq["imgW"], sq["imgH"]) == (960, 960), sq
    assert sq["w"] == 280 and sq["h"] == 280, f"square image got a {sq['w']}x{sq['h']} card"
    checks.append("960×960 源图 → 280×280 卡（不再拉伸）")

    print("PASS")
    for line in checks:
        print("  -", line)
    return 0


def doc_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    raise SystemExit(main())
