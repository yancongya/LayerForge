"""LayerForge MCP server (stdio JSON-RPC).

Architecture mirrors reference/designjs/packages/mcp-server:
  agent (stdio) → this server (stateless) → filesystem project dir as source of truth

Unlike designjs there is no WebSocket bridge in the MVP: tools operate directly
on LayerForge project directories (layers.json + layer PNGs).

Protocol subset: initialize, tools/list, tools/call, ping/notifications.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from .tools import call_tool, list_tools_payload

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "layerforge", "version": "0.1.0"}


def _log(msg: str) -> None:
    sys.stderr.write(f"[layerforge-mcp] {msg}\n")
    sys.stderr.flush()


def _result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle_message(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    req_id = message.get("id")
    params = message.get("params") or {}

    # Notifications (no id) — acknowledge silently.
    if req_id is None and method and method.startswith("notifications/"):
        return None

    try:
        if method == "initialize":
            return _result(
                req_id,
                {
                    "protocolVersion": params.get("protocolVersion", PROTOCOL_VERSION),
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO,
                },
            )
        if method == "tools/list":
            return _result(req_id, {"tools": list_tools_payload()})
        if method == "tools/call":
            name = params.get("name")
            if not isinstance(name, str):
                return _error(req_id, -32602, "tools/call requires params.name")
            arguments = params.get("arguments")
            if arguments is not None and not isinstance(arguments, dict):
                return _error(req_id, -32602, "params.arguments must be an object")
            try:
                return _result(req_id, call_tool(name, arguments or {}))
            except Exception as exc:  # tool failures are results, not protocol errors
                return _result(
                    req_id,
                    {
                        "content": [{"type": "text", "text": f"error: {exc}"}],
                        "isError": True,
                    },
                )
        if method == "ping":
            return _result(req_id, {})
        return _error(req_id, -32601, f"method not found: {method}")
    except Exception as exc:
        _log(traceback.format_exc())
        return _error(req_id, -32000, str(exc))


def serve() -> int:
    _log("mcp server ready on stdio")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            _log(f"skip non-JSON line: {line[:80]!r}")
            continue
        if not isinstance(message, dict):
            continue
        response = handle_message(message)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


def main() -> int:
    return serve()


if __name__ == "__main__":
    raise SystemExit(main())
