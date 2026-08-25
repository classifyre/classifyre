"""Generate the list of packages a notebook can import without declaring them.

The CLI image already carries a lot: requests and lxml are always there, and
pdfplumber, duckdb, boto3, psycopg2 and the rest arrive the first time something
imports them. None of that was visible to a connector author, so people
re-declared packages that were already installed -- at a different version than
the lock had resolved.

So the list is derived rather than written: names and pins come from
``pyproject.toml``, resolved versions come from ``uv.lock``. Add a dependency and
the notebook editor offers it; bump it and the editor shows the new version.

Two judgements are encoded here and nowhere else:

* ``INCLUDED_GROUPS`` -- which optional groups are worth advertising. Connector
  and file-format groups are; the ML detector groups are not, because putting a
  multi-gigabyte ``uv sync`` behind a one-line ``import`` is a trap rather than a
  feature.
* ``MODULE_ALIASES`` -- the import name, where it differs from the distribution
  name. This is what makes ``import bs4`` resolve back to ``beautifulsoup4`` for
  the group-warming path in ``src/notebook/groups.py``.

Run from apps/cli:

    uv run python scripts/generate_runtime_packages.py

``tests/test_runtime_packages.py`` fails when the checked-in file drifts from
what this would produce, so the two cannot silently diverge.
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any

CLI_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT_PATH = CLI_ROOT / "pyproject.toml"
LOCK_PATH = CLI_ROOT / "uv.lock"
OUTPUT_PATH = (
    CLI_ROOT.parents[1]
    / "packages"
    / "schemas"
    / "src"
    / "schemas"
    / "notebook_runtime_packages.json"
)

#: Optional dependency groups worth telling a connector author about: database
#: drivers, object stores, SaaS clients and the file-format stack. Each is
#: installed on demand, so listing one is a promise that importing it works --
#: `src/notebook/groups.py` is what keeps that promise.
INCLUDED_GROUPS = (
    "file-processing",
    "regex",
    "llm",
    "postgresql",
    "mysql",
    "mssql",
    "oracle",
    "hive",
    "databricks",
    "snowflake",
    "mongodb",
    "neo4j",
    "tableau",
    "s3-compatible-storage",
    "azure-blob-storage",
    "microsoft-graph",
    "google-workspace",
    "google-cloud-storage",
    "dropbox",
    "hugging-face",
    "slack",
    "email",
    "youtube",
    "reddit",
    "kafka",
    "delta-lake",
    "iceberg",
    # sqlglot: pure Python and small, and the thing a connector author reaches
    # for when they want to derive column lineage from a query they already have.
    "lineage",
)

#: Everything else in `[dependency-groups]`, listed rather than inferred so that
#: adding a group is a deliberate decision in one place. The ML groups pull
#: torch, transformers or docling -- gigabytes that an author would trigger by
#: typing one import. `dev`, `interactive` and `otel` are tooling, not a
#: connector's vocabulary; `detectors` and `ocr` are aggregates of the rest.
EXCLUDED_GROUPS = (
    "dev",
    "interactive",
    "detectors",
    "ocr",
    "otel",
    "privacy",
    "security",
    "threat-ml",
    "content",
    "quality",
    "classification",
    "custom",
    "transcription",
    "video",
)

#: Import name, where it is not just the distribution name with '-' as '_'.
MODULE_ALIASES: dict[str, tuple[str, ...]] = {
    "beautifulsoup4": ("bs4",),
    "pillow": ("PIL",),
    "python-docx": ("docx",),
    "opencv-python-headless": ("cv2",),
    "psycopg2-binary": ("psycopg2",),
    "google-re2": ("re2",),
    "databricks-sql-connector": ("databricks.sql",),
    "snowflake-connector-python": ("snowflake.connector",),
    # Namespace packages: the dotted path is the whole import name, so that
    # `import azure` matches both of these and `import azure.identity` matches
    # only the one that provides it.
    "azure-storage-blob": ("azure.storage.blob",),
    "azure-identity": ("azure.identity",),
    "google-api-python-client": ("googleapiclient",),
    "google-auth": ("google.auth",),
    "google-cloud-storage": ("google.cloud.storage",),
    "msgraph-sdk": ("msgraph",),
    "en-core-web-sm": ("en_core_web_sm",),
    "classifyre-schemas": ("schemas",),
}

#: Distributions that exist in the lock but are not something a notebook imports
#: directly: they are transports or model data pulled in by something else.
SKIPPED_DISTRIBUTIONS = frozenset({"classifyre-schemas", "en-core-web-sm"})

#: A requirement string is only ever read for its name here -- the version comes
#: from the lock, which is what actually gets installed.
_NAME_OF_REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _canonical(name: str) -> str:
    """PEP 503 normalization, so pyproject and uv.lock spellings line up."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(requirement: Any) -> str | None:
    """The distribution named by one `[dependency-groups]` entry.

    Entries are usually strings; an `{include-group = ...}` table pulls in
    another group, which the caller already resolves by listing groups
    explicitly, so it is skipped rather than expanded.
    """
    if not isinstance(requirement, str):
        return None
    match = _NAME_OF_REQUIREMENT.match(requirement)
    return _canonical(match.group(1)) if match else None


