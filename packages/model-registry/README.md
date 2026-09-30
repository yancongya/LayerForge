# model-registry

LayerForge 模型能力与参数注册表。**MVP 仅 mock，不加载真实权重。**

参数字段对齐 `reference/qwen-image-layered/src/app.py` 的 `infer()`：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `prompt` | `None` | 整体内容描述 |
| `neg_prompt` | `" "` | 负向提示 |
| `true_guidance_scale` | `4.0` | README 中 `true_cfg_scale` |
| `num_inference_steps` | `50` | 推理步数 |
| `layer` | `4` | 层数（pipeline kwargs 名：`layers`） |
| `resolution` | `640` | 桶分辨率 640/1024 |
| `cfg_normalize` | `True` | app.py 名：`cfg_norm` |
| `use_en_prompt` | `True` | 自动英文 caption |
| `seed` | `777` | 随机种子 |
| `randomize_seed` | `False` | 是否随机种子 |
| `num_images_per_prompt` | `1` | 每 prompt 图像数 |

## Provider

| id | kind | status |
| --- | --- | --- |
| `mock/layered-v0` | layered-decompose | mock |
| `mock/layer-edit-v0` | layer-edit | mock |
| `local/layer-combine-v0` | layer-combine | available（走 layer-core） |

## 本地验收

```powershell
$env:PYTHONPATH = "packages/model-registry"
python -m model_registry.cli list
python -m model_registry.cli describe mock/layered-v0
python -m model_registry.cli params
```
