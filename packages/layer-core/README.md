# layer-core

LayerForge 分层合成核心：`layers.json` 读写 + bottom→top `alpha_composite`。

合成逻辑改编自 `reference/qwen-image-layered/src/tool/combine_layers.py`。

## layers.json

```json
{
  "version": 1,
  "layers": [
    { "id": "bg", "name": "Background", "file": "layers/bg.png", "order": 0 },
    { "id": "mid", "name": "Subject", "file": "layers/mid.png", "order": 1 },
    { "id": "fg", "name": "Label", "file": "layers/fg.png", "order": 2 }
  ]
}
```

- `order`：0 在最底，数字越大越靠上
- `file`：相对项目根目录
- `id` 必须唯一

## CLI

在仓库根目录执行（把 `packages/layer-core` 加入 `PYTHONPATH`）：

```powershell
$env:PYTHONPATH = "packages/layer-core"
python -m layer_core.cli list projects/demo
python -m layer_core.cli compose projects/demo
python -m layer_core.cli reorder projects/demo bg,fg,mid
python -m layer_core.cli export projects/demo --out projects/demo/dist
```

成功时 `compose` 会打印 `composite.png` 的绝对路径。
