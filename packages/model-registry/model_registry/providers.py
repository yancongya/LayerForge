"""Model capability / parameter registry for LayerForge.

MVP: mock providers only. No weights are loaded.
Parameter field names and defaults are aligned with
reference/qwen-image-layered/src/app.py (QwenImageLayeredPipeline.infer).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


class ModelRegistryError(ValueError):
    pass


@dataclass
class LayeredDecomposeParams:
    """Params for image → multi-RGBA decomposition.

    Field names match Qwen-Image-Layered app.py infer() where applicable:
      image, prompt, neg_prompt, true_guidance_scale, num_inference_steps,
      layer, cfg_norm, use_en_prompt, seed, randomize_seed
    README extras kept for schema completeness: resolution, num_images_per_prompt
    """

    prompt: str | None = None
    neg_prompt: str = " "
    true_guidance_scale: float = 4.0
    num_inference_steps: int = 50
    layer: int = 4  # number of RGBA layers
    resolution: int = 640  # bucket: 640 | 1024
    cfg_normalize: bool = True  # app.py name: cfg_norm
    use_en_prompt: bool = True
    seed: int = 777
    randomize_seed: bool = False
    num_images_per_prompt: int = 1

    def to_pipeline_kwargs(self) -> dict[str, Any]:
        """Map registry fields to QwenImageLayeredPipeline call kwargs (README shape)."""
        return {
            "prompt": self.prompt,
            "negative_prompt": self.neg_prompt,
            "true_cfg_scale": self.true_guidance_scale,
            "num_inference_steps": self.num_inference_steps,
            "layers": self.layer,
            "resolution": self.resolution,
            "cfg_normalize": self.cfg_normalize,
            "use_en_prompt": self.use_en_prompt,
            "num_images_per_prompt": self.num_images_per_prompt,
            "seed": self.seed,
            "randomize_seed": self.randomize_seed,
        }


@dataclass
class LayeredEditParams:
    """Params for single-layer RGBA edit (Qwen-Image-Edit style). Mock only in MVP."""

    prompt: str | None = None
    neg_prompt: str = " "
    true_guidance_scale: float = 1.0
    num_inference_steps: int = 50
    seed: int = 42
    randomize_seed: bool = False


@dataclass
class ProviderSpec:
    id: str
    kind: Literal["layered-decompose", "layer-edit", "layer-combine"]
    display_name: str
    status: Literal["mock", "available", "unavailable"]
    description: str
    # JSON-schema-ish parameter description (not validated at runtime in MVP)
    params_schema: dict[str, Any] = field(default_factory=dict)
    notes: str = ""


# --- registry table ---------------------------------------------------------

PROVIDERS: dict[str, ProviderSpec] = {
    "mock/layered-v0": ProviderSpec(
        id="mock/layered-v0",
        kind="layered-decompose",
        display_name="Mock Layered Decompose",
        status="mock",
        description="Returns a 2-layer stub (base + accent). No ML weights loaded.",
        params_schema={
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "neg_prompt": {"type": "string", "default": " "},
                "true_guidance_scale": {"type": "number", "default": 4.0},
                "num_inference_steps": {"type": "integer", "default": 50},
                "layer": {"type": "integer", "default": 4, "description": "layer count"},
                "resolution": {"type": "integer", "enum": [640, 1024], "default": 640},
                "cfg_normalize": {"type": "boolean", "default": True},
                "use_en_prompt": {"type": "boolean", "default": True},
                "seed": {"type": "integer", "default": 777},
                "randomize_seed": {"type": "boolean", "default": False},
                "num_images_per_prompt": {"type": "integer", "default": 1},
            },
            "additionalProperties": False,
        },
        notes="Field names follow reference/qwen-image-layered/src/app.py infer().",
    ),
    "mock/layer-edit-v0": ProviderSpec(
        id="mock/layer-edit-v0",
        kind="layer-edit",
        display_name="Mock Layer Edit",
        status="mock",
        description="Placeholder for Qwen-Image-Edit style RGBA layer editing. Not implemented.",
        params_schema={
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "neg_prompt": {"type": "string", "default": " "},
                "true_guidance_scale": {"type": "number", "default": 1.0},
                "num_inference_steps": {"type": "integer", "default": 50},
                "seed": {"type": "integer", "default": 42},
                "randomize_seed": {"type": "boolean", "default": False},
            },
            "additionalProperties": False,
        },
    ),
    "local/layer-combine-v0": ProviderSpec(
        id="local/layer-combine-v0",
        kind="layer-combine",
        display_name="Local Alpha Composite",
        status="available",
        description="Pure PIL bottom→top alpha_composite (packages/layer-core). No model.",
        params_schema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "project directory"},
            },
            "required": ["project"],
            "additionalProperties": False,
        },
        notes="Implemented by layer_core.compose; listed here for capability discovery.",
    ),
}


def list_providers(kind: str | None = None) -> list[ProviderSpec]:
    items = list(PROVIDERS.values())
    if kind:
        items = [item for item in items if item.kind == kind]
    return items


def get_provider(provider_id: str) -> ProviderSpec:
    spec = PROVIDERS.get(provider_id)
    if spec is None:
        raise ModelRegistryError(f"unknown provider: {provider_id}")
    return spec


def describe_provider(provider_id: str) -> dict[str, Any]:
    return asdict(get_provider(provider_id))


def build_decompose_params(raw: dict[str, Any] | None = None) -> LayeredDecomposeParams:
    raw = raw or {}
    known = {item.name for item in LayeredDecomposeParams.__dataclass_fields__.values()}  # type: ignore[attr-defined]
    unknown = set(raw) - known
    if unknown:
        raise ModelRegistryError(f"unknown decompose params: {sorted(unknown)}")
    try:
        return LayeredDecomposeParams(**raw)
    except TypeError as exc:
        raise ModelRegistryError(str(exc)) from exc


def build_edit_params(raw: dict[str, Any] | None = None) -> LayeredEditParams:
    raw = raw or {}
    known = {item.name for item in LayeredEditParams.__dataclass_fields__.values()}  # type: ignore[attr-defined]
    unknown = set(raw) - known
    if unknown:
        raise ModelRegistryError(f"unknown edit params: {sorted(unknown)}")
    try:
        return LayeredEditParams(**raw)
    except TypeError as exc:
        raise ModelRegistryError(str(exc)) from exc


def mock_decompose_info(params: LayeredDecomposeParams) -> dict[str, Any]:
    """What MCP decompose should echo when using the mock provider."""
    return {
        "provider": "mock/layered-v0",
        "status": "mock",
        "params": asdict(params),
        "pipeline_kwargs_preview": params.to_pipeline_kwargs(),
        "note": "No QwenImageLayeredPipeline loaded in MVP",
    }
