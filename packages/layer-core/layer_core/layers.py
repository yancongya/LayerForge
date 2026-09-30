"""LayerForge layer-core: layers.json schema and project loading.

layers.json schema (project root) — version 3:
{
  "version": 3,
  "rev": 12,
  "layers": [
    {
      "id": "bg", "name": "Background", "file": "layers/bg.png", "order": 0,
      "groupId": null,
      "x": 0, "y": 0, "w": 280, "h": 373,
      "imgW": 720, "imgH": 960,
      "visible": true, "locked": false
    }
  ],
  "groups": [
    {
      "id": "g1", "name": "Group 1", "order": 1, "memberIds": ["fg"],
      "collapsed": true, "x": 360, "y": 0, "w": 280, "h": 373,
      "imgW": 720, "imgH": 960
    }
  ]
}

Semantics that callers must respect:

- ``order`` is bottom→top (0 painted first) and is the ONLY thing compose reads.
- ``x/y/w/h`` is **canvas layout only**. It never affects compose: layers are
  full-frame slices stacked at native size. The UI must say so wherever cards
  are draggable (「位置不影响输出」).
- ``imgW/imgH`` is the PNG's natural pixel size (data, not UI). The canvas uses
  it to keep card aspect correct instead of assuming a fixed ratio.
- ``visible=false`` excludes the layer from compose and from the composite
  export. ``locked`` is a canvas-only guard against accidental selection.
- ``rev`` is a monotonic revision bumped on every save. The web API and the MCP
  server are two independent writers of this file, so callers should read
  ``rev`` back after a mutation and treat a surprise value as a conflict.
- Groups are same-level only (no nesting); members share ``groupId``. Members
  keep their own ``x/y`` while grouped (the canvas hides them), so ungrouping
  restores the exact previous layout.
- Version 1 / 2 files load fine and upgrade on save.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any

LAYERS_FILENAME = "layers.json"
LAYERS_SCHEMA_VERSION = 3

#: Default card width in canvas page units when a caller does not supply one.
DEFAULT_CARD_W = 280


class LayersError(ValueError):
    """Invalid layers.json or project layout."""


@dataclass
class Layer:
    id: str
    name: str
    file: str
    order: int
    groupId: str | None = None
    x: float = 0.0
    y: float = 0.0
    w: float = DEFAULT_CARD_W
    h: float = DEFAULT_CARD_W * 4 / 3
    imgW: int = 0
    imgH: int = 0
    visible: bool = True
    locked: bool = False

    @property
    def placed(self) -> bool:
        """False when the canvas still has to pick a position for this layer."""
        return not (self.x == 0 and self.y == 0 and self.imgW == 0)

    def resolved_path(self, project_root: Path) -> Path:
        return (project_root / self.file).resolve()


@dataclass
class LayerGroup:
    id: str
    name: str
    order: int
    memberIds: list[str] = field(default_factory=list)
    collapsed: bool = False
    x: float = 0.0
    y: float = 0.0
    w: float = DEFAULT_CARD_W
    h: float = DEFAULT_CARD_W * 4 / 3
    imgW: int = 0
    imgH: int = 0


@dataclass
class ProjectLayers:
    layers: list[Layer]
    groups: list[LayerGroup]
    rev: int = 0

    def sorted_layers(self) -> list[Layer]:
        return sorted(self.layers, key=lambda layer: (layer.order, layer.id))

    def sorted_groups(self) -> list[LayerGroup]:
        return sorted(self.groups, key=lambda g: (g.order, g.id))

    def get_layer(self, layer_id: str) -> Layer:
        found = next((layer for layer in self.layers if layer.id == layer_id), None)
        if found is None:
            raise LayersError(f"unknown layer id: {layer_id}")
        return found

    def get_group(self, group_id: str) -> LayerGroup:
        found = next((g for g in self.groups if g.id == group_id), None)
        if found is None:
            raise LayersError(f"unknown group id: {group_id}")
        return found


def _num(raw: dict[str, Any], key: str, default: float) -> float:
    value = raw.get(key, default)
    if value is None:
        return float(default)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise LayersError(f"{key} must be a number, got {value!r}")
    return float(value)


def _int(raw: dict[str, Any], key: str, default: int) -> int:
    value = raw.get(key, default)
    if value is None:
        return int(default)
    if not isinstance(value, int) or isinstance(value, bool):
        raise LayersError(f"{key} must be an integer, got {value!r}")
    return int(value)


def _bool(raw: dict[str, Any], key: str, default: bool) -> bool:
    value = raw.get(key, default)
    if value is None:
        return bool(default)
    if not isinstance(value, bool):
        raise LayersError(f"{key} must be a boolean, got {value!r}")
    return value


def card_size(img_w: int, img_h: int, card_w: float = DEFAULT_CARD_W) -> tuple[float, float]:
    """Card box that preserves the image aspect ratio (fixes the old 3:4 assumption)."""
    if img_w <= 0 or img_h <= 0:
        return card_w, card_w * 4 / 3
    return card_w, max(1.0, round(card_w * img_h / img_w))


def validate_layer(raw: dict[str, Any], index: int) -> Layer:
    if not isinstance(raw, dict):
        raise LayersError(f"layers[{index}] must be an object")
    for key in ("id", "name", "file", "order"):
        if key not in raw:
            raise LayersError(f"layers[{index}] missing required field '{key}'")
    lid = raw["id"]
    name = raw["name"]
    file = raw["file"]
    order = raw["order"]
    if not isinstance(lid, str) or not lid.strip():
        raise LayersError(f"layers[{index}].id must be a non-empty string")
    if not isinstance(name, str) or not name.strip():
        raise LayersError(f"layers[{index}].name must be a non-empty string")
    if not isinstance(file, str) or not file.strip():
        raise LayersError(f"layers[{index}].file must be a non-empty string")
    if not isinstance(order, int) or isinstance(order, bool):
        raise LayersError(f"layers[{index}].order must be an integer")
    group_id = raw.get("groupId")
    if group_id is not None and not isinstance(group_id, str):
        raise LayersError(f"layers[{index}].groupId must be string or null")
    img_w = _int(raw, "imgW", 0)
    img_h = _int(raw, "imgH", 0)
    default_w, default_h = card_size(img_w, img_h)
    return Layer(
        id=lid.strip(),
        name=name.strip(),
        file=file.strip().replace("\\", "/"),
        order=order,
        groupId=group_id.strip() if isinstance(group_id, str) and group_id.strip() else None,
        x=_num(raw, "x", 0.0),
        y=_num(raw, "y", 0.0),
        w=_num(raw, "w", default_w),
        h=_num(raw, "h", default_h),
        imgW=img_w,
        imgH=img_h,
        visible=_bool(raw, "visible", True),
        locked=_bool(raw, "locked", False),
    )


def validate_group(raw: dict[str, Any], index: int) -> LayerGroup:
    if not isinstance(raw, dict):
        raise LayersError(f"groups[{index}] must be an object")
    for key in ("id", "name", "order"):
        if key not in raw:
            raise LayersError(f"groups[{index}] missing required field '{key}'")
    gid = raw["id"]
    name = raw["name"]
    order = raw["order"]
    if not isinstance(gid, str) or not gid.strip():
        raise LayersError(f"groups[{index}].id must be a non-empty string")
    if not isinstance(name, str) or not name.strip():
        raise LayersError(f"groups[{index}].name must be a non-empty string")
    if not isinstance(order, int) or isinstance(order, bool):
        raise LayersError(f"groups[{index}].order must be an integer")
    members = raw.get("memberIds") or []
    if not isinstance(members, list) or not all(isinstance(m, str) for m in members):
        raise LayersError(f"groups[{index}].memberIds must be an array of strings")
    img_w = _int(raw, "imgW", 0)
    img_h = _int(raw, "imgH", 0)
    default_w, default_h = card_size(img_w, img_h)
    return LayerGroup(
        id=gid.strip(),
        name=name.strip(),
        order=order,
        memberIds=[m.strip() for m in members],
        collapsed=bool(raw.get("collapsed", False)),
        x=_num(raw, "x", 0.0),
        y=_num(raw, "y", 0.0),
        w=_num(raw, "w", default_w),
        h=_num(raw, "h", default_h),
        imgW=img_w,
        imgH=img_h,
    )


def parse_layers_document(data: Any) -> ProjectLayers:
    if not isinstance(data, dict):
        raise LayersError("layers.json root must be an object")
    version = data.get("version", 1)
    if version not in (1, 2, LAYERS_SCHEMA_VERSION):
        raise LayersError(f"unsupported layers.json version: {version!r}")
    raw_layers = data.get("layers")
    if not isinstance(raw_layers, list) or not raw_layers:
        raise LayersError("layers.json must contain a non-empty 'layers' array")
    layers = [validate_layer(item, i) for i, item in enumerate(raw_layers)]
    ids = [layer.id for layer in layers]
    if len(ids) != len(set(ids)):
        raise LayersError("layer ids must be unique")

    rev = _int(data, "rev", 0)

    raw_groups = data.get("groups") or []
    if not isinstance(raw_groups, list):
        raise LayersError("groups must be an array")
    groups = [validate_group(item, i) for i, item in enumerate(raw_groups)]
    gids = [g.id for g in groups]
    if len(gids) != len(set(gids)):
        raise LayersError("group ids must be unique")

    # Derive memberIds from layer.groupId when absent; keep consistent.
    by_group: dict[str, list[str]] = {}
    for layer in layers:
        if layer.groupId:
            by_group.setdefault(layer.groupId, []).append(layer.id)
    normalized: list[LayerGroup] = []
    for group in groups:
        members = group.memberIds or by_group.get(group.id, [])
        # ensure every member points at this group
        for lid in members:
            match = next((layer for layer in layers if layer.id == lid), None)
            if match is None:
                raise LayersError(f"group {group.id} references unknown layer {lid}")
            match.groupId = group.id
        normalized.append(replace(group, memberIds=list(members)))
    # groups that only exist via layer.groupId
    for gid, members in by_group.items():
        if not any(g.id == gid for g in normalized):
            normalized.append(
                LayerGroup(
                    id=gid,
                    name=gid,
                    order=len(normalized),
                    memberIds=list(members),
                    collapsed=False,
                )
            )
    # clear dangling groupIds
    valid = {g.id for g in normalized}
    for layer in layers:
        if layer.groupId and layer.groupId not in valid:
            layer.groupId = None

    return ProjectLayers(layers=layers, groups=normalized, rev=rev)


def sort_layers_bottom_to_top(layers: list[Layer]) -> list[Layer]:
    return sorted(layers, key=lambda layer: (layer.order, layer.id))


def visible_layers(layers: list[Layer]) -> list[Layer]:
    """Bottom→top, excluding layers hidden on the canvas. Compose reads this."""
    return [layer for layer in sort_layers_bottom_to_top(layers) if layer.visible]


def _measure(path: Path) -> tuple[int, int] | None:
    """Read a PNG/JPEG's natural size from its header (no pixel decode).

    Legacy v1/v2 projects carry no imgW/imgH; without this the canvas would keep
    drawing every card at the old hard-coded 3:4 box and stretch square sources.
    """
    try:
        from PIL import Image  # local import: layer-core stays importable without Pillow
    except Exception:
        return None
    if not path.is_file():
        return None
    try:
        with Image.open(path) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None


def load_layers_document(project_root: Path | str) -> ProjectLayers:
    root = Path(project_root)
    path = root / LAYERS_FILENAME
    if not path.is_file():
        raise LayersError(f"missing {LAYERS_FILENAME} in {root}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LayersError(f"invalid JSON in {path}: {exc}") from exc
    doc = parse_layers_document(data)
    _fill_missing_sizes(root, doc, data)
    return doc


def _fill_missing_sizes(root: Path, doc: ProjectLayers, data: Any) -> None:
    """Self-heal legacy files: measure imgW/imgH (and derive card size) when absent.

    Read-only — nothing is written back here; the next mutation persists it.
    """
    raw_layers = data.get("layers") if isinstance(data, dict) else None
    raw_by_id = {
        item.get("id"): item for item in (raw_layers or []) if isinstance(item, dict)
    }
    for layer in doc.layers:
        if layer.imgW > 0 and layer.imgH > 0:
            continue
        size = _measure(layer.resolved_path(root))
        if not size:
            continue
        layer.imgW, layer.imgH = size
        raw = raw_by_id.get(layer.id) or {}
        # Only recompute the card box when the file never carried one (legacy v1/v2),
        # so an explicit user resize is never clobbered.
        if "w" not in raw or "h" not in raw:
            layer.w, layer.h = card_size(*size)
    for group in doc.groups:
        if group.imgW > 0 and group.imgH > 0:
            continue
        cover = next(
            (layer for layer in doc.sorted_layers() if layer.id in group.memberIds), None
        )
        if cover and cover.imgW > 0:
            group.imgW, group.imgH = cover.imgW, cover.imgH
            group.w, group.h = card_size(cover.imgW, cover.imgH)


def load_layers(project_root: Path | str) -> list[Layer]:
    """Back-compat: layer list only."""
    return load_layers_document(project_root).layers


def save_layers_document(project_root: Path | str, doc: ProjectLayers) -> Path:
    root = Path(project_root)
    path = root / LAYERS_FILENAME
    doc.rev = int(doc.rev) + 1  # every write advances the revision
    payload = {
        "version": LAYERS_SCHEMA_VERSION,
        "rev": doc.rev,
        "layers": [asdict(layer) for layer in doc.sorted_layers()],
        "groups": [asdict(group) for group in doc.sorted_groups()],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def save_layers(project_root: Path | str, layers: list[Layer], groups: list[LayerGroup] | None = None) -> Path:
    """Back-compat save: layers (+ optional groups)."""
    doc = ProjectLayers(layers=layers, groups=groups or [])
    return save_layers_document(project_root, doc)


def reorder_layers(layers: list[Layer], id_order: list[str]) -> list[Layer]:
    """Reassign order so id_order is bottom→top. Every id must appear exactly once."""
    current = {layer.id: layer for layer in layers}
    if set(id_order) != set(current):
        raise LayersError("id_order must be a permutation of existing layer ids")
    if len(id_order) != len(set(id_order)):
        raise LayersError("id_order contains duplicates")
    return [replace(current[lid], order=index) for index, lid in enumerate(id_order)]


def group_layers(doc: ProjectLayers, member_ids: list[str], name: str | None = None) -> ProjectLayers:
    """Create a same-level group from selected layer ids. No nesting: members must be ungrouped."""
    if len(member_ids) < 2:
        raise LayersError("group requires at least 2 layers")
    if len(member_ids) != len(set(member_ids)):
        raise LayersError("member_ids contains duplicates")
    current = {layer.id: layer for layer in doc.layers}
    for mid in member_ids:
        if mid not in current:
            raise LayersError(f"unknown layer id: {mid}")
        if current[mid].groupId:
            raise LayersError("same-level only: layer is already in a group")

    gid = f"g{len(doc.groups) + 1}"
    while any(g.id == gid for g in doc.groups):
        gid = gid + "x"
    members = sorted(member_ids, key=lambda lid: (current[lid].order, lid))
    # group order = min member order (stacking position on canvas)
    g_order = min(current[lid].order for lid in members)
    # The canvas shows the bottom-most member as the card cover; mirror that here.
    cover = current[members[0]]
    card_w, card_h = card_size(cover.imgW, cover.imgH)
    group = LayerGroup(
        id=gid,
        name=name or f"Group {len(doc.groups) + 1}",
        order=g_order,
        memberIds=members,
        collapsed=True,  # new groups start as a stacked card
        x=min(current[lid].x for lid in members),
        y=min(current[lid].y for lid in members),
        w=card_w,
        h=card_h,
        imgW=cover.imgW,
        imgH=cover.imgH,
    )
    layers = [replace(layer, groupId=gid) if layer.id in set(members) else layer
              for layer in doc.sorted_layers()]
    return ProjectLayers(layers=layers, groups=[*doc.groups, group], rev=doc.rev)


def ungroup_layers(doc: ProjectLayers, group_id: str) -> ProjectLayers:
    found = next((g for g in doc.groups if g.id == group_id), None)
    if not found:
        raise LayersError(f"unknown group id: {group_id}")
    layers = [replace(layer, groupId=None) if layer.groupId == group_id else layer
              for layer in doc.sorted_layers()]
    groups = [g for g in doc.groups if g.id != group_id]
    return ProjectLayers(layers=layers, groups=groups, rev=doc.rev)


def set_group_collapsed(doc: ProjectLayers, group_id: str, collapsed: bool) -> ProjectLayers:
    if not any(g.id == group_id for g in doc.groups):
        raise LayersError(f"unknown group id: {group_id}")
    groups = [replace(g, collapsed=collapsed) if g.id == group_id else g for g in doc.groups]
    return ProjectLayers(layers=list(doc.layers), groups=groups, rev=doc.rev)


def rename_layer(doc: ProjectLayers, layer_id: str, name: str) -> ProjectLayers:
    """Persist a layer rename. Name must be non-empty after trimming."""
    clean = name.strip()
    if not clean:
        raise LayersError("layer name must not be empty")
    doc.get_layer(layer_id)  # raises LayersError on unknown id
    layers = [replace(layer, name=clean) if layer.id == layer_id else layer for layer in doc.layers]
    return ProjectLayers(layers=layers, groups=list(doc.groups), rev=doc.rev)


def rename_group(doc: ProjectLayers, group_id: str, name: str) -> ProjectLayers:
    clean = name.strip()
    if not clean:
        raise LayersError("group name must not be empty")
    doc.get_group(group_id)
    groups = [replace(g, name=clean) if g.id == group_id else g for g in doc.groups]
    return ProjectLayers(layers=list(doc.layers), groups=groups, rev=doc.rev)


def set_layer_flags(
    doc: ProjectLayers,
    layer_id: str,
    *,
    visible: bool | None = None,
    locked: bool | None = None,
) -> ProjectLayers:
    doc.get_layer(layer_id)
    layers = [
        replace(
            layer,
            visible=layer.visible if visible is None else visible,
            locked=layer.locked if locked is None else locked,
        )
        if layer.id == layer_id
        else layer
        for layer in doc.layers
    ]
    return ProjectLayers(layers=layers, groups=list(doc.groups), rev=doc.rev)


def delete_layer(doc: ProjectLayers, layer_id: str) -> ProjectLayers:
    """Remove a layer, renumber order bottom→top, and drop groups left empty."""
    doc.get_layer(layer_id)
    layers = [replace(layer, order=index) for index, layer in
              enumerate(sort_layers_bottom_to_top([l for l in doc.layers if l.id != layer_id]))]
    groups: list[LayerGroup] = []
    for group in doc.groups:
        members = [mid for mid in group.memberIds if mid != layer_id]
        if len(members) < 2:
            # a group needs at least 2 members; dissolve it and free the survivors
            continue
        groups.append(replace(group, memberIds=members))
    grouped = {g.id for g in groups}
    layers = [
        replace(layer, groupId=None) if layer.groupId and layer.groupId not in grouped else layer
        for layer in layers
    ]
    return ProjectLayers(layers=layers, groups=groups, rev=doc.rev)


def apply_layout(
    doc: ProjectLayers,
    layer_patches: list[dict[str, Any]],
    group_patches: list[dict[str, Any]] | None = None,
) -> ProjectLayers:
    """Apply canvas layout patches. Unknown ids and non-positive sizes are ignored.

    Only x/y/w/h change — never order, name or file.
    """
    def patch_one(target: Any, patch: dict[str, Any]) -> Any:
        changes: dict[str, float] = {}
        for key in ("x", "y"):
            if key in patch and patch[key] is not None:
                changes[key] = float(patch[key])
        for key in ("w", "h"):
            if key in patch and patch[key] is not None:
                value = float(patch[key])
                if value > 0:
                    changes[key] = value
        return replace(target, **changes) if changes else target

    layers = list(doc.layers)
    for patch in layer_patches or []:
        pid = str(patch.get("id", ""))
        index = next((i for i, layer in enumerate(layers) if layer.id == pid), None)
        if index is None:
            raise LayersError(f"unknown layer id in layout: {pid!r}")
        layers[index] = patch_one(layers[index], patch)

    groups = list(doc.groups)
    for patch in group_patches or []:
        pid = str(patch.get("id", ""))
        index = next((i for i, group in enumerate(groups) if group.id == pid), None)
        if index is None:
            raise LayersError(f"unknown group id in layout: {pid!r}")
        groups[index] = patch_one(groups[index], patch)

    return ProjectLayers(layers=layers, groups=groups, rev=doc.rev)
