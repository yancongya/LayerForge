"""layer-core CLI.

Examples:
  python -m layer_core.cli decompose projects/demo --source projects/demo/source.png
  python -m layer_core.cli list projects/demo
  python -m layer_core.cli reorder projects/demo base,fg,mid
  python -m layer_core.cli group projects/demo mid,fg --name "Content"
  python -m layer_core.cli ungroup projects/demo g1
  python -m layer_core.cli compose projects/demo
  python -m layer_core.cli rename projects/demo bg "Background plate"
  python -m layer_core.cli flag projects/demo bg --visible 0
  python -m layer_core.cli flag projects/demo fg --opacity 0.5
  python -m layer_core.cli delete projects/demo fg
  python -m layer_core.cli layout projects/demo '{"layers":[{"id":"bg","x":0,"y":0}]}'
  python -m layer_core.cli export projects/demo --out projects/demo/dist
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .compose import compose_project
from .decompose import mock_decompose
from .export import export_layers
from .layers import (
    LayersError,
    apply_layout,
    delete_layer,
    group_layers,
    load_layers_document,
    rename_group,
    rename_layer,
    reorder_layers,
    save_layers_document,
    set_group_collapsed,
    set_layer_flags,
    ungroup_layers,
)


def _doc_payload(doc) -> dict:
    return {
        "rev": doc.rev,
        "layers": [asdict(layer) for layer in doc.sorted_layers()],
        "groups": [asdict(group) for group in doc.sorted_groups()],
    }


def _cmd_list(project: Path) -> int:
    doc = load_layers_document(project)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_decompose(project: Path, source: Path, layer_count: int) -> int:
    layers = mock_decompose(project, source, layer_count=layer_count)
    doc = load_layers_document(project)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_compose(
    project: Path,
    output: str,
    ids: str | None = None,
    group: str | None = None,
) -> int:
    from .compose import compose_group

    if group:
        out = compose_group(project, group)
    else:
        id_list = [p.strip() for p in ids.split(",") if p.strip()] if ids else None
        out = compose_project(project, output_name=output, layer_ids=id_list)
    print(out)
    return 0


def _cmd_reorder(project: Path, order_arg: str) -> int:
    ids = [item.strip() for item in order_arg.split(",") if item.strip()]
    doc = load_layers_document(project)
    doc.layers = reorder_layers(doc.layers, ids)
    save_layers_document(project, doc)
    print(json.dumps({"id_order": ids}, ensure_ascii=False))
    return 0


def _cmd_group(project: Path, members_arg: str, name: str | None) -> int:
    ids = [item.strip() for item in members_arg.split(",") if item.strip()]
    doc = load_layers_document(project)
    doc = group_layers(doc, ids, name=name)
    save_layers_document(project, doc)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_ungroup(project: Path, group_id: str) -> int:
    doc = load_layers_document(project)
    doc = ungroup_layers(doc, group_id)
    save_layers_document(project, doc)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_collapse(project: Path, group_id: str, collapsed: bool) -> int:
    doc = load_layers_document(project)
    doc = set_group_collapsed(doc, group_id, collapsed)
    save_layers_document(project, doc)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_rename(project: Path, layer_id: str, name: str) -> int:
    doc = load_layers_document(project)
    save_layers_document(project, rename_layer(doc, layer_id, name))
    print(json.dumps({"renamed": layer_id, "name": name}, ensure_ascii=False))
    return 0


def _cmd_rename_group(project: Path, group_id: str, name: str) -> int:
    doc = load_layers_document(project)
    save_layers_document(project, rename_group(doc, group_id, name))
    print(json.dumps({"renamed": group_id, "name": name}, ensure_ascii=False))
    return 0


def _cmd_delete(project: Path, layer_id: str) -> int:
    doc = load_layers_document(project)
    save_layers_document(project, delete_layer(doc, layer_id))
    print(json.dumps({"deleted": layer_id}, ensure_ascii=False))
    return 0


def _flag(value: str | None) -> bool | None:
    if value is None:
        return None
    return value.strip().lower() in ("1", "true", "yes", "on")


def _opacity(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value.strip())
    except ValueError as exc:
        raise LayersError(f"opacity must be a number 0–1, got {value!r}") from exc
    return max(0.0, min(1.0, number))


def _cmd_flag(
    project: Path,
    layer_id: str,
    visible: str | None,
    locked: str | None,
    opacity: str | None,
) -> int:
    if visible is None and locked is None and opacity is None:
        raise LayersError("flag requires --visible and/or --locked and/or --opacity")
    parsed_opacity = _opacity(opacity)
    doc = load_layers_document(project)
    save_layers_document(
        project,
        set_layer_flags(
            doc,
            layer_id,
            visible=_flag(visible),
            locked=_flag(locked),
            opacity=parsed_opacity,
        ),
    )
    print(
        json.dumps(
            {
                "flagged": layer_id,
                "visible": visible,
                "locked": locked,
                "opacity": parsed_opacity if opacity is not None else None,
            },
            ensure_ascii=False,
        )
    )
    return 0


def _cmd_layout(project: Path, patches_json: str) -> int:
    try:
        patches = json.loads(patches_json)
    except json.JSONDecodeError as exc:
        raise LayersError(f"invalid layout JSON: {exc}") from exc
    if not isinstance(patches, dict):
        raise LayersError('layout JSON must be {"layers": [...], "groups": [...]}')
    layer_patches = patches.get("layers") or []
    group_patches = patches.get("groups") or []
    if not isinstance(layer_patches, list) or not isinstance(group_patches, list):
        raise LayersError("layout 'layers'/'groups' must be arrays")
    doc = load_layers_document(project)
    save_layers_document(project, apply_layout(doc, layer_patches, group_patches))
    print(json.dumps({"placed": len(layer_patches) + len(group_patches)}))
    return 0


def _cmd_export(project: Path, out_dir: Path, formats: list[str]) -> int:
    doc = load_layers_document(project)
    created = export_layers(project, doc.layers, out_dir, formats=tuple(formats))
    for path in created:
        print(path)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="layer-core", description="LayerForge layer-core CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="Print layers + groups")
    p_list.add_argument("project", type=Path)

    p_dec = sub.add_parser("decompose", help="Mock-split a source image into layers/")
    p_dec.add_argument("project", type=Path)
    p_dec.add_argument("--source", type=Path, required=True)
    p_dec.add_argument("--layers", type=int, default=3, dest="layer_count")

    p_compose = sub.add_parser("compose", help="Write composite.png (or a subset / group)")
    p_compose.add_argument("project", type=Path)
    p_compose.add_argument("--output", default="composite.png")
    p_compose.add_argument("--ids", default=None, help="comma-separated layer ids (subset)")
    p_compose.add_argument("--group", default=None, help="compose this group's members to groups/<id>.png")

    p_reorder = sub.add_parser("reorder", help="Set bottom-to-top order by id list")
    p_reorder.add_argument("project", type=Path)
    p_reorder.add_argument("order", help="comma-separated ids, bottom-to-top")

    p_group = sub.add_parser("group", help="Group same-level layers")
    p_group.add_argument("project", type=Path)
    p_group.add_argument("members", help="comma-separated layer ids")
    p_group.add_argument("--name", default=None)

    p_ungroup = sub.add_parser("ungroup", help="Ungroup by group id")
    p_ungroup.add_argument("project", type=Path)
    p_ungroup.add_argument("group_id")

    p_col = sub.add_parser("collapse", help="Collapse/expand a group (mind-map level)")
    p_col.add_argument("project", type=Path)
    p_col.add_argument("group_id")
    p_col.add_argument("--open", action="store_true", help="expand instead of collapse")

    p_ren = sub.add_parser("rename", help="Persist a layer rename")
    p_ren.add_argument("project", type=Path)
    p_ren.add_argument("layer_id")
    p_ren.add_argument("name")

    p_reng = sub.add_parser("rename-group", help="Persist a group rename")
    p_reng.add_argument("project", type=Path)
    p_reng.add_argument("group_id")
    p_reng.add_argument("name")

    p_del = sub.add_parser("delete", help="Delete a layer (renumber order, dissolve short groups)")
    p_del.add_argument("project", type=Path)
    p_del.add_argument("layer_id")

    p_flag = sub.add_parser("flag", help="Set a layer's visible / locked / opacity flags")
    p_flag.add_argument("project", type=Path)
    p_flag.add_argument("layer_id")
    p_flag.add_argument("--visible", default=None)
    p_flag.add_argument("--locked", default=None)
    p_flag.add_argument("--opacity", default=None, help="0–1, clamped; multiplies layer alpha")

    p_layout = sub.add_parser("layout", help="Persist canvas x/y/w/h patches (compose ignores them)")
    p_layout.add_argument("project", type=Path)
    p_layout.add_argument("patches", help='JSON: {"layers":[{"id","x","y","w","h"}],"groups":[...]}')

    p_export = sub.add_parser("export", help="Export png-seq / zip / composite")
    p_export.add_argument("project", type=Path)
    p_export.add_argument("--out", type=Path, required=True)
    p_export.add_argument("--formats", default="png-seq,zip,composite")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "list":
            return _cmd_list(args.project)
        if args.command == "decompose":
            return _cmd_decompose(args.project, args.source, args.layer_count)
        if args.command == "compose":
            return _cmd_compose(
                args.project,
                args.output,
                ids=getattr(args, "ids", None),
                group=getattr(args, "group", None),
            )
        if args.command == "reorder":
            return _cmd_reorder(args.project, args.order)
        if args.command == "group":
            return _cmd_group(args.project, args.members, args.name)
        if args.command == "ungroup":
            return _cmd_ungroup(args.project, args.group_id)
        if args.command == "collapse":
            return _cmd_collapse(args.project, args.group_id, collapsed=not args.open)
        if args.command == "rename":
            return _cmd_rename(args.project, args.layer_id, args.name)
        if args.command == "rename-group":
            return _cmd_rename_group(args.project, args.group_id, args.name)
        if args.command == "delete":
            return _cmd_delete(args.project, args.layer_id)
        if args.command == "flag":
            return _cmd_flag(args.project, args.layer_id, args.visible, args.locked, args.opacity)
        if args.command == "layout":
            return _cmd_layout(args.project, args.patches)
        if args.command == "export":
            formats = [item.strip() for item in args.formats.split(",") if item.strip()]
            return _cmd_export(args.project, args.out, formats)
    except (LayersError, FileNotFoundError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
