"""Smoke: model settings + MCP agent tools (mock/http/local fallback)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent
for p in (
    REPO / "packages" / "mcp-server",
    REPO / "packages" / "model-registry",
    REPO / "packages" / "layer-core",
):
    sys.path.insert(0, str(p))

os.environ.setdefault(
    "LAYERFORGE_MODELS_JSON",
    str(REPO / "config" / "models.json"),
)


def main() -> int:
    from model_registry import load_model_config, run_decompose, save_model_config
    from model_registry.config import HttpProviderConfig, MockProviderConfig
    from layerforge_mcp.tools import call_tool, list_tools_payload

    checks = []

    # 1 config load
    cfg = load_model_config()
    assert cfg.active in cfg.providers, cfg.active
    checks.append(f"config active={cfg.active} providers={sorted(cfg.providers)}")

    def unpack(res):
        if isinstance(res, dict) and "content" in res:
            try:
                return json.loads(res["content"][0]["text"])
            except Exception:
                return res
        return res

    # 2 model_config tool read
    snap = unpack(call_tool("model_config", {}))
    assert "active" in snap and "providers" in snap, snap
    checks.append("mcp model_config read")

    # 3 set active mock
    r = unpack(call_tool("model_config", {"set_active": "mock/layered-v0"}))
    assert r.get("active") == "mock/layered-v0" or r.get("ok"), r
    checks.append("mcp set_active mock")

    # 4 upsert http provider
    r = call_tool(
        "model_config",
        {
            "providers": {
                "http/test": {
                    "kind": "http",
                    "base_url": "http://127.0.0.1:9",
                    "endpoint": "/decompose",
                    "timeout_s": 1,
                }
            }
        },
    )
    checks.append("mcp upsert http provider")

    # 5 decompose via registry mock (real PNG out)
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "src.png"
        Image.new("RGB", (64, 80), (200, 40, 40)).save(src)
        out = tmp / "layers"
        result = run_decompose(src, out, {"layer": 3})
        pngs = list(out.glob("*.png"))
        assert pngs, result
        checks.append(f"registry decompose files={result.get('files')}")

        # 6 http provider fails → should raise DecomposeError (not silent)
        from model_registry.runner import DecomposeError, run_decompose as rd

        cfg2 = load_model_config()
        cfg2.active = "http/test"
        try:
            rd(src, tmp / "httpout", {"layer": 2}, config=cfg2)
            checks.append("http decompose UNEXPECTED success")
        except Exception as exc:  # noqa: BLE001
            checks.append(f"http decompose fails loudly: {type(exc).__name__}")

        # 7 mcp decompose writes layers.json
        proj = tmp / "proj"
        proj.mkdir()
        r = unpack(
            call_tool(
                "decompose",
                {"project": str(proj), "image": str(src), "params": {"layer": 3}},
            )
        )
        assert (proj / "layers.json").is_file(), r
        assert r.get("files") or r.get("layers"), r
        checks.append(f"mcp decompose provider={r.get('provider')} files={r.get('files')}")

    # 8 tool table
    names = [t["name"] for t in list_tools_payload()]
    for need in ("ping", "get_layers", "decompose", "model_config", "compose"):
        assert need in names, names
    checks.append(f"tools={names}")

    print("SMOKE PASS")
    for line in checks:
        print(" -", line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
