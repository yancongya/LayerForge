# 无限画布功能审计与补全调研

> 范围：`apps/web`（tldraw 5.4.2 无限画布宿主）+ `packages/layer-core`（真源 `layers.json`）+ `/api`（`vite-plugin-layerforge-api.ts`）。
> 方法：代码取证 + `logs/layerforge.log` 运行时证据 + `reference/*` 参考项目盘点 + Lovart / 开源同类对标。四轮：① 首轮全量（§1–§2）② 画布专项补充（§1.1 F6、§3.4）③ 分层工具对标（§4.1、§8）④ **范围裁剪**（「产品边界」节、§5 裁剪版批次、§9 一页纸）。
> 状态：**仅调研与范围收敛，未改任何业务代码。** 日期：2026-09-30。

---

## 产品边界与实施原则（先读本节）

本文 §0–§2 是事实，本节与 §5 是**范围决定**。此前把 B0–B7 平铺成必做清单会导致范围膨胀，故裁剪。

**主路径（唯一需要被打磨的东西）**

```text
导入原图 → 拆层 → 调序 / 摆位 → 合成 → 导出
```

**产品定位（不随对标漂移）**

- 亮色、极简、画布优先；不做 OD 式深色工作台壳。
- 两种模式：`画布` | `组映射`。双模式已是上限，不加第三种视图。
- `layers.json` 是唯一真源；任何前端状态必须能由它重建。

**三条硬约定**

1. **画布 `x/y` 可持久化，但默认不参与 compose。** 合成仍按 `order` 自底向上叠全幅层。此语义必须同时写进 `layers.json` 注释与 UI 提示（如预览卡上「位置不影响输出」），不是"以后再补"。
2. **亮色为准。** `docs/od-ui-notes.md` §5 的深色 token 表按**已过时**处理。本审计 §3.4 / §7 原先把 `colorScheme="light"` 记为"与自家文档矛盾"，**现更正**：该改的是那份文档的表述，不是代码。
3. **F6 收口先于任何新功能**（见 §1.1）——它不是"功能"，是正确性地基。

**本阶段明确不做**（对齐 Lovart 很诱人，但都不在主路径上）

左侧历史轨 · 底部 composer 与参数芯片 · 多页面 · 打点评论 / 涂鸦 · 视频节点 · 单层重掷与变体网格（E3）· 文字双轨（E5）· 全套 blend / mask / blend-if / pass-through · 实时协作 · 复杂 OD 壳（顶栏胶囊、面包屑、浮卡容器）· 深色主题

> 这些不是"坏主意"，是**后续**：见 §5「P1 及以后」与 §8「中长期方向」。写下来的目的是防止实现中途被截图带偏。

---

## 0. 根因（三条派生链 + 一个独立前置问题）

表层问题很多，但绝大多数由这三条派生。修表层而不修根因会持续返工。

1. **画布是 `layers.json` 的单向投影，而不是真源。**
   `CanvasStage.tsx:278`（自由层）与 `:287`（组卡）对 `upsert` 一律传 `forcePos: true`，而 `:449` 的 `useEffect([layers, groups, sourceUrl])` 会在任何状态变更后重跑 `syncGraph`。
   → 用户摆位、对齐结果，在任何一次改名 / 打组 / 解组 / 切视图后被强制刷回 `x=80` 的一列。`stackNow()`（`:408`）打完组立刻被抹平，等于无效代码。

2. **画布几何与输出无关。**
   `compose.py` 只按 `order` 做 `alpha_composite`（并按最小高对齐缩放），`layers.json` v2 里没有 `x/y/w/h/visible/opacity`。
   → 在画布上拖动、对齐、缩放卡片**对合成结果零影响**。用户操作没有后果。

3. **后端 API 缺位锁死前端上限。**
   `/api` 现有动词只有 `reorder / group / ungroup / collapse / compose / source / decompose / export`。没有改名、删除、新增、复制、落位、可见性/透明度。
   → `App.tsx:305-318` 的改名只能改内存；`App.tsx:244-247` 切到「组映射」触发 `loadProject` 即**静默丢失改名**。

> 另有第四类问题不属于这三条派生、且必须最先处理：**tldraw 原生 UI 未被收口，整套"影子操作"在线**（见 §1.1 F6）。它是独立根因，因为即使真源改造完成，原生右键/快捷键仍会绕过真源。

---

## 1. 操作逻辑问题清单

### 1.1 致命

| # | 问题 | 根因证据 | 影响 |
| --- | --- | --- | --- |
| F1 | 摆位被强制重排 | `CanvasStage.tsx:278,287,449` | 画布不可编排；对齐/堆叠功能形同虚设 |
| F2 | 改名不落盘、切视图回滚 | `App.tsx:305-318` + `:244-247`；无 rename 路由 | 数据静默丢失 |
| F3 | 画布编辑不影响输出 | `compose.py`（仅 order）；schema 无几何字段 | 两个真源互不对账，"所见非所得" |
| F4 | 合成结果无处可见 | `compositeUrl` 只出现在 `types.ts:24` / `fallback.ts:34`，`App.tsx` 从不渲染 | 点「合成」只有一行状态文字 |
| F5 | 图层 URL 无 cache-buster | `vite-plugin:134`（layer url）vs `:146,148`（source/composite 带 `?ts=`） | 重新拆层后画布显示旧图 |
| F6 | **tldraw 原生右键菜单与快捷键没有收口，整套「影子操作」在线** | `ContextMenu` 未被 override（`CanvasStage.tsx:460-468` 只 null 了 7 个组件），`uiOverrides`（`:44-52`）只删 tools、不删 actions/菜单项 | 见下方展开 |

> **F6 的代码级机理**（对齐任何新功能之前必须先关这扇门，否则越对齐越乱）：
> - `Ctrl+G` 打的是 **tldraw 原生组**（`groupShapes`），与应用层"组 = 一张封面卡 + `groupId` 字段"是两个互不相认的组模型，同屏打架。
> - `Ctrl+D` 复制出的卡**带同一份 `meta.layerId` 但 shape id 不同** → `syncGraph` 的 `ours` 判定（`:215-222`）为真、`wanted.has(key)`（`:228`）也为真，于是它既不进删除分支、`imgId(key)` 又永远指向原件 —— 一个**永不更新位置/换图/改名、也永不被清理**的僵尸卡；且 `refreshHubs` 按 `[data-shape-id="imgId(key)"]` 反查 DOM，僵尸卡连名字标签都拿不到。
> - `Ctrl+A → Delete` 删光卡片，下一次任意状态变更 `upsert` 全部复活（用户视角：删不掉）。
> - 右键菜单里的 **锁定 / 置顶置底 / 复制到 / 添加到形状** 全都能点、全都即时生效、全都不落盘。
> - 收口方式：override `components.ContextMenu` 为白名单菜单 + 在 `uiOverrides.actions` 里剔除原生动作 + 裁快捷键表。

