"""Local Qwen-Image-Layered inference — copied from reference/qwen-image-layered/src/app.py.

``infer_layers`` mirrors app.py ``infer()`` (pipeline kwargs + layer PNG dump).
Import is lazy so the package works without torch/diffusers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .providers import LayeredDecomposeParams


def infer_layers(
    image_path: Path | str,
    out_dir: Path | str,
    params: LayeredDecomposeParams,
    *,
    model_id: str = "Qwen/Qwen-Image-Layered",
    device: str = "cuda",
    dtype_name: str = "bfloat16",
    local_files_only: bool = False,
) -> list[str]:
    """Run QwenImageLayeredPipeline (app.py infer) and save layer_00.png …"""
    import random

    import torch
    from diffusers import QwenImageLayeredPipeline
    from PIL import Image

    MAX_SEED = 2**31 - 1
    dtype = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }.get(dtype_name, torch.bfloat16)

    pipeline = QwenImageLayeredPipeline.from_pretrained(
        model_id, torch_dtype=dtype, local_files_only=local_files_only
    )
    pipeline = pipeline.to(device, dtype)
    pipeline.set_progress_bar_config(disable=None)

    seed = params.seed
    if params.randomize_seed:
        seed = random.randint(0, MAX_SEED)

    pil_image = Image.open(str(image_path)).convert("RGB").convert("RGBA")

    # app.py infer() input block
    inputs: dict[str, Any] = {
        "image": pil_image,
        "generator": torch.Generator(device=device).manual_seed(seed),
        "true_cfg_scale": params.true_guidance_scale,
        "prompt": params.prompt,
        "negative_prompt": params.neg_prompt,
        "num_inference_steps": params.num_inference_steps,
        "num_images_per_prompt": 1,
        "layers": params.layer,
        "resolution": params.resolution,
        "cfg_normalize": params.cfg_normalize,
        "use_en_prompt": params.use_en_prompt,
    }

    with torch.inference_mode():
        output = pipeline(**inputs)
        output_images = output.images[0]

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files: list[str] = []
    for i, image in enumerate(output_images):
        name = f"layer_{i:02d}.png"
        image.save(str(out / name))
        files.append(name)
    return files
