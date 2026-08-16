from __future__ import annotations

import argparse
from pathlib import Path

from app.services.evaluation_package_service import (
    load_evaluation_package,
    require_t13_business_baseline,
    summarize_evaluation_package,
    summary_as_json,
    validate_evaluation_package_sources,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate an Enterprise RAG evaluation package without uploading its data."
    )
    parser.add_argument("package", type=Path, help="Path to the evaluation package JSON")
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=Path.cwd(),
        help="Root used to resolve document source_path values",
    )
    parser.add_argument(
        "--require-t13",
        action="store_true",
        help="Enforce the real business-baseline size and safety requirements",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    package = load_evaluation_package(args.package)
    validate_evaluation_package_sources(package, repository_root=args.repository_root)
    if args.require_t13:
        require_t13_business_baseline(package)
    print(summary_as_json(summarize_evaluation_package(package)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
