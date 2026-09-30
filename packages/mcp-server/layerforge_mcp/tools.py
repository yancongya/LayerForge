"""MCP tool schemas and handlers for LayerForge.

Modeled on reference/designjs/packages/bridge/src/tools.ts:
- declare input/output shapes next to the tool name
- register from a single table so names and schemas cannot drift
- handlers are stateless; the project directory on disk is the source of truth
"""

from __future__ import annotations

import base64
import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

# layer_core lives in packages/layer-core
_LAYER_CORE_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "layer-core",
]


def _ensure_layer_core_on_path() -> None:
    import sys

    for path in _LAYER_CORE_CANDIDATES:
        text = str(path)
        if path.is_dir() and text not in sys.path:
            sys.path.insert(0, text)


_ensure_layer_core_on_path()

from layer_core.compose import compose_project  # noqa: E402
from layer_core.export import export_layers  # noqa: E402
from layer_core.layers import (  # noqa: E402
    Layer,
    load_layers,
    reorder_layers,
    save_layers,
    sort_layers_bottom_to_top,
)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]


def _ok(**kwargs: Any) -> dict[str, Any]:
    return kwargs


def _resolve_project(params: dict[str, Any]) -> Path:
    raw = params.get("project")
    if not raw or not isinstance(raw, str):
        raise ValueError("param 'project' is required (path to project directory)")
    root = Path(raw).expanduser()
    if not root.is_dir():
        raise ValueError(f"project directory not found: {root}")
    return root.resolve()


def _layer_dict(layer: Layer) -> dict[str, Any]:
    return {"id": layer.id, "name": layer.name, "file": layer.file, "order": layer.order}


def handle_get_layers(params: dict[str, Any]) -> Any:
    root = _resolve_project(params)
    layers = sort_layers_bottom_to_top(load_layers(root))
    return _ok(project=str(root), layers=[_layer_dict(layer) for layer in layers])


def handle_reorder_layers(params: dict[str, Any]) -> Any:
    root = _resolve_project(params)
    order = params.get("id_order")
    if not isinstance(order, list) or not all(isinstance(item, str) for item in order):
        raise ValueError("param 'id_order' must be an array of layer ids (bottom→top)")
    layers = load_layers(root)
    updated = reorder_layers(layers, order)
    save_layers(root, updated)
    return _ok(project=str(root), layers=[_layer_dict(layer) for layer in updated])


def handle_compose(params: dict[str, Any]) -> Any:
    root = _resolve_project(params)
    output = params.get("output") or "composite.png"
    if not isinstance(output, str) or not output.strip():
        raise ValueError("param 'output' must be a non-empty filename")
    out = compose_project(root, output_name=Path(output).name)
    return _ok(project=str(root), output=str(out))


def handle_export_layers(params: dict[str, Any]) -> Any:
    root = _resolve_project(params)
    raw_formats = params.get("formats") or ["png-seq", "zip", "composite"]
    if not isinstance(raw_formats, list) or not all(isinstance(item, str) for item in raw_formats):
        raise ValueError("param 'formats' must be an array of strings")
    allowed = {"png-seq", "zip", "composite", "pptx", "psd"}
    unknown = [item for item in raw_formats if item not in allowed]
    if unknown:
        raise ValueError(f"unknown formats: {unknown}; allowed={sorted(allowed)}")
    out_dir_raw = params.get("out_dir")
    if out_dir_raw:
        out_dir = Path(out_dir_raw).expanduser()
    else:
        out_dir = root / "dist"
    layers = load_layers(root)
    created = export_layers(root, layers, out_dir, formats=tuple(raw_formats))
    return _ok(project=str(root), out_dir=str(out_dir), files=[str(path) for path in created])


def _ensure_model_registry() -> None:
    import sys

    for cand in (
        Path(__file__).resolve().parents[2] / "model-registry",
        Path(__file__).resolve().parents[2] / "layer-core",
    ):
        text = str(cand)
        if cand.is_dir() and text not in sys.path:
            sys.path.insert(0, text)


