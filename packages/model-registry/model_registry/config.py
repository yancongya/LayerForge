"""Model / provider configuration for LayerForge.

Config file (first hit wins):
  1. $LAYERFORGE_MODELS_JSON
  2. <repo>/config/models.json
  3. <repo>/models.json

Shape:
{
  "active": "http/decompose" | "local/qwen-layered" | "mock/layered-v0",
  "providers": {
    "http/decompose": {
      "kind": "http",
      "base_url": "http://127.0.0.1:8000/v1",
      "api_key_env": "LAYERFORGE_API_KEY",
      "endpoint": "/decompose",
      "timeout_s": 120
    },
    "local/qwen-layered": {
      "kind": "local",
      "model_id": "Qwen/Qwen-Image-Layered",
      "device": "cuda",
      "dtype": "bfloat16"
    }
  }
}
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


class ModelConfigError(ValueError):
    pass


@dataclass
class HttpProviderConfig:
    id: str
    kind: Literal["http"] = "http"
    base_url: str = ""
    api_key_env: str = "LAYERFORGE_API_KEY"
    endpoint: str = "/decompose"
    timeout_s: float = 120.0
    headers: dict[str, str] = field(default_factory=dict)

    def resolve_api_key(self) -> str | None:
        return os.environ.get(self.api_key_env) or None


@dataclass
class LocalProviderConfig:
    id: str
    kind: Literal["local"] = "local"
    model_id: str = "Qwen/Qwen-Image-Layered"
    device: str = "cuda"
    dtype: str = "bfloat16"
    local_files_only: bool = False


@dataclass
class MockProviderConfig:
    id: str
    kind: Literal["mock"] = "mock"


ProviderConfig = HttpProviderConfig | LocalProviderConfig | MockProviderConfig


@dataclass
class ModelConfig:
    active: str
    providers: dict[str, ProviderConfig]

    def active_provider(self) -> ProviderConfig:
        p = self.providers.get(self.active)
        if p is None:
            raise ModelConfigError(f"active provider not in providers: {self.active}")
        return p


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_config_paths() -> list[Path]:
    env = os.environ.get("LAYERFORGE_MODELS_JSON")
    paths: list[Path] = []
    if env:
        paths.append(Path(env))
    root = _repo_root()
    paths.append(root / "config" / "models.json")
    paths.append(root / "models.json")
    return paths


def load_model_config(path: Path | None = None) -> ModelConfig:
    raw_path: Path | None = path
    if raw_path is None:
        for cand in default_config_paths():
            if cand.is_file():
                raw_path = cand
                break
    if raw_path is None or not raw_path.is_file():
        # default to mock so decompose still works offline
        return ModelConfig(
            active="mock/layered-v0",
            providers={"mock/layered-v0": MockProviderConfig(id="mock/layered-v0")},
        )
    try:
        data = json.loads(raw_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModelConfigError(f"cannot read {raw_path}: {exc}") from exc
    return parse_model_config(data)


def parse_model_config(data: dict[str, Any]) -> ModelConfig:
    if not isinstance(data, dict):
        raise ModelConfigError("config must be an object")
    active = data.get("active")
    if not active or not isinstance(active, str):
        raise ModelConfigError("config.active is required")
    raw_providers = data.get("providers") or {}
    if not isinstance(raw_providers, dict):
        raise ModelConfigError("config.providers must be an object")
    providers: dict[str, ProviderConfig] = {}
    for pid, spec in raw_providers.items():
        if not isinstance(spec, dict):
            raise ModelConfigError(f"provider {pid} must be an object")
        kind = spec.get("kind", "mock")
        if kind == "http":
            providers[pid] = HttpProviderConfig(
                id=pid,
                base_url=str(spec.get("base_url") or ""),
                api_key_env=str(spec.get("api_key_env") or "LAYERFORGE_API_KEY"),
                endpoint=str(spec.get("endpoint") or "/decompose"),
                timeout_s=float(spec.get("timeout_s") or 120),
                headers=dict(spec.get("headers") or {}),
            )
        elif kind == "local":
            providers[pid] = LocalProviderConfig(
                id=pid,
                model_id=str(spec.get("model_id") or "Qwen/Qwen-Image-Layered"),
                device=str(spec.get("device") or "cuda"),
                dtype=str(spec.get("dtype") or "bfloat16"),
                local_files_only=bool(spec.get("local_files_only") or False),
            )
        elif kind == "mock":
            providers[pid] = MockProviderConfig(id=pid)
        else:
            raise ModelConfigError(f"unknown provider kind: {kind}")
    if active not in providers:
        providers[active] = MockProviderConfig(id=active)
    return ModelConfig(active=active, providers=providers)


def save_model_config(cfg: ModelConfig, path: Path | None = None) -> Path:
    out = path or (_repo_root() / "config" / "models.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {"active": cfg.active, "providers": {}}
    for pid, p in cfg.providers.items():
        if isinstance(p, HttpProviderConfig):
            payload["providers"][pid] = {
                "kind": "http",
                "base_url": p.base_url,
                "api_key_env": p.api_key_env,
                "endpoint": p.endpoint,
                "timeout_s": p.timeout_s,
                "headers": p.headers,
            }
        elif isinstance(p, LocalProviderConfig):
            payload["providers"][pid] = {
                "kind": "local",
                "model_id": p.model_id,
                "device": p.device,
                "dtype": p.dtype,
                "local_files_only": p.local_files_only,
            }
        else:
            payload["providers"][pid] = {"kind": "mock"}
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out