### 1.2 严重

- **折叠是死功能**：`CanvasStage.tsx:113` 明确 `void onToggleCollapse;`；`/collapse` 路由、`LayerGroup.collapsed`、`layers.json` 字段全链路空转。
- **组 = 破坏性换封面**：`:232-234` 直接 `deleteShapes` 成员卡，`:285` 用 `members[0].url` 当封面。成员位置丢失、无成员数、无"展开看成员"入口、组卡改名走 `window.prompt`。
- **卡片尺寸写死 3:4**：`NODE_W/H = 280/373`（`:54-55`）+ `ensureAsset` 硬编码 `w:720,h:960`（`:78-79`）。demo 恰好是 720×960（已实测 `projects/demo/layers/*.png` 全为 720×960）所以看不出来；960×960 或 16:9 会被拉伸。
- **图层无法删除 / 新增 / 复制**；从画布删掉的形状会在下一次任意状态变更时被 `upsert` **复活**。
- **每次变更 `spawn python`**（20s 超时，`vite-plugin:60-65`）+ `busy` 全锁 + 无乐观更新 + 无竞态保护 → 乱序响应会用旧 payload 覆盖新状态。
- **undo 语义割裂**：Ctrl+Z 撤销的是 tldraw 形状，`layers.json` 不动；反向服务端变更也不在历史里。用户看到"改了又弹回"。
- **`layout.ts` 整份死代码**（无人 import，已 grep 验证），`@xyflow/react` 是未使用的依赖。README/注释声称的"多列爆炸板"从未生效，实际布局是竖排一列——10 层即 4000px 长条。

### 1.3 中等

- `editor.store.listen`（`:472`）无 source/interest 过滤：相机每帧触发 `refreshHubs` + `refreshSelection`，每个标签一次 `querySelector` + `getBoundingClientRect` 强制同步回流，外加两次 `setState`。`logs/layerforge.log` 中 selection 日志成对重复出现即为证据。
- 名字走 DOM 反查、连接点走 `pageToScreen`（`:157-183`），两套定位轨并行 + `setTimeout(..., 20)` 魔法等待；标签不随 zoom 缩放，低倍率下互相压字。
- 双击改名取 `getSelectedShapes()[0]`（`:479`），多选时改错对象；`window.prompt` 阻塞且无校验。
- 选择浮条无边界钳制（贴顶即出屏，`:396-404`）；只有 6 向对齐，无分布 / 等间距 / z 序 / 旋转 / 缩放把手。
- 文件拖入 = 全局替换原图（`App.tsx:85-91`），且 `window` 级（`:93-117`）与 `main` 级（`:282-294`）drop 双绑重复触发；tldraw 自身的 drop/paste 会造出不被 `syncGraph` 认领的野形状（它只删 `ours`，`:210-229`）。
- chrome 剥得过狠：`Toolbar/StylePanel/PageMenu/NavigationPanel/HelpMenu/ZoomMenu/MainMenu` 全 null（`:460-468`），Minimap 随之消失；缩放只有 −/⤢/+，无百分比、无 zoom-to-selection、无 100%。

### 1.4 轻微

- 事件监听器无清理（`dblclick/contextmenu/pointerdown/keydown`，`:498-532`）。
- `.status` 是 `pointer-events:none`（`styles.css:359`），错误信息无法复制、无重试入口。
- 图标按钮只有 `title`，无 `aria-label`；键盘不可达。
- `styles.css:1` 注释已 mojibake；残留大量 `.lf-*` / `.flow-wrap` 的 React Flow 时代死样式（约 120 行）。
- `CanvasStage.tsx:224-227` 的 `normalized` 三元是恒等式（半成品修复痕迹）。
- `listProjects` 拉了但无项目切换 UI，`projectId` 固定；无多页面。

---

## 2. 优化方向（按"改一处收益一片"排序）

> 本节是**技术分析**，不是排期。哪些本阶段做、哪些延后、哪些不做，一律以「产品边界」节与 §5 为准。

1. **单一真源改造**：`layers.json` 升 v3，落盘 `x/y/w/h/name/visible/opacity/z`；`syncGraph` 改为"仅在形状缺失时落位"（`forcePos:false`），新节点用 `reference/designjs/.../canvas/artboards.ts:findPlacement`（L135-155，钉 `y:0` + 最右边缘 + 80px 间隙，注释里写明了为什么放弃跟随上一个 y）落位。相机用已验证存在的 `<Tldraw persistenceKey>` 或自存。
2. **批量事务**：`syncGraph` / `align` / `stackNow` 包进 `editor.run()`，一次操作 = 一步 undo，历史不再被每帧污染。
3. **乐观更新 + 去抖写盘**：拖拽结束 250ms debounce 上报局部 patch —— 范本见 `reference/frameground/src/pages/Canvas.tsx:36-64`（`useLayoutWriter`）+ `reference/frameground/src/server/layout.ts`（`patchLayoutEntry`）。去掉全局 `busy` 锁。
4. **收敛三套 DOM overlay**：自定义 `ShapeUtil` 把缩略图 + 标题 + 状态角标画进同一个 shape；选区浮条改用 `TldrawUiContextualToolbar` + `getSelectionScreenBounds()`。
5. **用 tldraw 内建吸附**（`options.snapThreshold` + helper lines）替代自研 `align()`；启用 `groupShapes/ungroupShapes`、`bringToFront/sendToBack`、`toggleLock`、`updateShape({opacity})`。
   以上符号已在 `apps/web/node_modules` 的 `.d.ts` 中逐个验证存在于 5.4.2。
6. `store.listen` 加 source/interest 过滤，只在 shapes/selection 变化时刷新。

---

## 3. 对标补全清单

### 3.1 与 Lovart / 参考项目 / 开源的交叉对照

