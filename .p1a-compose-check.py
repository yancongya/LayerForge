import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(r"F:\LayerForge")
TMP = REPO / ".tmp-lf-test"
PROJ = TMP / "demo"
os.environ["PYTHONPATH"] = str(REPO / "packages" / "layer-core") + os.pathsep + os.environ.get("PYTHONPATH", "")


def cli(*args: str) -> str:
    proc = subprocess.run(
        [sys.executable, "-m", "layer_core.cli", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return proc.stdout.strip()


def main() -> int:
    if TMP.exists():
        shutil.rmtree(TMP)
    shutil.copytree(REPO / "projects" / "demo", PROJ)

    # subset compose
    out = cli("compose", str(PROJ), "--ids", "base,fg", "--output", "subset.png")
    subset = PROJ / "subset.png"
    assert subset.is_file(), out
    full = cli("compose", str(PROJ), "--output", "composite.png")
    assert (PROJ / "composite.png").is_file()
    assert subset.read_bytes() != (PROJ / "composite.png").read_bytes()

    # group compose
    cli("group", str(PROJ), "base,mid", "--name", "G")
    doc = __import__("json").loads((PROJ / "layers.json").read_text(encoding="utf-8"))
    gid = doc["groups"][0]["id"]
    cli("compose", str(PROJ), "--group", gid)
    gp = PROJ / "groups" / f"{gid}.png"
    assert gp.is_file(), f"missing {gp}"

    # hidden member drops out of group preview
    before = gp.read_bytes()
    cli("flag", str(PROJ), "mid", "--visible", "0")
    cli("compose", str(PROJ), "--group", gid)
    after = gp.read_bytes()
    assert before != after, "visible=false member still in group preview"

    print("P1-A compose subset/group PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
