# 抽取对照表（reference → LayerForge）

> 只读整理自 `reference/` 下已克隆仓库，用于后续抽取约定与少量代码。
> 本阶段不实现 MCP、不接模型、不写画布业务代码。
>
> 计划动作约定：
> - **约定 only** — 只吸收文档/协议/目录与接口约定，不复制源码
> - **少量代码** — 可复制/改写少量可移植片段（schema、类型、纯工具函数）
> - **仅阅读** — 理解用，不落地文件

---

## 总览映射

| LayerForge 目标 | 主要参考源 | 计划 |
| --- | --- | --- |
| `packages/mcp-server` | designjs `packages/mcp-server` + `packages/bridge` | 约定 only / 少量代码 |
| `packages/skill-loader` | open-design `skills/` 协议 + editable-design skill 目录 | 约定 only |
| `packages/model-registry` | qwen-image-layered `src/app.py` / `src/tool/*` + designjs tool schema 思路 | 约定 only |
| `packages/layer-core` | qwen-image-layered 分层拆合 + editable-design layers/replay 契约 | 约定 only / 少量代码 |
| `packages/canvas` | tldraw `templates/agent` + frameground `src/` | 约定 only |
| `skills/image-layer` | editable-design `skills/editable-design` + open-design `skills/*` SKILL.md 形态 | 约定 only |
| `third_party_notices` | 各仓库 LICENSE / THIRD_PARTY_NOTICES / NOTICE | 约定 only（汇总声明） |

---

## 1. open-design → skills 约定、MCP 用法

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/open-design/skills/AGENTS.md` | 功能型 skill 目录职责、与 design-templates 的切分、添加 skill 步骤 | `packages/skill-loader/`（约定）+ `skills/` 目录规范 | 约定 only |
| `reference/open-design/skills/README.md` | skill 自包含目录约定（`SKILL.md` + `assets/` / `references/`） | `skills/image-layer/` 形态 | 约定 only |
| `reference/open-design/docs/skills-protocol.md` | `SKILL.md` frontmatter 语法（name/description/triggers）、`od.*` 扩展字段语义、发现与优先级 | `packages/skill-loader` 的 loader 校验字段；`skills/image-layer/SKILL.md` frontmatter | 约定 only（字段表可少量摘抄） |
| `reference/open-design/docs/skills-contributing.md` | 技能/模板合入门槛与最小包结构 | `skills/image-layer` 质量门槛参考 | 仅阅读 |
| `reference/open-design/skills/<name>/SKILL.md` | 单 skill 最小形态：YAML frontmatter + 工作流正文 | `skills/image-layer/SKILL.md` | 约定 only |
| `reference/open-design/docs/architecture.md`、`docs/plugins-spec.md` | 宿主/插件/MCP/媒体等服务边界表述 | `packages/mcp-server` 与宿主边界表述 | 仅阅读 |
| `reference/open-design/docs/agent-adapters.md` | 多 agent 适配与能力探测思路 | `packages/mcp-server` 客户端兼容说明 | 仅阅读 |
| `reference/open-design/packages/contracts`、`packages/host`、`packages/sidecar*` | 纯契约层 / 宿主 / sidecar 分层 | 不直接映射；理解边界后避免把 MCP 写进 canvas | 仅阅读 |
| `reference/open-design/AGENTS.md` | 仓库级 AGENTS 文档索引与目录责任 | 可选：根 `AGENTS.md` 风格参考 | 仅阅读 |

**抽出结论（skills 约定）**
- Skill = 自包含目录 + `SKILL.md`（frontmatter + 正文）+ 可选 `assets/`、`references/`、脚本。
- 功能 skill 与「渲染模板」分离；LayerForge 的 `image-layer` 按功能 skill 落地。
- frontmatter 至少：`name`、`description`、`triggers`；可选中文名/描述。

**抽出结论（MCP 用法）**
- open-design 自身不以「MCP 工具表」为 skill 核心，而是把 MCP/媒体放在宿主与插件服务边界。
- 对 LayerForge：MCP 是 `packages/mcp-server` 对外协议，skill 只描述「怎么用能力」，不内嵌服务实现。

---

## 2. designjs → MCP 工具与状态读写

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/designjs/packages/mcp-server/README.md` | stdio MCP ↔ WebSocket 桥；服务端无状态，画布为唯一真源 | `packages/mcp-server` 架构说明 | 约定 only |
| `reference/designjs/packages/mcp-server/src/index.ts` | `McpServer` 注册循环：从共享 schema 自动 registerTool | `packages/mcp-server` | 少量代码（结构可改写） |
| `reference/designjs/packages/mcp-server/src/bridge-client.ts` | WS 连接、请求/响应按 id 关联、超时、指数退避重连 | `packages/mcp-server` | 少量代码（连接语义可改写） |
| `reference/designjs/packages/bridge/src/protocol.ts` | 桥协议：hello / request / response、角色枚举、默认 host/port/path | `packages/mcp-server`（协议常量与消息形状） | 少量代码 |
| `reference/designjs/packages/bridge/src/tools.ts` | Zod `Input`/`Output` schema 集中定义，工具面与 schema 不漂移 | `packages/mcp-server` 工具 schema 目录 | 约定 only（形状参考） |
| `reference/designjs/packages/bridge/src/index.ts` + `__tests__/tools*.ts` | 工具表导出与单测组织 | `packages/mcp-server` 测试布局 | 仅阅读 |
| `reference/designjs/packages/bridge` 工具分类（inspect / mutate / artboards） | 状态读写工具命名法：`get_*` / `add_*` / `update_*` / `delete_*` / `select` | LayerForge MCP 工具命名 | 约定 only |
| `reference/designjs/docs/architecture/` | canvas 与 bridge、扩展的职责切分 | `packages/canvas` 与 MCP 边界 | 仅阅读 |