| 能力 | Lovart 证据 | 本地参考实现 | 开源可借 | LayerForge 现状 |
| --- | --- | --- | --- | --- |
| 位置+相机持久化 | 未证实 | `frameground` 服务端 `layout.json` 250ms 防抖；`editable-design` localStorage 草稿 | tldraw `persistenceKey` | ❌ 无（F1） |
| 自动整理 / 多列板 | 截图「自动整理」 | `editable-design:makeExplodedBoard`（面积降序装箱 + 列数 `clamp(ceil(n/5),2,5)` + shrink-to-fit）；`layout.ts` 只抄了骨架 | xyflow `fitView` | ❌ 死代码，实际一列 |
| 吸附 + 智能参考线 | 未证实 | `designjs:findSnapOffset`、`editable-design:snap()+drawGuides()`、`frameground/lib/helperLines.ts` | tldraw 内建 | ❌ 无 |
| 真分组包络框 | 截图「创建编组」+ 组包围选框 | `fabric.js` group hull | tldraw `groupShapes` | ⚠️ 假组（换封面） |
| 每层可见性 / 透明度 | 未证实（有分层编辑） | `designjs/LayersPanel.tsx:347-369` eye/lock | `fabric.js` 对象模型 | ❌ 无 |
| 上下文工具条 | 截图（评论/视频裁剪/放大/去除背景/视频延长/画同款/下载 + `960×960` 读数 + 变体角标） | — | excalidraw / xyflow Toolbar 包 | ⚠️ 只有对齐+打组 |
| Minimap | 未证实 | `designjs/components/Minimap.tsx` | xyflow `<MiniMap/>`；tldraw `DefaultMinimap` | ❌ 被 null 掉 |
| 生成中 / 失败态 | 公开资料证实 | `editable-design:ready()` 等资源落地 | ComfyUI 节点 loading 范式 | ❌ 无 |
| 参考→结果连线 | 截图（源→结果箭头） | `paper-fig` connectors 约定 | drawio 路由规则 | ⚠️ 仅 source→层，写死 |
| 左侧历史轨（prompt+模型芯片+重生成/赞踩） | 截图 + 公开资料 | — | — | ❌ 无 |
| 底部 composer（模式+参数芯片+积分） | 截图 + 公开资料 | — | — | ❌ 无（顶栏三颗按钮） |
| PSD / 分层导出 | 官方博客证实（PSD → Premiere） | `layer-core export` 已有 png-seq/zip | — | ⚠️ 无 PSD |
| 打点评论（C 键） | 公开资料证实 | `open-design/comments.ts:PreviewCommentSnapshot`（position+selector+screenshotPath+markKind） | `@tldraw/commenting`（源码在 `reference/tldraw/packages/commenting`，未安装） | ❌ 无 |
| 多页面 | 仅截图「页面 1 / +」 | — | — | ❌ `PageMenu` 被 null |
| 实时协作 / 分享 | 公开资料证实，形态不确定 | — | penpot CRDT | ❌ 无 |
| 快捷键表 | 未证实 | `editable-design` L1868-1897（⌘Z/⌘S/Del/方向键微调 Shift×10/Esc/Enter） | — | ⚠️ 自研只有 Escape-cancel；**原生快捷键反而全开**（见 §1.1 F6） |

### 3.2 补全优先级（已按「产品边界」裁剪）

**P0 必须（本阶段承诺，且全部在主路径上）**

1. 收口 tldraw 原生 UI（F6）—— 前置项，先于下面所有条目；含"先关原生菜单/快捷键，再给白名单替代"。
2. 位置 + 相机持久化（解 F1）+ 明示「位置不参与合成」（见「产品边界」硬约定 1）。
3. 改名 / 删除 / 新增图层落盘（解 F2，需 §4.2 三条路由）+ 切视图不丢改名。
4. 合成结果回画布（解 F4）+ 卡片按真实图片比例（解非 3:4 拉伸）。
5. 每层 `visible` / `locked` —— 最小 v3 字段，直接服务"看清这一层到底是什么"。
6. 接上或删除 `selectLayer` / `onToggleCollapse` 两条死链（不允许继续以死代码形态留着）。

**可延后（对标灵感，不进本阶段必做列表）**

app 级 undo/redo 事务化 · 单选/多选浮动工具条与尺寸读数 · 透明度/混合模式前后端同公式 · 真·多列自动整理 · 真分组包络框 · Minimap · 缩放读数与 fit/100% · 快捷键表 · 任意节点连线 · 实时合成预览 · PSD/PPTX 保真导出 · Agent 可写面（`packages/canvas`）

**本阶段不做（是范围外，不是缺口）**

左侧历史轨 · 底部 composer 与参数芯片 · 多页面 · 打点评论 / 涂鸦 · 视频节点 · 单层重掷与变体网格 · 文字双轨 · 全套 blend/mask · 实时协作 · 复杂 OD 壳 · 深色主题

> **修正说明**：上一版把「生成中 skeleton / 失败重试态 —— 品类第一观感」写进 P0，是范围膨胀的典型来源——我们目前的拆层是**同步 mock**，没有真实生成耗时，就不需要生成态。等接入 Qwen-Image-Layered（75–240s/图量级）时它自然升级为 P0。同理「浮动工具条含尺寸读数」从对标口号降为可延后。

### 3.3 可借力的开源项目（GitHub API 实测 star，2026-09）

| 项目 | Star | 替我们解决的具体交互 |
| --- | --- | --- |
| tldraw/tldraw | 50.7k | 底座：吸附/参考线、zoom-to-fit/selection、相机即 store 一部分（顺带解决持久化） |
| xyflow/xyflow | 38.5k | `<MiniMap/>` `<Controls/>` 现成实现；v12 `NodeResizer` 带等比锁定 |
| fabricjs/fabric.js | 31.5k | group hull + 对象级 `opacity/visible` 属性模型 |
| konvajs/konva | 14.8k | Transformer：8 向把手 + 等比锁定 + 角度吸附 |
| Comfy-Org/ComfyUI | 135.5k | 生成队列、节点运行中态、workflow JSON 历史范式（抄交互不抄代码） |
| excalidraw/excalidraw | 133k | 上下文工具栏与 shift 多选/拖出的交互规格 |
| penpot/penpot | 60.5k | CRDT 多人文档模型 + 图层面板结构 |
| tigerowo/infinite-canvas | ~1.1k | 最接近"开源 Lovart"：6 类节点 + minimap + undo/redo + JSON 导入导出，结构可直接研读 |

### 3.4 画布专项未对齐清单（第二轮补充）

口径：**只算画布本体**（视口 / 选择 / 变换 / 组织 / 上下文工具 / 节点形态 / 持久化 / 导出）。composer 模式与参数芯片、积分徽章、历史轨的 prompt/重生成/赞踩本体、团队协同、移动端一律划到范围外——但"历史轨拖入画布"的**接收端**属于画布，列在下面。

#### (a) Lovart 截图里有、§3.2 未覆盖的画布能力

| 能力 | 截图证据 | 现状 |
| --- | --- | --- |
| 多页面 tab（页面 1 / +） | 截图 1 顶部 | ❌ `PageMenu` 被 null |
| 节点上的 prompt 摘要标签 | 截图 2「固定镜头，纯蓝色无…」 | ❌ 只有名字，无来源/提示词元信息 |
| 尺寸读数 `960 × 960` | 截图 2 蓝字 | ❌ 无；且卡片尺寸写死 3:4，直接读数会是假的（见 §1.2） |
| 变体角标（节点右上角 ✨） | 截图 2 | ❌ 无 |
| **合并图层**（flatten 选中层为新层） | 截图 3 工具条 | ❌ 无——**对我们最便宜的一条**：`layer-core` 只差一个 subset compose |
| 分布下拉（等间距） | 截图 3 两个下拉 | ❌ 只有 6 向对齐 |
| 导出选中（下载 / 导出 PSD 下拉） | 截图 3 | ❌ 只有全局「导出」 |
| 画布模式切换：选择 / 评论 / 涂鸦 | 截图 1 底栏 | ❌ tools 被删到只剩 select/hand/zoom |
| 协作者 presence 头像 | 截图 1 右下圆头像 | ❌ 无 |
| 缩放百分比读数（22%） | 截图 1 右下 | ❌ `ZoomMenu` 被 null，只有 −/⤢/+ |
| 图层面板 / 收起侧栏 / 全屏 三个壳开关 | 截图 1 左上 | ❌ 无（「组映射」是覆盖式 aside，不是可收起面板） |
| 视频节点（时长角标 + 播放态） | 截图 1/2 的 `00:05` | ❌ 只有 image shape |
| 深色画布底 | 全部截图 | ✅ **不列为差距**：产品定位是亮色极简（见「产品边界」）。`colorScheme="light"`（`CanvasStage.tsx:458`）是正确实现；该改的是 `docs/od-ui-notes.md` §5 的深色 token 表 —— 标注为「已过时 / 仅存档」 |
| 历史轨拖入画布并在光标处落卡 | 截图 1 左轨 | ❌ 画布侧无接收端（现在拖文件 = 替换原图） |

