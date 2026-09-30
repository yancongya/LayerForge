"""Run layered decompose via the configured provider (mock | http | local).

Does not import torch/diffusers at module import time — local kind loads lazily
and falls back to mock when weights/GPU are unavailable.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .config import (
    HttpProviderConfig,
    LocalProviderConfig,
    MockProviderConfig,
    ModelConfig,
    load_model_config,
)
from .providers import LayeredDecomposeParams, build_decompose_params


class DecomposeError(RuntimeError):
    pass


def run_decompose(
    source: Path | str,
    out_dir: Path | str,
    params: dict[str, Any] | LayeredDecomposeParams | None = None,
    config: ModelConfig | None = None,
) -> dict[str, Any]:
    """Write RGBA layer PNGs into ``out_dir``. Returns provider metadata + file list."""
    cfg = config or load_model_config()
    p = params if isinstance(params, LayeredDecomposeParams) else build_decompose_params(params)
    provider = cfg.active_provider()
    src = Path(source)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    if isinstance(provider, HttpProviderConfig):
        return _run_http(provider, src, out, p)
    if isinstance(provider, LocalProviderConfig):
        try:
            return _run_local(provider, src, out, p)
        except Exception as exc:  # noqa: BLE001 — fall back to mock
            mock = _run_mock(src, out, p)
            mock["fallback_reason"] = str(exc)
            mock["provider"] = f"{provider.id}→mock/layered-v0"
            return mock
    return _run_mock(src, out, p)


def _layer_paths(out: Path) -> list[str]:
    return sorted(str(p.name) for p in out.glob("*.png"))


def _ensure_layer_core() -> None:
    import sys

    cand = Path(__file__).resolve().parents[2] / "layer-core"
    if cand.is_dir():
        text = str(cand)
        if text not in sys.path:
            sys.path.insert(0, text)


def _run_mock(src: Path, out: Path, p: LayeredDecomposeParams) -> dict[str, Any]:
    _ensure_layer_core()
    from layer_core.decompose import mock_decompose  # type: ignore

    # mock_decompose writes layers/ + layers.json inside a project root.
    # Here we only need PNGs in out/: call it on a temp project then copy names.
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "proj"
        root.mkdir(parents=True)
        mock_decompose(root, src, layer_count=max(2, min(5, p.layer)))
        for f in (root / "layers").glob("*.png"):
            shutil.copy2(f, out / f.name)
    return {
        "provider": "mock/layered-v0",
        "status": "mock",
        "params": {
            "layer": p.layer,
            "seed": p.seed,
            "resolution": p.resolution,
            "num_inference_steps": p.num_inference_steps,
        },
        "files": _layer_paths(out),
    }


def _run_http(
    provider: HttpProviderConfig,
    src: Path,
    out: Path,
    p: LayeredDecomposeParams,
) -> dict[str, Any]:
    import base64

    if not provider.base_url:
        raise DecomposeError("http provider missing base_url")
    url = provider.base_url.rstrip("/") + "/" + provider.endpoint.lstrip("/")
    key = provider.resolve_api_key()
    body = {
        "image_b64": base64.b64encode(src.read_bytes()).decode("ascii"),
        "filename": src.name,
        **p.to_pipeline_kwargs(),
    }
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", **provider.headers}
    if key:
        headers.setdefault("Authorization", f"Bearer {key}")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=provider.timeout_s) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise DecomposeError(f"http decompose failed: {exc}") from exc

    layers = payload.get("layers") or payload.get("images") or []
    files: list[str] = []
    for i, item in enumerate(layers):
        if isinstance(item, dict):
            name = item.get("name") or f"layer_{i:02d}.png"
            b64 = item.get("b64") or item.get("data")
        else:
            name = f"layer_{i:02d}.png"
            b64 = item
        if not b64:
            continue
        raw = base64.b64decode(b64)
        (out / name).write_bytes(raw)
        files.append(name)
    if not files:
        raise DecomposeError("http decompose returned no layers")
    return {
        "provider": provider.id,
        "status": "http",
        "files": files,
        "raw_status": payload.get("status"),
    }


def _run_local(
    provider: LocalProviderConfig,
    src: Path,
    out: Path,
    p: LayeredDecomposeParams,
) -> dict[str, Any]:
    import torch
    from diffusers import QwenImageLayeredPipeline
    from PIL import Image

    dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}.get(
        provider.dtype, torch.bfloat16
    )
    pipe = QwenImageLayeredPipeline.from_pretrained(
        provider.model_id,
        torch_dtype=dtype,
        local_files_only=provider.local_files_only,
    )
    device = provider.device
    pipe = pipe.to(device)
    image = Image.open(src).convert("RGBA")
    gen = torch.Generator(device=device).manual_seed(int(p.seed))
    inputs = p.to_pipeline_kwargs()
    inputs["image"] = image
    inputs["generator"] = gen
    # map registry names → pipeline
    inputs.setdefault("negative_prompt", p.neg_prompt)
    with torch.inference_mode():
        output = pipe(**inputs)
    images = output.images[0] if isinstance(output.images, (list, tuple)) else [output.images]
    files: list[str] = []
    for i, img in enumerate(images):
        name = f"layer_{i:02d}.png"
        img.save(out / name)
        files.append(name)
    return {
        "provider": provider.id,
        "status": "local",
        "model_id": provider.model_id,
        "files": files,
    }
