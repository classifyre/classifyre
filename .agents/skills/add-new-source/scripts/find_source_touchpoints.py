#!/usr/bin/env python3
"""Find likely source-type touchpoints across the Classifyre monorepo."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def resolve_repo_root(start: Path) -> Path:
    """Resolve monorepo root containing apps/ and packages/."""
    if (start / "classifyre").is_dir():
        return (start / "classifyre").resolve()
    if (start / "apps").is_dir() and (start / "packages").is_dir():
        return start.resolve()
    raise FileNotFoundError(
        f"Cannot locate repo root from {start}. Expected either <root>/classifyre or <root> with apps/ and packages/."
    )


def load_source_types(repo_root: Path) -> list[str]:
    schema_path = repo_root / "packages/schemas/src/schemas/all_input_sources.json"
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema not found: {schema_path}")

    data = json.loads(schema_path.read_text())
    values = data["definitions"]["AssetType"]["enum"]
    source_types = [str(v) for v in values if isinstance(v, str)]
    if not source_types:
        raise ValueError("No source types found in definitions.AssetType.enum")
    return source_types


def run_grep(pattern: str, search_paths: list[str], repo_root: Path) -> str:
    """Fallback for machines without ripgrep."""
    cmd = [
        "grep",
        "-rnIE",
        "--exclude=*.spec.ts",
        "--exclude-dir=test",
        "--exclude-dir=tests",
        "--exclude-dir=node_modules",
        "--exclude-dir=.next",
        "--exclude-dir=.turbo",
        "--exclude-dir=public",
        "--exclude-dir=playwright",
        "--exclude-dir=test-results",
        "--exclude-dir=generated",
        pattern,
        *search_paths,
    ]
    result = subprocess.run(cmd, cwd=repo_root, text=True, capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "grep failed")
    return result.stdout.strip()


def run_rg(pattern: str, search_paths: list[str], repo_root: Path) -> str:
    if shutil.which("rg") is None:
        return run_grep(pattern, search_paths, repo_root)
    cmd = [
        "rg",
        "-n",
        "--no-heading",
        "--color=never",
        "-g",
        "!**/*.spec.ts",
        "-g",
        "!**/test/**",
        "-g",
        "!**/tests/**",
        pattern,
        *search_paths,
    ]

    result = subprocess.run(
        cmd,
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )

    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "rg failed")

    return result.stdout.strip()


def build_pattern(tokens: list[str]) -> str:
    escaped = [re.escape(token) for token in tokens]
    return r"\b(?:" + "|".join(escaped) + r")\b"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find hardcoded source-type literals in Classifyre code paths."
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Workspace root or classifyre/ repo path",
    )
    args = parser.parse_args()

    repo_root = resolve_repo_root(Path(args.path))
    source_types = load_source_types(repo_root)

    uppercase_pattern = build_pattern(source_types)
    lowercase_pattern = build_pattern([value.lower() for value in source_types])

    paths_upper = [
        "apps/api/src",
        "apps/web",
        "packages/ui/src",
        "packages/schemas/src",
    ]
    paths_lower = ["apps/web", "packages/ui/src", "packages/schemas/src"]

    upper_hits = run_rg(uppercase_pattern, paths_upper, repo_root)
    lower_hits = run_rg(lowercase_pattern, paths_lower, repo_root)

    print(f"Repo: {repo_root}")
    print(f"Schema source types: {', '.join(source_types)}")
    print()

    print("[UPPERCASE source literals]")
    print(upper_hits or "(no matches)")
    print()

    print("[lowercase source literals]")
    print(lower_hits or "(no matches)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