#### (b) 参考仓库里有、§3.2 未提及的画布基础设施

- **视口约定** —— `reference/designjs/packages/app/src/components/PanZoomWire.tsx`：滚轮 10–400%、**空格 / 中键平移**、`⌘0 fit`。我们只有 tldraw 默认手势，无空格平移，且 `cameraOptions.minZoom/maxZoom` 未设（可缩到无限小后找不到东西）。
- **键盘微调语义** —— `reference/editable-design/.../layer-editor.js` L1868-1897：方向键 nudge / Shift×10 / Del / Enter / Esc / ⌘S 全套。
- **列表 ↔ 画布双向选中同步** —— `CanvasApi.selectLayer`（`CanvasStage.tsx:142`）已实现"选中 + `zoomToSelection`"，但**全仓无调用者**（grep 验证）。所以「组映射」面板点一行完全不动画布。**这是最便宜的一条对齐：接上就能用。**
- **Minimap 的定位语义** —— `reference/designjs/.../components/Minimap.tsx` 是"世界包围盒框 + 点击跳转"，比单纯显示小地图多一层定位。
- **属性检查器** —— `editable-design` 的 `rebuildPanel/syncProps`（L1304-1353，实时回显选中层坐标尺寸）+ `designjs/RightPanel.tsx`。我们没有任何"选中了谁、它在哪"的读数面板。
- **草稿恢复横幅** —— `editable-design` L1529-1588 的 localStorage 草稿 + 「恢复 / 丢弃」提示条。正好是 §2 第 1 条持久化改造要配套的兜底 UI。
- **资源未就绪不卡死** —— `editable-design` 的 `ready()` 等图片/字体落地，坏图不阻塞；我们 `ensureAsset` 直接塞 URL，图挂了就是空卡。
- **"文件即 frame"节点** —— `reference/frameground/src/shapes/HtmlFrameShape.ts`（带 reload/watcher 刷新）。对我们的直接映射是**把 `composite.png` 做成画布上一个会自动刷新的预览 frame**，顺手解掉 §1.1 F4（合成结果无处可见）。
- **面板开关快捷键** —— `reference/frameground/src/pages/Canvas.tsx:145-163` 的 T/C/S。
- **折叠 / 展开** —— `App.tsx:185` → `api.ts:63` → `CanvasStage.tsx:113 void` 这条链**只差最后一米**，比任何新功能都便宜，别当新功能排期。

---

## 4. 必须先补的后端能力

否则前端上限被封死。

### 4.1 `layers.json` v3 字段表

分两栏看，**不要一次实施全字段**：4.1a 是本阶段承诺，4.1b 是承载 §8 层三分类的完整展望。

#### 4.1a 最小 v3（本阶段实施）

| 字段 | 语义 | 现状 | 代价 |
| --- | --- | --- | --- |
| `id` `name` `file` `order` | 已有 | ✅ | — |
| `x` `y` `w` `h` | 画布落位与卡片尺寸（按真实图片比例）；**明示不参与 compose** | ❌ | 低 |
| `visible` `locked` | 显隐 / 防误选 | ❌ | 低 |
| `rev` | 单调递增版本号，用于乐观并发检查（解 MCP 与 Web API 双写丢更新） | ❌ | 低 |
| `opacity` | 可选：仅前端预览用则代价低；要与导出一致就必须前后端同公式 → **归 4.1b** | ❌ | 低（预览）/ 中（一致） |
| 相机（或随 snapshot） | 视口持久化 | ❌ | 低（tldraw `persistenceKey`） |

#### 4.1b 完整 v3 展望（承载 §8 层三分类，本阶段不做）

| 字段 | 语义 | 哪些工具已有 | 实现代价 |
| --- | --- | --- | --- |
| `role`: `bg｜subject｜fx｜text` | **层分类学**：结构层/主体层/效果层/信息层，决定该层暴露哪些控件 | 无先例（自定，依据 2411.17864 与 2603.14925） | 低 |
| `blend` | 最小集 `normal/multiply/screen/overlay/soft-light/color` | 全部 | 低（CSS）/ **中：`compose.py` 必须同公式，注意 gamma 与"透明底上 Color 类未定义需先垫底层"** |
| `clipTo` | 剪贴到下层 alpha | PS/CS/Krita/Affinity | 低 |
| `mask{file,enabled}` | 灰度代理蒙版（可画笔编辑） | PS/Krita/Affinity | 中 |
| `blendIf` | 按亮度阈值的隐式 alpha | PS/Photopea | 中 |
| `passThrough` | 组混合穿透（作用于组外背景） | PS/Krita/CS | 中 |
| `variants[] + active` | 层内候选 + 选中项（"重掷"的数据结构） | PS Generative Fill（3 变体） | 中 |
| `provenance{prompt,model,seed,steps,resolution}` | 来源可追溯 | AI 新约定 | 低（`model-registry` 已有 schema） |
| 组 `box` + `collapsed` 生效语义 | 包围盒与折叠 | — | 低 |

### 4.2 路由与执行模型

- **路由**：`PATCH /layer`（name/visible/opacity/z/blend/role）· `DELETE /layer` · `POST /layer`（新增/复制）· `POST /layer/variant`（单层重掷，追加候选）· `PUT /layout`（批量落位，幂等 patch）· `PATCH /group`（改名/折叠/混合）· `POST /projects`（新建）· `export?format=psd|pptx`。
- **异步化**：`decompose` 从同步 20s 阻塞改为任务提交 + 进度轮询/SSE —— 这是"生成中节点态"与"单层重掷"的前提。
- **cache-buster**：layer url 统一带 `?ts=`（解 F5）。
- **并发写保护（新发现）**：MCP server 与 Web API 是**两条独立写路径，都直接改 `layers.json`**，无版本号、无锁 → 互相丢更新。v3 必须带 `version`/`rev` 单调计数并在写入时做乐观并发检查。

