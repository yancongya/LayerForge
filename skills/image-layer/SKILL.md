---
name: image-layer
description: LayerForge image-layer skill. Split an image into editable RGBA layers, reorder them, compose a composite PNG, and export layer packs. Use when the user asks to decompose an image into layers, reorder/stack layers, compose layers into one image, or export layers as zip/png sequence. Do not use for full website building, slide decks, or video editing.
triggers:
  - "image layers"
  - "split image into layers"
  - "layered PNG"
  - "compose layers"
  - "export layers"
  - "RGBA layers"
  - "分层"
  - "图层合成"
  - "拆图层"
---

# Image Layer

Work on a **LayerForge project directory**. The filesystem is the source of truth: `layers.json` plus one image file per layer. Do not invent a shadow state store.

## Project layout

```text
<project>/
  layers.json
  layers/
    bg.png
    mid.png
    fg.png
  composite.png      # written by compose
  dist/              # written by export_layers
```

### layers.json

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

- `order` is **bottom → top** (0 painted first).
- `file` is relative to the project root.
- `id` must be unique.

## Tools

Prefer the LayerForge MCP tools when available. They map 1:1 to the CLI.

| Tool | CLI | Purpose |
| --- | --- | --- |
| `get_layers` | `python -m layer_core.cli list <project>` | Read layers bottom→top |
| `reorder_layers` | `python -m layer_core.cli reorder <project> <ids...>` | Set stacking order |
| `compose` | `python -m layer_core.cli compose <project>` | Write `composite.png` |
| `export_layers` | `python -m layer_core.cli export <project> --out <dir>` | png-seq / zip / composite |
| `decompose` | *(mock only)* | Stub 2-layer split; real model via model-registry later |

### MCP arguments (summary)

- `get_layers` / `compose` / `export_layers` / `decompose`: `project` (required)
- `reorder_layers`: `project`, `id_order` (array of ids, bottom→top)
- `compose` optional `output` (default `composite.png`)
- `export_layers` optional `out_dir`, `formats` ∈ `png-seq` | `zip` | `composite`
- `decompose` requires `image` (mock provider only in MVP)

## Workflow

### 1. Open or create a project

- If the user already has a project directory, call `get_layers` with that path.
- If starting from one image, either:
  - ask for an existing LayerForge project, or
  - use `decompose` **only as a mock scaffold** and say clearly that the model is not wired yet; keep user imagery intact as the base layer when possible.

### 2. Inspect

Run `get_layers`. Confirm every `file` exists. If a file is missing, stop and tell the user which id/path is broken.

### 3. Reorder (when asked)

Call `reorder_layers` with the full id list bottom→top. Never partial-list. Afterward call `get_layers` again and confirm order.

### 4. Compose

Call `compose` (default writes `<project>/composite.png`). Report the output path in plain language, e.g. “合成图已写入 composite.png”.

### 5. Export

Call `export_layers` with `formats` as needed:

- `png-seq` — ordered `00_id.png`, `01_id.png`, …
- `zip` — same ordered PNGs in `layers.zip`
- `composite` — `composite.png`

## Constraints

- Do not load real generative models from this skill. Model providers belong in `packages/model-registry`.
- Do not implement canvas UI here. This skill only manages project files and layer operations.
- Composition rule: RGBA, scale to min height when heights differ, `Image.alpha_composite` bottom→top (same as Qwen-Image-Layered `combine_layers`).
- Keep user-facing messages about the poster/image and results. Mention tools/paths only when the user must act.

## Quick local check (no MCP)

```powershell
$env:PYTHONPATH = "packages/layer-core"
python -m layer_core.cli list projects/demo
python -m layer_core.cli compose projects/demo
python -m layer_core.cli export projects/demo --out projects/demo/dist
```

Expected: `projects/demo/composite.png` and `projects/demo/dist/{00_bg.png,01_mid.png,02_fg.png,layers.zip,composite.png}`.

## See also

- `packages/layer-core/README.md` — schema and CLI
- `packages/mcp-server/README.md` — tool registration and smoke test
- `docs/reference-extract.md` — source mapping (editable-design / open-design / qwen)
