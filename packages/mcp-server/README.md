# mcp-server

LayerForge MCP 工具服务（stdio JSON-RPC）。

架构对照 `reference/designjs/packages/mcp-server`：

- **无状态**：不在进程内持有设计状态
- **文件系统为真源**：项目目录里 `layers.json` + PNG 是唯一事实
- **schema 单一来源**：工具名与 input schema 在 `layerforge_mcp/tools.py` 的 `TOOLS` 表中注册

与 designjs 的差异：MVP 不做 WebSocket bridge，工具直接读写项目目录。

## 工具

| 工具 | 作用 |
| --- | --- |
| `ping` | 健康检查 |
| `get_layers` | 读 `layers.json`，bottom→top 返回 |
| `reorder_layers` | 按 id 列表重写 order |
| `compose` | 合成 `composite.png` |
| `export_layers` | 导出 png-seq / zip / composite |
| `decompose` | **Mock** 分层（不加载真模型） |

## 本地运行

```powershell
# 仓库根目录
$env:PYTHONPATH = "packages/mcp-server;packages/layer-core"
python -m layerforge_mcp
```

调试单次调用：

```powershell
@'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_layers","arguments":{"project":"projects/demo"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"compose","arguments":{"project":"projects/demo"}}}
'@ | python -m layerforge_mcp
```

或运行自带冒烟脚本：

```powershell
$env:PYTHONPATH = "packages/mcp-server;packages/layer-core"
python packages/mcp-server/scripts/smoke_mcp.py
```

## 注册到 MCP 客户端（示意）

```json
{
  "mcpServers": {
    "layerforge": {
      "command": "python",
      "args": ["-m", "layerforge_mcp"],
      "env": {
        "PYTHONPATH": "packages/mcp-server;packages/layer-core"
      }
    }
  }
}
```