def _locked_versions() -> dict[str, str]:
    """Resolved version per distribution, from uv.lock.

    A name can appear twice when an index pin produces a local build (`+cpu`);
    the plain version is the one to show, since it is what the wheel reports.
    """
    lock = tomllib.loads(LOCK_PATH.read_text(encoding="utf-8"))
    versions: dict[str, list[str]] = {}
    for package in lock.get("package", []):
        name = _canonical(str(package.get("name", "")))
        version = str(package.get("version", ""))
        if name and version:
            versions.setdefault(name, []).append(version)

    resolved: dict[str, str] = {}
    for name, candidates in versions.items():
        plain = [version for version in candidates if "+" not in version]
        resolved[name] = sorted(plain or candidates)[-1]
    return resolved


def _modules(name: str) -> list[str]:
    return list(MODULE_ALIASES.get(name, (name.replace("-", "_"),)))


def build() -> dict[str, Any]:
    pyproject = tomllib.loads(PYPROJECT_PATH.read_text(encoding="utf-8"))
    versions = _locked_versions()

    groups = pyproject.get("dependency-groups", {})
    unknown = sorted(set(groups) - set(INCLUDED_GROUPS) - set(EXCLUDED_GROUPS))
    if unknown:
        raise SystemExit(
            f"pyproject.toml has dependency groups this script has no verdict on: {unknown}. "
            "Add each to INCLUDED_GROUPS or EXCLUDED_GROUPS in "
            "scripts/generate_runtime_packages.py."
        )

    # A distribution can appear in several groups (pillow, pyarrow, boto3). The
    # first one wins, and `always` wins over any group, so the availability an
    # author is shown is the strongest one that holds.
    entries: dict[str, dict[str, Any]] = {}

    for requirement in pyproject.get("project", {}).get("dependencies", []):
        name = _requirement_name(requirement)
        if not name or name in SKIPPED_DISTRIBUTIONS:
            continue
        entries[name] = {
            "name": name,
            "version": versions.get(name, ""),
            "modules": _modules(name),
            "availability": "always",
        }

    for group in INCLUDED_GROUPS:
        for requirement in groups.get(group, []):
            name = _requirement_name(requirement)
            if not name or name in SKIPPED_DISTRIBUTIONS or name in entries:
                continue
            entries[name] = {
                "name": name,
                "version": versions.get(name, ""),
                "modules": _modules(name),
                "availability": "on-demand",
                "group": group,
            }

    return {
        "$comment": (
            "Generated by apps/cli/scripts/generate_runtime_packages.py from "
            "apps/cli/pyproject.toml and apps/cli/uv.lock. Do not edit by hand."
        ),
        "pythonVersion": str(pyproject.get("project", {}).get("requires-python", "")),
        "packages": [entries[name] for name in sorted(entries)],
    }


def main() -> int:
    payload = build()
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT_PATH.relative_to(CLI_ROOT.parents[1])} ({len(payload['packages'])} packages)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
