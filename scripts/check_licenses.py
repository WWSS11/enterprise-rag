from __future__ import annotations

import json
import re
from collections import deque
from importlib.metadata import Distribution, distributions
from pathlib import Path
from typing import Any

from packaging.requirements import Requirement

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = REPOSITORY_ROOT / ".github" / "license-policy.json"
PACKAGE_LOCK_PATH = REPOSITORY_ROOT / "frontend" / "package-lock.json"
PROJECT_DISTRIBUTION = "rag-study-helper-enterprise"
EXPRESSION_OPERATORS = {"AND", "OR", "WITH"}
SPDX_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9.+-]*")

CLASSIFIER_LICENSES = {
    "License :: OSI Approved :: Apache Software License": "Apache-2.0",
    "License :: OSI Approved :: BSD License": "BSD-3-Clause",
    "License :: OSI Approved :: MIT License": "MIT",
    "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "License :: OSI Approved :: Python Software Foundation License": "PSF-2.0",
}


def normalized_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def policy() -> tuple[set[str], set[str]]:
    payload = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    return set(payload["allowed_spdx_ids"]), set(payload["notice_required_spdx_ids"])


def classifier_expression(distribution: Distribution) -> str | None:
    values = {
        CLASSIFIER_LICENSES[classifier]
        for classifier in distribution.metadata.get_all("Classifier", [])
        if classifier in CLASSIFIER_LICENSES
    }
    return " OR ".join(sorted(values)) if values else None


def python_license_expression(distribution: Distribution) -> str | None:
    expression = distribution.metadata.get("License-Expression")
    if expression:
        return expression.strip()

    raw = (distribution.metadata.get("License") or "").strip()
    first_line = raw.splitlines()[0].strip() if raw else ""
    if not first_line or first_line in {"UNKNOWN", "Dual License"}:
        return classifier_expression(distribution)
    if first_line in {"BSD", "New BSD", "Modified BSD License", "3-Clause BSD License"}:
        return "BSD-3-Clause"
    if first_line == "BSD 3-Clause License":
        return "BSD-3-Clause"
    if first_line in {"Apache 2.0", "Apache License, Version 2.0"}:
        return "Apache-2.0"
    if first_line == "MIT License" or raw.startswith("MIT License\n"):
        return "MIT"
    if first_line == "PSFL":
        return "PSF-2.0"
    return first_line


def expression_ids(expression: str) -> set[str]:
    return {
        token
        for token in SPDX_TOKEN.findall(expression)
        if token not in EXPRESSION_OPERATORS
    }


def npm_packages() -> list[tuple[str, str, str | None]]:
    payload: dict[str, Any] = json.loads(PACKAGE_LOCK_PATH.read_text(encoding="utf-8"))
    packages = []
    for path, metadata in payload.get("packages", {}).items():
        if not path:
            continue
        name = metadata.get("name") or path.rsplit("node_modules/", maxsplit=1)[-1]
        packages.append((name, str(metadata.get("version", "unknown")), metadata.get("license")))
    return packages


def python_project_distributions() -> list[Distribution]:
    installed: dict[str, Distribution] = {}
    for item in distributions():
        name = item.metadata.get("Name")
        if name:
            installed.setdefault(normalized_name(name), item)

    root = installed.get(PROJECT_DISTRIBUTION)
    if root is None:
        raise RuntimeError(
            "Project distribution is not installed; install the project "
            "with its dev dependencies first"
        )

    selected: dict[str, Distribution] = {}
    processed_extras: dict[str, set[str]] = {}
    pending: deque[tuple[Distribution, set[str]]] = deque([(root, {"", "dev"})])
    while pending:
        item, requested_extras = pending.popleft()
        name = normalized_name(item.metadata.get("Name") or "")
        new_extras = requested_extras - processed_extras.setdefault(name, set())
        if not new_extras:
            continue
        processed_extras[name].update(new_extras)
        if name != PROJECT_DISTRIBUTION:
            selected[name] = item

        for raw_requirement in item.requires or []:
            requirement = Requirement(raw_requirement)
            contexts = new_extras or {""}
            if requirement.marker and not any(
                requirement.marker.evaluate({"extra": extra}) for extra in contexts
            ):
                continue
            dependency_name = normalized_name(requirement.name)
            dependency = installed.get(dependency_name)
            if dependency is None:
                raise RuntimeError(
                    f"Installed dependency metadata is missing for {requirement.name!r}"
                )
            pending.append((dependency, set(requirement.extras) | {""}))

    return sorted(
        selected.values(),
        key=lambda item: normalized_name(item.metadata.get("Name") or ""),
    )


def main() -> int:
    allowed, notice_required = policy()
    failures: list[str] = []
    notices: list[str] = []
    checked = 0

    for distribution in python_project_distributions():
        name = distribution.metadata.get("Name") or "unknown"
        expression = python_license_expression(distribution)
        checked += 1
        if not expression:
            failures.append(f"Python {name} {distribution.version}: missing license metadata")
            continue
        identifiers = expression_ids(expression)
        unknown = identifiers - allowed
        if not identifiers or unknown:
            failures.append(
                f"Python {name} {distribution.version}: unapproved license {expression!r}"
            )
            continue
        if identifiers & notice_required:
            notices.append(f"Python {name} {distribution.version}: {expression}")

    for name, version, expression in npm_packages():
        checked += 1
        if not expression:
            failures.append(f"npm {name} {version}: missing license metadata")
            continue
        identifiers = expression_ids(expression)
        unknown = identifiers - allowed
        if not identifiers or unknown:
            failures.append(f"npm {name} {version}: unapproved license {expression!r}")
            continue
        if identifiers & notice_required:
            notices.append(f"npm {name} {version}: {expression}")

    if notices:
        print("Dependencies requiring license/attribution notices when distributed:")
        for item in sorted(set(notices)):
            print(f"- {item}")

    if failures:
        print("License policy check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(f"License policy check passed ({checked} installed Python/npm packages checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
