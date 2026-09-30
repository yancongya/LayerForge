"""Model registry CLI (mock providers, schema dump).

Examples:
  python -m model_registry.cli list
  python -m model_registry.cli describe mock/layered-v0
  python -m model_registry.cli params
"""

from __future__ import annotations

import argparse
import json
import sys

from .providers import (
    LayeredDecomposeParams,
    ModelRegistryError,
    build_decompose_params,
    describe_provider,
    list_providers,
    mock_decompose_info,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="model-registry")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List providers")
    p_list.add_argument("--kind", default=None)

    p_desc = sub.add_parser("describe", help="Describe one provider")
    p_desc.add_argument("provider_id")

    p_params = sub.add_parser("params", help="Show default decompose params + pipeline kwargs")
    p_params.add_argument("--json", dest="as_json", action="store_true")

    args = parser.parse_args(argv)
    try:
        if args.command == "list":
            items = [describe_provider(spec.id) for spec in list_providers(args.kind)]
            print(json.dumps(items, indent=2, ensure_ascii=False))
            return 0
        if args.command == "describe":
            print(json.dumps(describe_provider(args.provider_id), indent=2, ensure_ascii=False))
            return 0
        if args.command == "params":
            info = mock_decompose_info(build_decompose_params())
            print(json.dumps(info, indent=2, ensure_ascii=False))
            return 0
    except ModelRegistryError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