---

## 5. 建议实施批次（裁剪版：P0 是承诺，其余是 backlog）

> **范围纪律**：P0 之外一律不进本阶段排期。若 P0 做完仍觉得主路径不顺手，问题一定还在 P0 清单里，而不是"需要再加一个对标功能"。每批可独立中断、独立验收。

### P0-B0 收口（单独一批，最先做）

| 内容 | 触及 | 验收 |
| --- | --- | --- |
| override `components.ContextMenu` 为白名单 + `uiOverrides.actions` 剔除原生动作 + 裁快捷键；同时处置两条死链：`selectLayer`（接上：组映射点击定位）、`onToggleCollapse`（**接线或整链删除，不允许继续 `void` 留着**） | `CanvasStage.tsx:44-52,113,460-468`、`App.tsx` 组映射行 | 画布上不存在第二套组模型；`Ctrl+D` / `Ctrl+A→Delete` 不产生僵尸卡、也不复活；点组映射一行，画布选中并定位 |

### P0-B1 真源瘦身版（最小 v3）

| 内容 | 触及 | 验收 |
| --- | --- | --- |
| `layers.json` 最小 v3（§4.1a：`x/y/w/h/visible/locked/rev`，`opacity` 可选）；`syncGraph` 去 `forcePos`；新层落位用 `findPlacement`（钉 `y:0` + 最右边缘 + 80px 间隙）；改名 / 删除 / `PUT /layout` 三条路由；layer url cache-buster；相机持久化（`persistenceKey`）；卡片按真实图片比例（解 `ensureAsset` 硬编码 720×960）；schema 注释与 UI 双处写明「位置不影响输出」 | `layers.py` `vite-plugin` `CanvasStage` `App` | 拖位 → 改名 → 删一层 → 切「组映射」→ 刷新 → 重开：摆位、名字、层集合、图内容全部保持，无旧缓存图 |

### P0 同步项（小，且直接服务主路径）

- **F4 合成结果可见**：把 `composite.png` 作为画布上一张会刷新的预览卡（最小实现即可，不必先做 frame 组件）。
- **`visible` 生效于 compose**：关掉一层，导出结果确实少一层 —— 这是"层"这个抽象在本阶段的最低兑现。
- **删掉本阶段不需要的对标项**：见「产品边界」不做清单与 §3.2「本阶段不做」。

### P1 及以后（backlog，不与 P0 混排；顺序按主路径痛感再定）

真分组包络框（显式成员，hull 不参与合成）· 自动整理多列装箱（`layout.ts` 补装箱与 shrink-to-fit 并真正 `import`）· `opacity`/`blend` 前后端同公式（先只放 `normal/multiply/screen`）· 合并图层（subset compose）· 图层面板（拖拽改 z、隔离预览、右键"此处的层"）· app 级 undo/redo 事务化（`editor.run`）· overlay 收敛到自定义 shape · 内建吸附与方向键 nudge · 视口约定（空格平移 + `minZoom/maxZoom` + `⌘0`）· Minimap · 缩放读数与 fit/100% · 快捷键表 · 实时合成预览（E4）· 草稿恢复横幅 · 资源未就绪不卡死 · PSD/PPTX 保真导出（E7）· Agent 可写面 `packages/canvas`（E8）

### 修层能力（E2/E3，行业空白；**接入真模型时升 P0**）

拆分前语义模板 + 层数控制 · 单层递归再拆 / 合并两层 · 边缘羽化 + 去色污 · 遮挡空洞补全 · 跨层像素仲裁（双色画笔改蒙版，不动像素）· 单层重掷 + 变体网格选优 · 生成中 / 失败态（同步 mock 阶段无意义，见 §3.2 修正说明）

### 本阶段删除（不再作为"缺口"跟踪）

左侧历史轨 · 底部 composer 与参数芯片 · 多页面 · 打点评论 / 涂鸦 · 视频节点 · 文字双轨（E5）· 全套 blend / mask / blend-if / pass-through · 实时协作 · 复杂 OD 壳 · 深色主题

---

## 6. 不确定项（如实标注）

- Lovart 的 minimap、undo 覆盖范围、快捷键全集、移动端形态均**无公开文档**，仅从截图推断。
- 截图 1 右下角那排小图标（圆 / 图层堆叠 / …共 4 颗）语义**未能确认**，可能是可见性 / 网格 / 吸附 / 主题开关，也可能含缩放读数容器；不要按猜测排期。截图 1 顶栏左端 4 颗图标同理（推测含图层面板、侧栏收起、全屏，其中"全屏"较确定）。
- 「页面 1 / +」只能证实存在多页面 UI，其是否等价于 tldraw 的 page（含各自相机与持久化）未知。
- `useEditableText`、`externalContentSources`、`onCreateExternalContent` 在装的 tldraw 5.4.2 `.d.ts` 中**未命中**：原地改名应看 `useEditablePlainText` / `useEditableRichText`，外部内容走 `editor.registerExternalContentHandler`。落地前需再核。
- 本审计结论全部来自代码与 `logs/layerforge.log` 取证，**未做界面截图实测**（dev server 在 5173 运行中）。F1（摆位被刷回）、F5（重新拆层显示旧图）、F6（Ctrl+D 僵尸卡）与"非 3:4 图被拉伸"四条建议各用一次离屏 Electron 截图/脚本实测确认。

---

## 7. 取证入口（复现用）

- 画布主体：`apps/web/src/CanvasStage.tsx`（659 行，`syncGraph` 在 194-373）
- 应用壳与状态：`apps/web/src/App.tsx`（`onRename` 305-318、`loadProject` 244-247、drop 93-117/282-294）
- 死代码：`apps/web/src/layout.ts`（无 import）、`package.json` 里的 `@xyflow/react`（无 import）
- 真源：`packages/layer-core/layer_core/layers.py`（schema 注释 1-19）、`compose.py`（仅按 order 叠）
- 后端路由：`apps/web/vite-plugin-layerforge-api.ts:218-427`
- 运行时证据：`logs/layerforge.log`（selection 双行成对）
- 参考实现：`reference/editable-design/.../layer-editor.js`、`reference/designjs/packages/app/src/`、`reference/frameground/src/`
- 第二轮补充的取证（均已 grep 验证）：`ContextMenu` 未出现在 `CanvasStage.tsx` 的 components override 里（F6 成立）；`selectLayer` 全仓仅 `:29`（类型）与 `:142`（实现）两处、无调用者；`onToggleCollapse` 链路 `App.tsx:185 → api.ts:63 → CanvasStage.tsx:113 void`；`colorScheme="light"` 在 `CanvasStage.tsx:458`（**已按产品定位判定为正确实现**，需修订的是 `docs/od-ui-notes.md` §5 的深色 token 表 —— 见「产品边界」硬约定 2）
- 第三轮的取证（本地仓库自证）：`packages/canvas` 与 `packages/skill-loader` **是空目录**（`find -type f` 无输出），而 `docs/reference-extract.md` §9 把两者列为第 5、第 3 步落地目标；`model-registry/providers.py:31-53` 已定义全套 Qwen 参数（steps 50 / layer 4 / resolution 640|1024 / cfg_normalize / seed 777 / randomize_seed / neg_prompt / use_en_prompt）与三种 capability（`layered-decompose` / `layer-edit` / `layer-combine`），而 UI 只发 `{dataUrl, layers: 3}`；`export.py:18` 只实现 `png-seq|zip|composite`，契约（`reference-extract.md:172`）写的是 `png-seq|zip|pptx|psd`；MCP 工具仅 6 个（`ping/get_layers/reorder_layers/compose/export_layers/decompose`，`tools.py:177-245`），无 group/ungroup/collapse/layer-edit