def handle_decompose(params: dict[str, Any]) -> Any:
    """Decompose via model-registry (http | local | mock fallback)."""
    root = _resolve_project(params)
    source = params.get("image")
    if not source or not isinstance(source, str):
        raise ValueError("param 'image' is required (path to source image)")
    src = Path(source).expanduser()
    if not src.is_file():
        raise ValueError(f"image not found: {src}")

    _ensure_model_registry()
    from model_registry import run_decompose

    raw_params = params.get("params") or {}
    try:
        result = run_decompose(src, root / "layers", raw_params)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"decompose failed: {exc}") from exc

    # Rebuild layers.json from files actually on disk (semantic z-order).
    pngs = sorted((root / "layers").glob("*.png"), key=lambda p: p.name)
    if not pngs:
        raise ValueError("decompose produced no layer PNGs")
    rank = {"base": 0, "mid": 1, "fg": 2}
    ordered_pngs = sorted(pngs, key=lambda p: (rank.get(p.stem, 10), p.name))
    mock_layers = [
        Layer(id=p.stem, name=p.stem, file=f"layers/{p.name}", order=i)
        for i, p in enumerate(ordered_pngs)
    ]
    save_layers(root, mock_layers)

    layers = sort_layers_bottom_to_top(load_layers(root))
    return _ok(
        project=str(root),
        provider=result.get("provider"),
        status=result.get("status"),
        files=[p.name for p in ordered_pngs],
        fallback_reason=result.get("fallback_reason"),
        layers=[_layer_dict(layer) for layer in layers],
    )


def handle_model_config(params: dict[str, Any]) -> Any:
    """Read or update model provider config (local / http / mock)."""
    _ensure_model_registry()
    from model_registry import (
        HttpProviderConfig,
        LocalProviderConfig,
        ModelConfig,
        MockProviderConfig,
        load_model_config,
        save_model_config,
    )

    path = params.get("config_path")
    cfg = load_model_config(Path(path) if path else None)

    if params.get("set_active"):
        new_id = str(params["set_active"])
        if new_id not in cfg.providers:
            raise ValueError(f"unknown provider id: {new_id} (have {sorted(cfg.providers)})")
        cfg.active = new_id
        saved = save_model_config(cfg, Path(path) if path else None)
        return _ok(active=cfg.active, saved=str(saved))

    providers = params.get("providers")
    if providers and isinstance(providers, dict):
        for pid, spec in providers.items():
            kind = (spec or {}).get("kind", "mock")
            if kind == "http":
                cfg.providers[pid] = HttpProviderConfig(
                    id=pid,
                    base_url=str(spec.get("base_url") or ""),
                    api_key_env=str(spec.get("api_key_env") or "LAYERFORGE_API_KEY"),
                    endpoint=str(spec.get("endpoint") or "/decompose"),
                    timeout_s=float(spec.get("timeout_s") or 120),
                    headers=dict(spec.get("headers") or {}),
                )
            elif kind == "local":
                cfg.providers[pid] = LocalProviderConfig(
                    id=pid,
                    model_id=str(spec.get("model_id") or "Qwen/Qwen-Image-Layered"),
                    device=str(spec.get("device") or "cuda"),
                    dtype=str(spec.get("dtype") or "bfloat16"),
                    local_files_only=bool(spec.get("local_files_only") or False),
                )
            else:
                cfg.providers[pid] = MockProviderConfig(id=pid)
        saved = save_model_config(cfg, Path(path) if path else None)
        return _ok(active=cfg.active, saved=str(saved), providers=sorted(cfg.providers))

    # read-only snapshot
    snap = {
        "active": cfg.active,
        "providers": {
            pid: {
                "kind": getattr(p, "kind", "mock"),
                **(
                    {
                        "base_url": p.base_url,
                        "endpoint": p.endpoint,
                        "api_key_env": p.api_key_env,
                    }
                    if isinstance(p, HttpProviderConfig)
                    else {}
                ),
                **(
                    {
                        "model_id": p.model_id,
                        "device": p.device,
                        "dtype": p.dtype,
                    }
                    if isinstance(p, LocalProviderConfig)
                    else {}
                ),
            }
            for pid, p in cfg.providers.items()
        },
    }
    return _ok(**snap)


