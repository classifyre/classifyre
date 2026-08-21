"""Install the dependency groups a notebook's imports need, before it runs.

The editor advertises everything in ``notebook_runtime_packages.json`` -- boto3,
duckdb, pdfplumber, psycopg2 -- but most of it lives in an optional uv group that
is only installed when something asks for it. Detectors ask through
``require_module``; a notebook has no such chokepoint, it just writes
``import duckdb``. Without this module that import fails and the advertised list
is a lie.

So the notebook's own source is the request: whatever it imports names the groups
to install. Read from the cells rather than from a config field because an author
should not have to declare twice what the ``import`` line already says.

Best effort throughout. A group that will not install surfaces later as an
ordinary ``ModuleNotFoundError`` on the import line, which is a better error than
anything this module could raise about it.
"""

from __future__ import annotations

import ast
import logging
from functools import cache
from typing import Any

from ..utils.validation import _load_schema
from .serialize import to_module_source

logger = logging.getLogger(__name__)


@cache
def _module_groups() -> tuple[tuple[str, str], ...]:
    """``(module, group)`` for every on-demand package, longest module first.

    Sorted so that ``azure.storage.blob`` is considered before ``azure``: the
    more specific declaration wins when both could match.
    """
    manifest = _load_schema("notebook_runtime_packages.json")
    pairs: list[tuple[str, str]] = []
    for package in manifest.get("packages", []):
        group = package.get("group")
        if not group:
            continue
        for module in package.get("modules") or []:
            pairs.append((str(module), str(group)))
    return tuple(sorted(set(pairs), key=lambda pair: (-len(pair[0]), pair[0])))


def modules_imported(cells: Any) -> set[str]:
    """Dotted names the notebook imports, top-level or not.

    Parsed rather than pattern-matched so a string containing "import boto3" is
    not mistaken for one. A notebook that does not parse yields nothing: the
    contract check reports that failure properly a moment later.
    """
    try:
        tree = ast.parse(to_module_source(cells).text)
    except SyntaxError:
        return set()

    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
    return names


def groups_for(cells: Any) -> list[str]:
    """The uv groups those imports need."""
    imported = modules_imported(cells)
    if not imported:
        return []

    groups: list[str] = []
    for module, group in _module_groups():
        if group in groups:
            continue
        # `import azure` should install everything under that namespace, and
        # `import azure.identity` only what provides it -- so a match either way
        # round counts.
        if any(
            name == module or name.startswith(f"{module}.") or module.startswith(f"{name}.")
            for name in imported
        ):
            groups.append(group)
    return groups


def warm_declared_groups(cells: Any) -> None:
    """Install what the notebook's imports need, once, before any cell runs.

    Must be called *before* the notebook's own declared packages are installed:
    ``uv sync`` runs with ``--frozen`` and prunes anything ``uv pip install`` put
    in the venv, so warming afterwards would silently uninstall them.
    """
    groups = groups_for(cells)
    if not groups:
        return
    try:
        from ..utils.uv_sync import warm_groups
    except ImportError:  # pragma: no cover - uv_sync has no optional deps
        return

    logger.info("Notebook imports need dependency group(s): %s", ", ".join(groups))
    try:
        ok, detail = warm_groups(groups)
    except Exception as exc:  # a failed install must not fail the run here
        logger.warning("Could not install dependency groups %s: %s", ", ".join(groups), exc)
        return
    if not ok and detail:
        logger.warning(
            "Some dependency groups were not installed (%s); an import of them will fail: %s",
            ", ".join(groups),
            detail,
        )