---

## 8. 层模型与交互进化（分层工具对标 · **中长期方向，不阻塞 P0**）

> 本章保留行业判断与选型依据，但**整体属于 P1 之后的方向**：§5 的 P0 批次不依赖本章任何字段。唯一例外是 §8.2 的层三分类 —— 它解释了为什么最小 v3 只放 `visible/locked`、把 `blend/role` 留进 4.1b 展望，以及为什么"效果层用 normal alpha"是**已知取舍**而非疏漏。**不要因为读了本章就把 E1–E8 塞回 P0。**

### 8.1 一句话行业事实

> **拆是 AI 的，修是回 Photoshop 的。**

除 Photoroom（只有前景/背景两层，修复手段反而最全：重画蒙版、羽化滑块、背景无限重生成、阴影强度/反射可调）之外，**没有任何产品**把"跨层移动像素、边缘羽化、单层候选重掷、层数与语义控制"做成一等公民。Lovart 元素拆分（2025.11）把花字拆成纯文本、效果丢失，官方 workaround 竟是"截图 + 移除背景"；Canva Magic Layers 文字分离错误 → 让用户"用文本框重建"（即放弃修复）；ImageLayered.com（Quick mode 明示 powered by Qwen-Image-Layered，$0.05/层）几乎没有修层 UI，只在生成前给层数。

**结论：进化方向不是补 Lovart 的画布外观，而是把"层"从位图切片升级为可审计、可仲裁、可重掷的对象。这是空位。**

### 8.2 核心论点：层必须分三类，不是一条栈

学术侧已给出方向：`Generative Image Layer Decomposition with Visual Effects`(arXiv 2411.17864) 把阴影/光晕单独建模；`Workflow-Aware Layer Decomposition`(arXiv 2603.14925) 论证层语义应绑定用户生产工作流（线稿/平涂/阴影/高光）而非通用物体检测；OmniPSD(arXiv 2512.09247) 用 OCR + 字体恢复把文字做成可编辑矢量文本层。三类的交互诉求互不兼容：

| 类别 | 诉求 | 需要的能力 | **不**需要的能力 |
| --- | --- | --- | --- |
| 结构层 `bg/subject` | 移走我、把底下补全 | 遮挡空洞 inpaint、单层重掷、跨层像素仲裁 | 混合模式（normal 即正确） |
| 效果层 `fx`（阴影/高光/纹理） | 只改"怎么叠"，不改"在哪" | `blend`（阴影=Multiply、高光/发光=Screen、纹理=Overlay/Soft-light、统一色调=Color）、`opacity`、`blendIf`、`clipTo` | 位置变换、重掷 |
| 信息层 `text` | 改字不改形 | 双轨：OCR 真文本层 + 保留原效果的外观层 | 位图重绘 |

我们现在把三类一律当"normal alpha 的一张位图切片"，**这是合成假感的根因**，也是"层"这个抽象在我们这里名不副实的地方。

### 8.3 进化项 E1–E8

- **E1 层模型字段升级** —— 见 §4.1 表。`blend/opacity/clipTo` 前端用 CSS `mix-blend-mode` 近乎免费，但 `compose.py` 必须实现同一套公式（gamma/线性光陷阱；透明底上 Color 类模式未定义，需先垫底层）。
- **E2 拆层质量的可控性（行业空白，主战场）** —— ① 跨层像素仲裁：把"移动像素"降维成**编辑该层蒙版**（双色画笔：向上层转移 / 向下层转移），不动像素本身，底层孔洞自动补全；② 边缘羽化 + 去色污（对应 PS Select and Mask 的 Feather / Decontaminate Colors / Shift Edge）；③ 拆分前语义模板（海报/插画/照片/游戏素材）+ 层数控制；④ 拆后**合并两层**与**对单层递归再拆**（Qwen-Image-Layered 官方已展示递归分解）。
- **E3 单层重掷 + 候选槽** —— 成熟范式是 PS Generative Fill 的"同区域 3 变体平铺对比"。移植到层：固定其余层为条件，只对坏层跑 N 个 seed，网格选优，**选中才提交**；"重新生成"= 追加变体而非覆盖（`variants[] + active`）。Qwen 工具链已给原料（`edit_rgba_image.py` + seed + `combine_layers.py`），只差选优 UI。**未见任何产品把"层 = 可无限重掷的 slot"做成默认交互。**
- **E4 实时合成预览** —— 现在必须点「合成」→ spawn Python → 写盘 → 才看到结果。应改为前端 canvas/WebGL 常驻合成视图，「合成」退化为"导出"。E1 的 blend 只有在实时预览里才可被调试。
- **E5 文字层双轨** —— 见 8.2。绕开全行业的"可编辑性悬崖"。
- **E6 画布语义的正名** —— 业界（PS/Figma/Affinity）**全部**把面板顺序与画布位置解耦，没有任何产品让卡片位置影响合成。所以不必为"位置不进输出"羞愧，但必须**明说 + 持久化**。值钱的是借节点图语义给位置一个轻约定：**同一层的候选变体横向排成变体行，纵向排代际** —— 这是 AI 拆层独有、成熟工具没有的空间语义。
- **E7 下游保真** —— Qwen 官方 app 的 PSD 导出是 psd-tools 平铺 RGBA 层，**无组/无混合模式/无蒙版**；Lovart 主打的 PSD→Premiere（2026.04 官方博客）进 AE 后"convert to comp"仍是手工活。带 `role/blend/group/opacity` 的 PSD 就是差异化。
- **E8 Agent 可写面** —— `docs/reference-extract.md` §4 已写好 Parts（读：选区/视口/截图/历史/lint）+ Actions（写：增删改/变换/分组）契约，`packages/canvas` 至今空目录。这才是 LayerForge 区别于"又一个画布"的根，副标题里的「本地 Agent」目前没有任何落地物。

### 8.4 参考：AI 拆层方法谱系（选型的真实上限）

