from __future__ import annotations

import re
import subprocess
from pathlib import Path

MAX_FILE_BYTES = 2 * 1024 * 1024
SECRET_PATTERNS = {
    "private key": re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
    ),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "OpenAI-style API key": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
}


def repository_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True,
        stdout=subprocess.PIPE,
    )
    return [Path(item) for item in result.stdout.decode().split("\0") if item]


def main() -> int:
    findings: list[tuple[Path, int, str]] = []
    scanned = 0

    for path in repository_files():
        if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        scanned += 1
        for line_number, line in enumerate(content.splitlines(), start=1):
            for label, pattern in SECRET_PATTERNS.items():
                if pattern.search(line):
                    findings.append((path, line_number, label))

    for path, line_number, label in findings:
        print(f"Potential {label} in {path}:{line_number}")

    if findings:
        print(f"Secret scan failed with {len(findings)} potential finding(s).")
        return 1

    print(f"Secret scan passed ({scanned} text files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
