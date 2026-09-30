# @layerforge/web

LayerForge 工作台 Web 入口（Vite + React + TS）。视觉/信息架构对照 `docs/od-ui-notes.md`。

## 复用说明（不要从零写）

| 来源 | 复用内容 | 本包职责 |
| --- | --- | --- |
| `reference/open-design/apps/web/src/styles/tokens.css` | 深色 token 色值/命名 | 仅布局 |
| `reference/open-design/.../viewer/routines.css` | `working-dir-pill` 胶囊尺寸 | 路径胶囊 |
| `reference/open-design/.../AppChromeHeader.tsx` / `shell.css` | 顶栏/壳结构 | 静态重排 |
| `packages/layer-core` | 合成/排序/导出 | **唯一写路径**（经 `/api`） |
| `projects/demo` | 示例项目数据 | 回写 `layers.json` |

不要只改前端内存——`order` 变更必须 `POST /api/projects/:id/reorder`。

## Run

```powershell
cd apps/web
npm install
npm run dev    # http://127.0.0.1:5173
npm run build
```

API 由 `vite-plugin-layerforge-api.ts` 挂载，shell 调 `packages/layer-core` Python CLI。