| 方法 | 层表示 | 已知失败模式 | 启示 |
| --- | --- | --- | --- |
| Qwen-Image-Layered（我们的目标后端，arXiv 2512.15603） | **变长** RGBA 层（示例 3–8，论文上限 20），层序即遮挡序 | 官方自认：prompt 只能描述整图、不能按层控制；released 权重偏 i2l，t2l 有限；训练数据约半是海报，自然照片/连续景深/复杂遮挡未充分验证；**柔和半透明阴影、强遮挡区 alpha、层序恢复不唯一** | 我们该把"效果层"单独建模（E1/E2），而不是指望模型给对 |
| LayerD (ICCV 2025) | 迭代"抠顶层 + LaMa 补背景" | 固定 3 轮上限；渐变/纹理下调色板先验失效；误差累积（Qwen 论文点名） | 递归式便宜可控但上限低；其 DTW 层对齐评测值得抄进我们的质量回归 |
| img2layers (Meta, CVPR 2024) | 合成场景训练的**定长** ≤7 层 | 真实图域差距、软阴影误判 | 定长 vs 变长是本质差异 |
| LayerDiffuse (SIGGRAPH 2024) | latent 解耦**生成**透明 PNG，不拆已有图 | alpha 边缘糊、背景渗入 | 可作透明素材生成的补充底座 |
| See-through (2026, shitagaki-lab) | 单张动漫图 → 23 层 PSD + 深度序（Live2D 就绪） | 发髻并入错层（类别表缺项）、PSD 丢层、花边/透视/厚涂失败 | **层要带语义命名 + 可预测类别表**；"能用但需手工清理"是常态 |
| OmniPSD (2025.12) | Flux LoRA 双路，20 万真实 PSD 训练；文字→真文本层 | 仅前/中/背 3 语义组 | E5 的管线可参考 |

### 8.5 明确不该抄的（传统包袱）

1. **自由层变换参与合成** —— 我们的层是同一画布坐标系的切片，位移会破坏对齐；卡片位置保持纯 UI（持久化但注明不进输出）。
2. **调整层参数体系**（曲线/色相/饱和）—— 前后端双份实现太贵，用 blend 预设"阴影/高光/统一色调"一键替代。
3. **智能对象 / 嵌入源文件** —— 无矢量回编辑需求。
4. **线性 History 面板** —— 会误导"每步都可回退"；command-undo + `variants[]` 即可。
5. **26 个全量混合模式** —— 暴露 6–8 个，其余进"高级"。
6. **Figma 式自动 bbox 组** —— HN 有专帖骂这个，也是它后来推 frames/sections 稳定容器的原因。组用**显式成员**，hull 只用于选择/对齐，不参与合成。

### 8.6 本轮不确定项

- Qwen 显存/耗时（~10GB FP16 / 75–240s 每图）与 imagelayered.com 等 wrapper 细节来自**单一第三方来源**，未经官方确认。
- 美图设计室 / 稿定 / 佐糖 / Pixlr / Krea 是否具备真多层拆解**未逐一实测**（低置信，报告按"未发现"处理）。
- "Adobe 无平图拆层"仅代表本次检索所见的官方材料（2026.08 What's new）。
- `blend-if`、`pass-through` 与"阴影=Multiply/高光=Screen"是社区共识，**未做量化验证**；上线前需用 demo 图对拍 PS 输出。
- 即梦 Seedream 5.0 Pro 的层内编辑深度未验证。

---

## 9. 给实现者的一页纸

**读的顺序**：「产品边界」→ §0 根因 → §1.1 F6（含影子操作机理）→ 本节 → §5 的 P0-B0 / P0-B1 两行验收。其余（§3 对标、§4.1b 展望、§8）**P0 期间不需要读**。

**只做两批，按序，不并行**

1. **P0-B0 收口** —— 关掉原生右键菜单 / 快捷键 / 影子组；处置 `selectLayer` 与 `onToggleCollapse` 两条死链（接线或整链删除）。
2. **P0-B1 真源瘦身版** —— 最小 v3（`x/y/w/h/visible/locked/rev`）+ `syncGraph` 去 `forcePos` + 改名 / 删除 / layout 路由 + cache-buster + 相机持久化 + 真实图片比例 + 「位置不影响输出」双处声明。
3. 顺手项：合成预览卡回画布（F4）、`visible` 生效于 compose。

**验收标准（5 条，逐条可手工复现）**

| # | 验收 | 操作 |
| --- | --- | --- |
| 1 | **拖位持久** | 拖动若干卡片 → 改名任意一层 → 切「组映射」→ 回画布：卡片仍在原位；刷新页面后仍在 |
| 2 | **无僵尸卡、无影子组** | `Ctrl+D` 复制、`Ctrl+G` 打组、`Ctrl+A` 后 `Delete`：不出现"删不掉 / 改不动 / 下次同步又复活"的卡；画布上不存在与应用层 `groupId` 并存的第二套组 |
| 3 | **改名与删除落盘** | 改名 + 删除一层 → 刷新 → 重开项目：名字与层集合与操作后一致（`layers.json` 里确实变了） |
| 4 | **合成可见** | 点「合成」→ 画布上出现/更新合成预览卡；关掉某层 `visible` 再合成 → 输出确实少这一层 |
| 5 | **拆层无旧缓存** | 连续拆两次不同原图 → 画布显示新图（不依赖强刷）；非 3:4 图不被拉伸 |

**红线（防止中途膨胀）**

- 不做 §3.2「本阶段不做」清单里的任何一项，包括"顺手加个 minimap"。
- 不引入 `blend` / `mask` / `variants` / `role` 字段；要加，先回来改 §4.1a 并写清"它挡住了主路径的哪一步"。
- 不用 `window.prompt` 交付改名 —— P0-B1 的改名必须走内联输入并落盘。
- 任何"对标 Lovart 截图"的新增需求，一律先追加进 §5「P1 及以后」，不直接开工。
- 改完必须回到本表逐条验收；验收方式建议用离屏 Electron 截图 + `executeJavaScript` 断言，不靠肉眼。

---

## 10. P0 实施进度与续做清单（中断点快照）

> 本轮只做到 **P0-B1 的真源与后端切片**就中断。前端未动，因此当前提交的画布行为仍是旧的（摆位仍会被刷回、原生右键/快捷键仍开放）。下次从 §10.3 第 1 条接着做。

### 10.1 已完成