**抽出结论（MCP 工具与状态读写）**
- 分层：agent (stdio JSON-RPC) → mcp-server → WebSocket bridge → 浏览器/画布 handler → 回包。
- **服务端不持有设计状态**；状态读写工具在画布侧执行，schema 在共享包中单一来源注册。
- 读：`ping`、`get_tree`、`get_html`、`get_css`、`get_screenshot`、`get_selection`、`get_variables`。
- 写：`add_components`、`add_css_rules`、`update_styles`、`set_text`、`set_variables`、`delete_nodes`、`select` 等。
- LayerForge 的 `packages/mcp-server` 应沿用「schema 驱动注册 + 无状态转发 + 画布真源」，具体工具面按 layer/image 场景重定义，不照搬 GrapesJS。

---

## 3. editable-design/skills → image-layer Skill 结构

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/editable-design/TOOLKIT.md` | 多 skill 产品说明、安装/sparse 方式、交付物表 | `skills/image-layer/README` 风格参考；根文档 | 约定 only |
| `reference/editable-design/skills/editable-design/SKILL.md` | 完整 skill 叙事：交付物、沟通规则、执行路径、证据与分层 | `skills/image-layer/SKILL.md` | 约定 only（结构对齐） |
| `reference/editable-design/skills/editable-design/README.md` | skill 依赖、能力边界、运行时说明 | `skills/image-layer/README.md` | 约定 only |
| `reference/editable-design/skills/editable-design/THIRD_PARTY_NOTICES.md` | 第三方资源声明范本 | `third_party_notices/` | 约定 only |
| `reference/editable-design/skills/editable-design/references/*.md` | 子文档：编辑器运行时、字体、图层/replay 契约、布局排印 | `skills/image-layer/references/`（可选） | 约定 only |
| `reference/editable-design/skills/editable-design/references/replay-contract.md` | Design Replay / 证据链契约 | `packages/layer-core` 概念模型（层与回放） | 约定 only |
| `reference/editable-design/skills/editable-design/scripts/`（`bake.mjs`、`explode.mjs`、`verify*.mjs` 等） | 分层烘焙/爆炸/校验脚本思路 | `packages/layer-core` API 草案 | 仅阅读（不复制业务脚本） |
| `reference/editable-design/skills/editable-design/assets/` | skill 附带 starter/editor/replay 资源布局 | `skills/image-layer/assets/` 目录约定 | 约定 only |
| `reference/editable-design/skills/editable-design/agents/openai.yaml` | agent 侧 skill 装配清单 | 可选 skill-loader 发现侧 | 仅阅读 |
| `reference/editable-design/skills/html-to-pptx/SKILL.md` | 另一 skill 的 frontmatter + 流程写法 | `skills/image-layer` 写法对照 | 仅阅读 |
| `reference/editable-design/skills/paper-fig/SKILL.md` + `references/` | 复杂 skill 的 references 拆分方式 | `skills/image-layer` 信息架构 | 仅阅读 |

**抽出结论（image-layer Skill 结构）**
- 建议目录：

```text
skills/image-layer/
  SKILL.md              # name / description / triggers + 工作流
  README.md             # 依赖、边界、如何调用
  references/           # 分层契约、导出格式、限制（按需）
  assets/               # 可选模板/示例
```

- SKILL.md 正文应覆盖：交付物清单、执行路径、失败降级、用户可见沟通边界（少谈工具与路径）。
- 分层相关概念（层顺序、RGBA、导出 zip/pptx/psd、证据）写入 `references/` 或层契约，不塞进 MCP。

---

## 4. tldraw/templates/agent → canvas

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/tldraw/templates/agent/README.md` | agent 画布 starter：能力面、输入上下文、可编程 `prompt()` | `packages/canvas` 能力边界说明 | 约定 only |
| `reference/tldraw/templates/agent/client/`（`App.tsx`、`agent/`、`components/`、`overlays/`） | 浏览器侧画布壳 + agent UI 集成 | `packages/canvas` 应用层 | 仅阅读 |
| `reference/tldraw/templates/agent/client/parts/*` | Prompt Part：视口、选区、截图、历史、lint、todo 等「模型可见」切片 | `packages/canvas` 状态导出/快照 API 草案 | 约定 only |
| `reference/tldraw/templates/agent/client/actions/*` | Agent Action：create/update/delete/align/resize/pen/think/todo… | `packages/canvas` 命令面草案 | 约定 only |
| `reference/tldraw/templates/agent/client/modes/` | mode 系统：parts=能看什么，actions=能做什么；生命周期钩子 | `packages/canvas` 权限/模式（后续） | 约定 only |
| `reference/tldraw/templates/agent/shared/schema/*`、`shared/types/*` | client/worker 共享 schema 与类型 | `packages/canvas` 与 `packages/mcp-server` 共享类型 | 少量代码（类型形状可改写） |
| `reference/tldraw/templates/agent/worker/`（`do/`、`prompt/`、`routes/`） | 模型请求、系统提示组装、Durable Object 服务 | `packages/model-registry` 调用侧接口 | 仅阅读（不接模型） |
| `reference/tldraw/packages/editor`、`packages/tldraw`、`packages/tlschema` | 完整画布内核与 schema | 不 vendoring；作 canvas 选型对照 | 仅阅读 |

**抽出结论（canvas）**
- 画布职责：几何/选择/视口/序列化/工具；**不**在 canvas 内实现 MCP 或模型。
- 对 agent 暴露两类契约：
  1. **Parts（读）**：选区、视口内 shape 简化、截图、历史、lints；
  2. **Actions（写）**：增删改 shape、变换、分组命令、think/message/todo。
- LayerForge `packages/canvas` 先定 shape/layer 数据结构与读写命令接口，渲染内核后续再定（不绑定 tldraw）。

---

## 5. frameground → 文件型项目约定

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/frameground/skills/frame.md` | 文件型项目布局：`PROJECT.md`、`DESIGN.md`、`frames.json`、`.opendesign/layout.json`、每 frame 一个 HTML | LayerForge 工程/画布文档约定参考 | 约定 only |
| `reference/frameground/skills/frontend-design.md`、`alternatives.md`、`port.md` | skill 如何写「美学锁定」与产物契约 | `skills/image-layer` 风格约束写法 | 仅阅读 |
| `reference/frameground/server/`（`projects.ts`、`manifest.ts`、`design.ts`、`layout.ts`、`watcher.ts`） | 以文件系统为真源，dev server watch + SSE 推送 | `packages/canvas` 与本地工程读写约定 | 约定 only |
| `reference/frameground/server/api.ts`、`settings.ts` | HTTP 面：workspace/projects 查询与创建 | 本地工具 API 风格（后续） | 仅阅读 |
| `reference/frameground/src/shapes/`（`HtmlFrameShape`） | 画布上承载 HTML frame 的 shape 形态 | `packages/canvas` 的 frame/layer 节点形态 | 仅阅读 |
| `reference/frameground/src/components|context|hooks|lib|pages` | 画布 UI 与项目上下文 | `packages/canvas` UI（后续） | 仅阅读 |
| `reference/frameground/AGENTS.md`、`CLAUDE.md` | 仓库/工具使用说明文档形态 | 根文档风格 | 仅阅读 |

**抽出结论（文件型项目）**
- 推荐 LayerForge 轻量工程约定（概念对齐，不照搬 frames）：

```text
<project>/
  PROJECT.md            # 意图与产物清单
  DESIGN.md             # 视觉方向（token + 正文）——可选
  layers.json           # 层列表 [{ id, name, file, order }]
  assets/ 或 layers/    # 分层位图/资源
  <layer-id>.png / .json
```

- 文件系统是真源；MCP/canvas 读写该目录，服务端只 watch/同步，不另建影子状态库（与 designjs「画布真源」一致）。

---

## 6. qwen-image-layered → 分层模型调用

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/qwen-image-layered/README.md` | 分层拆解模型定位、推理参数、依赖（diffusers / pptx / psd） | `packages/model-registry` 能力描述；`skills/image-layer` 用户文案 | 约定 only |
| `reference/qwen-image-layered/src/app.py` | `QwenImageLayeredPipeline` 加载与 `infer()` 参数：image/prompt/seed/cfg/steps/layers/resolution/cfg_normalize/use_en_prompt | `packages/model-registry` 的 Layered 分解接口字段 | 约定 only（参数表） |
| `reference/qwen-image-layered/src/app.py`（`imagelist_to_pptx` / `imagelist_to_psd` / export） | 层序列导出 pptx/psd/zip 的产物形态 | `packages/layer-core` 导出契约 | 约定 only |
| `reference/qwen-image-layered/src/tool/edit_rgba_image.py` | 单层 RGBA 编辑（Qwen-Image-Edit + RMBG）流水线形态 | `packages/model-registry` 可选「层编辑」能力 | 仅阅读（本阶段不接） |
| `reference/qwen-image-layered/src/tool/combine_layers.py` | 自底向上 `Image.alpha_composite` 合并层 | `packages/layer-core` 合成语义 | 少量代码（纯合成逻辑可改写） |
| `reference/qwen-image-layered/assets/test_images/` | 输入样例 | 测试夹具（后续） | 仅阅读 |
| `reference/qwen-image-layered/LICENSE`、`README` 中模型/权重条款 | 权重与代码许可边界 | `third_party_notices/` | 约定 only |

**抽出结论（分层模型调用）**
- 能力面（接口级，不接权重）：
  - `decompose(image, layers, resolution, seed, true_cfg_scale, num_inference_steps, negative_prompt, cfg_normalize, use_en_prompt) -> RGBA[]`
  - `combine(layers[] order: bottom→top) -> composite`
  - `export(layers[], format: png-seq | zip | pptx | psd)`
- LayerForge **不**在本阶段加载 `QwenImageLayeredPipeline`；`packages/model-registry` 只保留 provider/capability 描述与参数 schema 草案。
- 层语义约定：**RGBA、自底向上、可独立编辑**；与 `layer-core`、`image-layer` skill 文案保持一致。

---

## 7. third_party_notices 汇总来源

| 源路径 | 用途 | 目标路径 | 计划 |
| --- | --- | --- | --- |
| `reference/open-design/LICENSE` + skills 各 `LICENSE` | Apache-2.0 / 混合许可 | `third_party_notices/open-design.md` | 约定 only |
| `reference/designjs/LICENSE`、`packages/*/LICENSE`、`NOTICE` | MIT | `third_party_notices/designjs.md` | 约定 only |
| `reference/editable-design/LICENSE`、`skills/*/LICENSE`、`THIRD_PARTY_NOTICES.md` | Apache-2.0 + 第三方资源 | `third_party_notices/editable-design.md` | 约定 only |
| `reference/tldraw/LICENSE.md`、`templates/agent/LICENSE.md` | tldraw 许可 | `third_party_notices/tldraw.md` | 约定 only |
| `reference/frameground/LICENSE` | 仓库许可 | `third_party_notices/frameground.md` | 约定 only |
| `reference/qwen-image-layered/LICENSE` + README 权重说明 | 代码许可 + 模型权重/商标边界 | `third_party_notices/qwen-image-layered.md` | 约定 only |

> 若后续真实复制任何源码片段，在对应 notices 文件中标注出处路径与改写范围。

---

## 8. 本阶段明确不落地

| 事项 | 原因 |
| --- | --- |
| MCP 协议实现与工具 handlers | 仅整理约定，见 `packages/mcp-server` 计划 |
| 模型加载 / GPU 推理 / API Key | 仅参数与能力描述，见 `packages/model-registry` |
| 画布渲染与编辑业务代码 | 仅 Parts/Actions 契约草案，见 `packages/canvas` |
| 从 reference 大规模 vendor 源码 | 先定边界；需要时按表中「少量代码」逐文件引用并写入 notices |

---

## 9. 建议落地顺序（后续步骤，非本阶段）

1. `packages/layer-core` — 层数据结构、合成/导出契约（对齐 qwen + editable-design）
2. `skills/image-layer` — SKILL.md 与目录骨架（对齐 open-design / editable-design）
3. `packages/skill-loader` — 发现与 frontmatter 校验（对齐 open-design skills-protocol）
4. `packages/mcp-server` — schema 驱动工具表 + 无状态转发（对齐 designjs bridge）
5. `packages/canvas` — shape/layer 读写命令与快照 parts（对齐 tldraw agent / frameground）
6. `packages/model-registry` — provider 能力与参数 schema（对齐 qwen README/app.py）
7. `third_party_notices/` — 随实际引用补全
