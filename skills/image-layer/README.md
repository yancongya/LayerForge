# image-layer

LayerForge 功能型 skill：图层拆分/排序/合成/导出。

入口文档：[SKILL.md](SKILL.md)

## 本地验收

```powershell
# 从仓库根目录
$env:PYTHONPATH = "packages/layer-core"
python -m layer_core.cli compose projects/demo
```

或在支持 MCP 的客户端中注册 `packages/mcp-server` 后调用 `get_layers` / `compose`。

## 边界

- 不加载真实分层模型（见 `packages/model-registry` 的 mock）
- 不包含画布 UI
- 项目目录 + `layers.json` 为唯一真源