def handle_ping(params: dict[str, Any]) -> Any:
    return _ok(pong=True, at=time.time())


PROJECT_PROP = {
    "type": "string",
    "description": "Absolute or relative path to a LayerForge project directory containing layers.json",
}

TOOLS: list[ToolSpec] = [
    ToolSpec(
        name="ping",
        description="Health check; returns pong and timestamp.",
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
        handler=handle_ping,
    ),
    ToolSpec(
        name="get_layers",
        description="Read layers.json and return layers ordered bottom→top. Filesystem is the source of truth.",
        input_schema={
            "type": "object",
            "properties": {"project": PROJECT_PROP},
            "required": ["project"],
            "additionalProperties": False,
        },
        handler=handle_get_layers,
    ),
    ToolSpec(
        name="reorder_layers",
        description="Rewrite layers.json so id_order is bottom→top (0 painted first).",
        input_schema={
            "type": "object",
            "properties": {
                "project": PROJECT_PROP,
                "id_order": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Layer ids from bottom to top",
                },
            },
            "required": ["project", "id_order"],
            "additionalProperties": False,
        },
        handler=handle_reorder_layers,
    ),
    ToolSpec(
        name="compose",
        description="Alpha-composite layers bottom→top and write composite.png (or given output name) into the project.",
        input_schema={
            "type": "object",
            "properties": {
                "project": PROJECT_PROP,
                "output": {"type": "string", "description": "Output filename, default composite.png"},
            },
            "required": ["project"],
            "additionalProperties": False,
        },
        handler=handle_compose,
    ),
    ToolSpec(
        name="export_layers",
        description="Export ordered PNG sequence, layers.zip, and/or composite.png into out_dir (default <project>/dist).",
        input_schema={
            "type": "object",
            "properties": {
                "project": PROJECT_PROP,
                "out_dir": {"type": "string", "description": "Export directory; default <project>/dist"},
                "formats": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["png-seq", "zip", "composite", "pptx", "psd"]},
                    "description": "Default: png-seq, zip, composite. pptx/psd from qwen export writers.",
                },
            },
            "required": ["project"],
            "additionalProperties": False,
        },
        handler=handle_export_layers,
    ),
    ToolSpec(
        name="decompose",
        description="Layered decompose via model-registry (http | local | mock fallback). Writes layers/ + layers.json.",
        input_schema={
            "type": "object",
            "properties": {
                "project": PROJECT_PROP,
                "image": {"type": "string", "description": "Path to source image (png/jpg)"},
                "params": {
                    "type": "object",
                    "description": "Optional LayeredDecomposeParams (layer, seed, resolution, …)",
                },
            },
            "required": ["project", "image"],
            "additionalProperties": False,
        },
        handler=handle_decompose,
    ),
    ToolSpec(
        name="model_config",
        description="Read or update model provider settings (mock | http API | local Qwen weights). set_active switches provider; providers object upserts entries.",
        input_schema={
            "type": "object",
            "properties": {
                "config_path": {"type": "string", "description": "optional models.json path"},
                "set_active": {"type": "string", "description": "provider id to activate"},
                "providers": {
                    "type": "object",
                    "description": "map id → {kind: mock|http|local, ...}",
                },
            },
            "additionalProperties": False,
        },
        handler=handle_model_config,
    ),
]

TOOL_BY_NAME: dict[str, ToolSpec] = {tool.name: tool for tool in TOOLS}


def list_tools_payload() -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "inputSchema": tool.input_schema,
        }
        for tool in TOOLS
    ]


def call_tool(name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    tool = TOOL_BY_NAME.get(name)
    if tool is None:
        raise ValueError(f"unknown tool: {name}")
    result = tool.handler(arguments or {})
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(result, indent=2, ensure_ascii=False),
            }
        ],
        "isError": False,
    }
