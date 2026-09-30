# OpenDesign UI 笔记（只读抽取）

对照源：`reference/open-design/apps/web/src/`。只记顶栏、项目胶囊、主预览卡、侧栏层级、深色工作台。
**不**拷桌面 host、插件市场、skill 商店。

---

## 1. 顶栏 Chrome

| 项 | 路径 | 结构说明 |
| --- | --- | --- |
| 组件 | `components/AppChromeHeader.tsx` | `<header class="app-chrome-header">`：traffic space（可选）→ back → content → drag 区 → file actions → 右侧 actions |
| 工作台顶栏 | `styles/shell.css` `.workspace-tabs-chrome` | 高度 **44px**，`padding: 0 10px 0 8px`，与内容同色无底部分割线，`app-region: drag` |
| 项目标题 | `styles/viewer/routines.css` `.app-project-title` | 行内：`.title` 16px/600 + `.meta` 12px `--text-soft`；间距 8px |
| 右侧操作 | `AppChromeHeader` 的 `actions` slot | 设置/分享等图标按钮（`settings-icon-btn`），圆形 hover 底 |

**LayerForge 顶栏映射**
- 左：Logo mark + 产品名 `LayerForge` + 副标题「分层合成 · 本地 Agent」（对应 `.title` + `.meta` 双行/同行灰字）
- 右：**当前项目路径胶囊**（见下）+ 可选刷新
- 高度 44–52px，深色无硬分割线，整行可拖（桌面）/不可拖（Web 可省略）

---

## 2. 项目 / 路径胶囊

| 项 | 路径 | 结构说明 |
| --- | --- | --- |
| 组件 | `components/WorkingDirPicker.tsx` + ChatComposer 插槽 | 胶囊触发器展示工作目录，点击出菜单 |
| 样式 | `styles/viewer/routines.css` `.working-dir-pill` / `.working-dir-pill-trigger` / `.working-dir-pill-label` | 小圆角胶囊：边框 `--border`，内边距紧凑，字号 12px；hover 轻微填色 |
| 菜单 | `.working-dir-pill-menu*` | 路径完整展示 + 最近目录列表 + 分隔线 |

**LayerForge 映射**
- 右侧胶囊文案：项目相对路径 `projects/demo`
- 形态：`pill`（`border-radius: 999px` 或 `--radius-lg`），深色下 `--bg-panel` + `--border`
- 不必做完整目录选择器；MVP 显示 + 复制/刷新即可

---

## 3. 主预览卡

| 项 | 路径 | 结构说明 |
| --- | --- | --- |
| 布局 | `styles/shell.css` `.workspace-shell` | 顶栏 44px + 主体 `1fr`；主体 `overflow: hidden` |
| 预览底 | `styles/viewer/core.css` `.preview-viewport` / `.preview-frame-clip` | 大圆角裁切框；底下 `var(--veil-canvas)` 洗色，而非死黑 |
| 分栏 | `styles/viewer/routines.css` `.app .split` / `.split-chat-slot` | 面板「浮起卡片」：内缩 8px，`border-radius`，`overflow: hidden` 切阴影 |
| 卡片圆角 | token `--radius-xl` / `--radius-2xl` / `--radius-xlarge` | 预览与侧栏统一用大圆角（约 16–24px），避免方角生成器感 |

**LayerForge 映射**
- 主区一张**大圆角预览卡**：合成图 `object-fit: contain`，棋盘格透明底可选
- 卡片内边距克制（12–16px），卡片之间 gap 12–16px
- 空态：居中浅灰说明，不用大面积渐变/光效

---

## 4. 侧栏层级

| 项 | 路径 | 结构说明 |
| --- | --- | --- |
| 文件面板 | `styles/workspace/design-files.css` `.df-panel` / `.df-main` / `.df-topbar` / `.df-breadcrumbs` | 顶栏单行：左导航+面包屑，右动作；主体列表滚动 |
| 面包屑 | `.df-breadcrumbs` / `.df-breadcrumb-*` | 14px，当前项 `--text-strong` + 600 |
| 列表 | design-files 卡片/行 | 行分隔用发丝线 `--border`，不是每行重边框 |
| 面板浮层 | `.split-chat-slot > .pane` | 侧栏本身是一张圆角浮卡，不是全高灰条 |

**LayerForge 映射（侧栏自上而下）**
1. 区块标题「图层」+ 数量
2. 图层行：缩略图 / 名称 / `order` / ↑↓
3. 操作区：合成、导出（主按钮一颗，次按钮描边）
4. 底部状态条：真源路径 / 最近结果

层级：**区块 → 行 → 行内控件**，不要卡片套卡片。

---

## 5. 深色工作台 Token

摘自 `styles/tokens.css` `[data-theme="dark"]`（LayerForge 采用深色为默认）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg` / `--bg-app` | `#202020` | 页面底 |
| `--bg-panel` | `#353535` | 卡片/侧栏 |
| `--bg-elevated` | `#353535` | 浮层 |
| `--bg-subtle` | `#494949` | 次级底/悬停 |
| `--border` | `#5c5c5c` | 发丝线 |
| `--border-soft` | `#494949` | 更弱分隔 |
| `--text` | `#ededed` | 正文 |
| `--text-strong` | `#fafafa` | 标题 |
| `--text-muted` | `#bdbdbd` | 次要 |
| `--text-soft` | `#848484` | 弱说明 |
| `--brand` | `#87ea5c` | 稀用强调（状态/成功） |
| `--shadow-md` | 深色多层阴影 | 浮卡 |

原则（OD 自身注释）：
- **中性色承载界面**，品牌绿只作稀有反馈
- 圆角多用 token，不写裸像素
- 浮层用轻微 `veil`/fill，而不是粗边框

---

## 6. LayerForge 信息架构（目标）

```text
┌─ Topbar 44–52px ─────────────────────────────────────────┐
│ [Logo] LayerForge   分层合成 · 本地 Agent    (projects/demo) │
├───────────────────────────┬──────────────────────────────┤
│  Main preview card        │  Sidebar card                │
│  ┌─────────────────────┐  │  图层 · 3                    │
│  │   composite.png     │  │  [bg] Background    ↑ ↓      │
│  │   (rounded frame)   │  │  [mid] Subject      ↑ ↓      │
│  │                     │  │  [fg] Label         ↑ ↓      │
│  └─────────────────────┘  │  [合成]  [导出]              │
│                           │  真源 · projects/demo        │
└───────────────────────────┴──────────────────────────────┘
```

- 深色、卡片化、大圆角、少装饰
- 操作必须回写 `layers.json` / 触发 layer-core，不只改前端内存

---

## 7. 明确不抽

| 跳过 | 原因 |
| --- | --- |
| `apps/desktop` / Tauri host | 本阶段仅 Web |
| `PluginsView` / `MarketplaceView` / skill 商店 | 与 LayerForge 无关 |
| `components/chat/*` 全套聊天 | 仅保留工作台壳 |
| 品牌/连接器/登录体系 | 超出 MVP |