| 文件 | 内容 |
| --- | --- |
| `packages/layer-core/layer_core/layers.py` | schema **v3**：`Layer` 增 `x/y/w/h/imgW/imgH/visible/locked`，`LayerGroup` 增 `x/y/w/h/imgW/imgH`，`ProjectLayers` 增 `rev`；`save_layers_document` 每次写自增 `rev`；v1/v2 兼容读取；新纯函数 `rename_layer` / `rename_group` / `delete_layer`（重排 order + 解散 <2 成员的组）/ `set_layer_flags` / `apply_layout`（只改几何，未知 id 报错）/ `card_size`（按图片比例算卡）/ `visible_layers`；`group_layers` 给组卡落位（= 成员包围盒左上，封面取**最底层**成员，与画布一致）；`load_layers_document` 对 legacy 文件**测量并回填** `imgW/imgH`（只读、不落盘、不覆盖已有 `w/h`） |
| `packages/layer-core/layer_core/compose.py` | 改读 `visible_layers()` → **`visible=false` 的层确实不进合成**；无可见层时报错 |
| `packages/layer-core/layer_core/decompose.py` | 拆层时写真实 `imgW/imgH` + 顶行排布（`_place_cards`，抄 `designjs:findPlacement`：`y` 钉 0、`x` = 前一张右缘 + 80）；重拆**不回退 `rev`** |
| `packages/layer-core/layer_core/cli.py` | 新子命令 `rename` / `rename-group` / `delete` / `flag --visible --locked` / `layout '<json>'`；`_doc_payload` 改用 `asdict` 自动带新字段 |
| `apps/web/vite-plugin-layerforge-api.ts` | 新路由 `POST …/rename`、`…/rename-group`、`…/delete`、`…/flag`、`…/layout`（沿用既有 POST+action 风格）；路由正则放宽到 `[a-z][a-z-]*` 以支持带连字符的 action；payload 带 `rev`；**layer url 加 `?v=<rev>`（解 F5）**，source/composite 保留 `?ts=` |
| `apps/web/src/types.ts` `src/fallback.ts` | `Layer`/`LayerGroup` 增可选 v3 字段，`ProjectPayload` 增 `rev` |
| `.p0-layercore-check.py` | 回归脚本（临时放仓库根，下次可移到 `packages/layer-core/scripts/`） |

### 10.2 已验证

- `python .p0-layercore-check.py` → **PASS 9/9**：v2→v3 升级与 rename 落盘 / rev 单调 + flag 落盘 / **visible=false 时合成确实少一层** / layout 落盘且**不影响合成** / layout 未知 id 报错 / 组卡带几何且成员几何不被销毁、解组原位复原 / delete 重排 order + 解散小组 / decompose 真实比例 + 顶行排布 / **960×960 源图 → 280×280 卡（不再拉伸）**。脚本在临时副本上跑，不碰 `projects/demo`。
- `npx tsc --noEmit -p apps/web/tsconfig.json` → 干净（`npm run build` 用的就是它）。
- ⚠️ 既有状况（非本次引入）：`tsconfig.node.json` 因缺 `@types/node` 一直报 `node:fs`/`process` 等错，但它不在 build 路径里。

### 10.3 未完成（按依赖顺序）

1. **P0-B0 收口**（前端，最先）
   - `uiOverrides` 增 `actions` 覆写：删掉原生可变动作 → **同时**裁掉其快捷键、**同时**自动裁剪原生右键菜单（`TldrawUiMenuActionItem` 找不到 action 时返回 `null`）。已取证：5.4.2 的 `TLUiOverrides` **只有 `{actions, tools, translations}`，没有 `shortcuts` 覆写口**；快捷键由 `useKeyboardShortcuts.js:66-74` 从 `actions` 的 `kbd` 派生 → 删 action 即删快捷键。**不要自写 ContextMenu 组件。**
   - 待删 action id（已从 `lib/ui/context/actions.js` 全量核对）：`group ungroup duplicate delete copy cut paste paste-at-cursor paste-plain-text-at-cursor toggle-paste-at-cursor insert-media insert-embed image-replace video-replace bring-to-front bring-forward send-backward send-to-back toggle-lock unlock-all align-left align-right align-top align-bottom align-center-horizontal align-center-vertical distribute-horizontal distribute-vertical stack-horizontal stack-vertical stretch-horizontal stretch-vertical pack frame-selection fit-frame-to-content move-to-new-page flatten-to-image flip-horizontal flip-vertical rotate-cw rotate-ccw adjust-shape-styles enlarge-shapes shrink-shapes edit-link convert-to-bookmark convert-to-embed open-embed-link undo redo open-cursor-chat stop-following toggle-auto-size`
   - 保留（纯选择/视口/偏好/只读导出）：`select-all select-none zoom-in zoom-out zoom-to-fit zoom-to-100 zoom-to-selection toggle-grid toggle-snap-mode toggle-invert-zoom toggle-wrap-mode toggle-edge-scrolling toggle-focus-mode toggle-dark-mode toggle-reduce-motion toggle-dynamic-size-mode a11y-* back-to-content change-page-next change-page-prev copy-as-png copy-as-svg copy-as-json export-as-png export-as-svg download-original print`
   - **僵尸卡治理改为白名单形状对账**：`syncGraph` 现在只删"它认识的"shape（`CanvasStage.tsx:210-229`，还带着恒等式 `normalized` 三元这处半成品）。改成**删除所有非托管 shape 与未被引用的 asset**（托管集 = source 卡 / 层卡 / 组卡 / 连线 / 合成预览卡），一次干掉 paste、drop、duplicate 全类孤儿。
   - 接上 `selectLayer`（`App.tsx` 组映射行 `onClick` → `canvasApi.current?.selectLayer(id)`）；`onToggleCollapse` **接线或整链删除**（现仍 `CanvasStage.tsx:113 void`）。
2. **P0-B1 前端**：`api.ts` 补 `renameLayer/renameGroup/deleteLayer/setLayerFlags/saveLayout`；`App.tsx` 把改名/删除/可见性改为走 API（**现在仍是 `setProject` 内存改，F2 未解**）；`CanvasStage.tsx` 去 `forcePos`、按 `x/y/w/h` 落位、按 `imgW/imgH` 建 asset、拖拽结束 250ms 防抖写 layout、改名走内联输入（**删掉 `:478-498` 的 `window.prompt` 路径**）、相机恢复。
   - 相机持久化**不用** `persistenceKey`：它会把整份 tldraw 文档快照写进 IndexedDB，等于再造一个真源。改为自存 `editor.getCamera()` → localStorage（按 projectId 分键）、mount 时 `setCamera`。这是对 §4.1a 括号的有意偏离。
   - 原图卡与合成预览卡设 `isLocked: true` 不可拖（派生对象不必另存位置），层卡与组卡可拖并落盘。
3. **P0 同步项**：`compositeUrl` 渲染成画布上的合成预览卡（`App.tsx` 目前从不使用它，F4 未解）；`visible/locked` 控件（建议放单选浮条，两个小按钮）。
4. **验收**：跑 §9 的 5 条；建议加一个 `.p0-canvas-check.cjs` 离屏 Electron 截图断言。

### 10.4 后端路由速查（下次直接用）

```text
POST /api/projects/:id/rename        {id, name}
POST /api/projects/:id/rename-group  {group_id, name}
POST /api/projects/:id/delete        {id}
POST /api/projects/:id/flag          {id, visible?, locked?}
POST /api/projects/:id/layout        {layers:[{id,x,y,w,h}], groups:[{id,x,y,w,h}]}
→ 全部返回整份 projectPayload（含新 rev 与带 ?v= 的 layer url）
```
