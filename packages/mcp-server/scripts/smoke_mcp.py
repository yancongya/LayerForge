"""Smoke-test the LayerForge MCP server over stdio.

Run from repo root:
  $env:PYTHONPATH = "packages/mcp-server;packages/layer-core"
  python packages/mcp-server/scripts/smoke_mcp.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def send(proc: subprocess.Popen[str], payloads: list[dict]) -> list[dict]:
    lines = [json.dumps(item) for item in payloads]
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write("\n".join(lines) + "\n")
    proc.stdin.flush()
    out = []
    for _ in payloads:
        line = proc.stdout.readline()
        if not line:
            break
        out.append(json.loads(line))
    return out


def main() -> int:
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [
            str(REPO_ROOT / "packages" / "mcp-server"),
            str(REPO_ROOT / "packages" / "layer-core"),
            env.get("PYTHONPATH", ""),
        ]
    )
    proc = subprocess.Popen(
        [sys.executable, "-m", "layerforge_mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        cwd=str(REPO_ROOT),
        env=env,
    )
    project = str(REPO_ROOT / "projects" / "demo")
    responses = send(
        proc,
        [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "smoke", "version": "0"},
                },
            },
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "get_layers", "arguments": {"project": project}},
            },
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "compose", "arguments": {"project": project}},
            },
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "export_layers",
                    "arguments": {"project": project, "out_dir": str(REPO_ROOT / "projects" / "demo" / "dist-mcp")},
                },
            },
        ],
    )
    proc.stdin.close()
    proc.wait(timeout=30)

    assert responses[0]["result"]["serverInfo"]["name"] == "layerforge"
    tools = {t["name"] for t in responses[1]["result"]["tools"]}
    expected = {"ping", "get_layers", "reorder_layers", "compose", "export_layers", "decompose"}
    assert expected <= tools, tools
    assert responses[2]["result"]["isError"] is False
    assert responses[3]["result"]["isError"] is False
    assert responses[4]["result"]["isError"] is False
    print("smoke ok")
    for item in responses:
        print(json.dumps(item, ensure_ascii=False)[:200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
