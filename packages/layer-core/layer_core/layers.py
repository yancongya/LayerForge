"""LayerForge layer-core: layers.json schema and project loading.

layers.json schema (project root) — version 2:
{
  "version": 2,
  "layers": [
    {"id": "bg", "name": "Background", "file": "layers/bg.png", "order": 0, "groupId": null},
    {"id": "fg", "name": "Label", "file": "layers/fg.png", "order": 1, "groupId": "g1"}
  ],
  "groups": [
    {"id": "g1", "name": "Group 1", "order": 1}
  ]
}

- order is bottom→top (0 painted first) for compose.
- groups are same-level only (no nesting). Members share groupId.
- version 1 files (no groups) load fine and upgrade on save.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

LAYERS_FILENAME = "layers.json"
LAYERS_SCHEMA_VERSION = 2


class LayersError(ValueError):
    """Invalid layers.json or project layout."""


@dataclass
class Layer:
    id: str
    name: str
    file: str
    order: int
    groupId: str | None = None

    def resolved_path(self, project_root: Path) -> Path:
        return (project_root / self.file).resolve()


@dataclass
class LayerGroup:
    id: str
    name: str
    order: int
    memberIds: list[str] = field(default_factory=list)
    collapsed: bool = False


@dataclass
class ProjectLayers:
    layers: list[Layer]
    groups: list[LayerGroup]

    def sorted_layers(self) -> list[Layer]:
        return sorted(self.layers, key=lambda layer: (layer.order, layer.id))

    def sorted_groups(self) -> list[LayerGroup]:
        return sorted(self.groups, key=lambda g: (g.order, g.id))


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
    return Layer(
        id=lid.strip(),
        name=name.strip(),
        file=file.strip().replace("\\", "/"),
        order=order,
        groupId=group_id.strip() if isinstance(group_id, str) and group_id.strip() else None,
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
    return LayerGroup(
        id=gid.strip(),
        name=name.strip(),
        order=order,
        memberIds=[m.strip() for m in members],
        collapsed=bool(raw.get("collapsed", False)),
    )


def parse_layers_document(data: Any) -> ProjectLayers:
    if not isinstance(data, dict):
        raise LayersError("layers.json root must be an object")
    version = data.get("version", 1)
    if version not in (1, LAYERS_SCHEMA_VERSION):
        raise LayersError(f"unsupported layers.json version: {version!r}")
    raw_layers = data.get("layers")
    if not isinstance(raw_layers, list) or not raw_layers:
        raise LayersError("layers.json must contain a non-empty 'layers' array")
    layers = [validate_layer(item, i) for i, item in enumerate(raw_layers)]
    ids = [layer.id for layer in layers]
    if len(ids) != len(set(ids)):
        raise LayersError("layer ids must be unique")

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
        normalized.append(
            LayerGroup(
                id=group.id,
                name=group.name,
                order=group.order,
                memberIds=list(members),
                collapsed=group.collapsed,
            )
        )
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

    return ProjectLayers(layers=layers, groups=normalized)


def sort_layers_bottom_to_top(layers: list[Layer]) -> list[Layer]:
    return sorted(layers, key=lambda layer: (layer.order, layer.id))


def load_layers_document(project_root: Path | str) -> ProjectLayers:
    root = Path(project_root)
    path = root / LAYERS_FILENAME
    if not path.is_file():
        raise LayersError(f"missing {LAYERS_FILENAME} in {root}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LayersError(f"invalid JSON in {path}: {exc}") from exc
    return parse_layers_document(data)


def load_layers(project_root: Path | str) -> list[Layer]:
    """Back-compat: layer list only."""
    return load_layers_document(project_root).layers


def save_layers_document(project_root: Path | str, doc: ProjectLayers) -> Path:
    root = Path(project_root)
    path = root / LAYERS_FILENAME
    payload = {
        "version": LAYERS_SCHEMA_VERSION,
        "layers": [
            asdict(layer) if layer.groupId else {**asdict(layer), "groupId": None}
            for layer in doc.sorted_layers()
        ],
        "groups": [
            {
                "id": g.id,
                "name": g.name,
                "order": g.order,
                "memberIds": g.memberIds,
                "collapsed": g.collapsed,
            }
            for g in doc.sorted_groups()
        ],
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
    return [
        Layer(
            id=lid,
            name=current[lid].name,
            file=current[lid].file,
            order=index,
            groupId=current[lid].groupId,
        )
        for index, lid in enumerate(id_order)
    ]


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
    group = LayerGroup(
        id=gid,
        name=name or f"Group {len(doc.groups) + 1}",
        order=g_order,
        memberIds=members,
        collapsed=True,  # new groups start as a stacked card
    )
    layers = []
    for layer in doc.sorted_layers():
        if layer.id in set(members):
            layers.append(
                Layer(
                    id=layer.id,
                    name=layer.name,
                    file=layer.file,
                    order=layer.order,
                    groupId=gid,
                )
            )
        else:
            layers.append(layer)
    return ProjectLayers(layers=layers, groups=[*doc.groups, group])


def ungroup_layers(doc: ProjectLayers, group_id: str) -> ProjectLayers:
    found = next((g for g in doc.groups if g.id == group_id), None)
    if not found:
        raise LayersError(f"unknown group id: {group_id}")
    layers = []
    for layer in doc.sorted_layers():
        if layer.groupId == group_id:
            layers.append(
                Layer(id=layer.id, name=layer.name, file=layer.file, order=layer.order, groupId=None)
            )
        else:
            layers.append(layer)
    groups = [g for g in doc.groups if g.id != group_id]
    return ProjectLayers(layers=layers, groups=groups)


def set_group_collapsed(doc: ProjectLayers, group_id: str, collapsed: bool) -> ProjectLayers:
    if not any(g.id == group_id for g in doc.groups):
        raise LayersError(f"unknown group id: {group_id}")
    groups = [
        LayerGroup(
            id=g.id,
            name=g.name,
            order=g.order,
            memberIds=list(g.memberIds),
            collapsed=collapsed if g.id == group_id else g.collapsed,
        )
        for g in doc.groups
    ]
    return ProjectLayers(layers=list(doc.layers), groups=groups)
