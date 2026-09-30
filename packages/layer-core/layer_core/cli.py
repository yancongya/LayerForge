"""layer-core CLI.

Examples:
  python -m layer_core.cli decompose projects/demo --source projects/demo/source.png
  python -m layer_core.cli list projects/demo
  python -m layer_core.cli reorder projects/demo base,fg,mid
  python -m layer_core.cli group projects/demo mid,fg --name "Content"
  python -m layer_core.cli ungroup projects/demo g1
  python -m layer_core.cli compose projects/demo
  python -m layer_core.cli export projects/demo --out projects/demo/dist
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .compose import compose_project
from .decompose import mock_decompose
from .export import export_layers
from .layers import (
    LayersError,
    group_layers,
    load_layers_document,
    reorder_layers,
    save_layers_document,
    set_group_collapsed,
    ungroup_layers,
)


def _doc_payload(doc) -> dict:
    return {
        "layers": [
            {
                "id": layer.id,
                "name": layer.name,
                "file": layer.file,
                "order": layer.order,
                "groupId": layer.groupId,
            }
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


def _cmd_list(project: Path) -> int:
    doc = load_layers_document(project)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_decompose(project: Path, source: Path, layer_count: int) -> int:
    layers = mock_decompose(project, source, layer_count=layer_count)
    doc = load_layers_document(project)
    print(json.dumps(_doc_payload(doc), indent=2, ensure_ascii=False))
    return 0


def _cmd_compose(project: Path, output: str) -> int:
    out = compose_project(project, output_name=output)
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

    p_compose = sub.add_parser("compose", help="Write composite.png")
    p_compose.add_argument("project", type=Path)
    p_compose.add_argument("--output", default="composite.png")

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
            return _cmd_compose(args.project, args.output)
        if args.command == "reorder":
            return _cmd_reorder(args.project, args.order)
        if args.command == "group":
            return _cmd_group(args.project, args.members, args.name)
        if args.command == "ungroup":
            return _cmd_ungroup(args.project, args.group_id)
        if args.command == "collapse":
            return _cmd_collapse(args.project, args.group_id, collapsed=not args.open)
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
