"""Structural tests for optional dependency groups across sources.

These tests are purely static (AST + file parsing) and run in milliseconds
with no network or package imports.

Invariants enforced:
  1. Every `require_module(uv_groups=[X])` call in src/sources/ references a
     group declared in pyproject.toml [dependency-groups].
  2. Every such group has at least one package entry (not empty).
  3. Every concrete source class (has `source_type = "..."`) that calls
     `require_module` must list its groups in SOURCE_TYPE_GROUPS so the parent
     CLI process can pre-warm them before the worker pool starts.
  4. The fat Dockerfile stage (cli-fat-builder) must bake in every group that
     appears in SOURCE_TYPE_GROUPS, plus the file-processing group needed by
     object-storage sources.
  5. SOURCE_TYPE_GROUPS must not contain stale entries — every type listed there
     must correspond to a source file that actually calls require_module.

When a new source is added and any of these are missed, the relevant test here
will fail and tell you exactly what to fix.
"""

from __future__ import annotations

import ast
import re
import tomllib
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = CLI_ROOT / "src" / "sources"
PYPROJECT_PATH = CLI_ROOT / "pyproject.toml"
DOCKERFILE_PATH = CLI_ROOT.parents[1] / "Dockerfile"

# Abstract source directories that provide base classes shared by multiple
# concrete sources.  They never appear as a recipe `type` value themselves, so
# they must NOT be registered in SOURCE_TYPE_GROUPS.
_ABSTRACT_SOURCE_DIRS: frozenset[str] = frozenset({"object_storage", "blob_storage"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pyproject_dependency_groups() -> dict[str, list[str]]:
    data = tomllib.loads(PYPROJECT_PATH.read_text(encoding="utf-8"))
    groups = data.get("dependency-groups", {})
    if not isinstance(groups, dict):
        return {}
    return {
        str(group): value
        for group, value in groups.items()
        if isinstance(group, str) and isinstance(value, list)
    }


def _ast_require_module_groups(path: Path) -> set[str]:
    """Return every uv_groups string found in require_module(...) calls in *path*.

    Handles both the keyword form  require_module(..., uv_groups=["x"])
    and the positional form         require_module("mod", "name", ["x"])
    where uv_groups is the 3rd parameter (index 2).
    """
    module_ast = ast.parse(path.read_text(encoding="utf-8"))
    groups: set[str] = set()
    for node in ast.walk(module_ast):
        if not isinstance(node, ast.Call):
            continue
        func_name = node.func.id if isinstance(node.func, ast.Name) else None
        if func_name != "require_module":
            continue

        # Keyword form: uv_groups=[...]
        kw = next((k for k in node.keywords if k.arg == "uv_groups"), None)
        groups_node: ast.expr | None = kw.value if kw is not None else None

        # Positional form: 3rd argument (index 2)
        if groups_node is None and len(node.args) >= 3:
            groups_node = node.args[2]

        if groups_node is None or not isinstance(groups_node, ast.List):
            continue
        for item in groups_node.elts:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                groups.add(item.value)
    return groups


def _require_module_uv_groups() -> dict[str, set[str]]:
    """Groups used in every source file, keyed by absolute file path string."""
    result: dict[str, set[str]] = {}
    for path in SOURCES_DIR.rglob("*.py"):
        groups = _ast_require_module_groups(path)
        if groups:
            result[str(path)] = groups
    return result



def _ast_source_type(path: Path) -> str | None:
    """Return the `source_type = "..."` value from the first class that declares it."""
    module_ast = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(module_ast):
        if not isinstance(node, ast.ClassDef):
            continue
        for item in node.body:
            if (
                isinstance(item, ast.Assign)
                and len(item.targets) == 1
                and isinstance(item.targets[0], ast.Name)
                and item.targets[0].id == "source_type"
                and isinstance(item.value, ast.Constant)
                and isinstance(item.value.value, str)
            ):
                return item.value.value
    return None


def _fat_dockerfile_groups() -> set[str]:
    """Parse --group flags from the cli-fat-builder RUN block in the Dockerfile."""
    text = DOCKERFILE_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"AS cli-fat-builder\b(.*?)(?=^FROM |\Z)",
        text,
        re.DOTALL | re.MULTILINE,
    )
    if not match:
        return set()
    block = match.group(1)
    return set(re.findall(r"--group\s+(\S+)", block))


# ---------------------------------------------------------------------------
# Original invariants (pyproject integrity)
# ---------------------------------------------------------------------------


def test_optional_source_uv_groups_exist_in_pyproject_dependency_groups() -> None:
    """Every group referenced via require_module must be declared in pyproject.toml."""
    declared_groups = set(_pyproject_dependency_groups().keys())
    used_groups_by_file = _require_module_uv_groups()

    missing: dict[str, list[str]] = {}
    for file_path, groups in used_groups_by_file.items():
        missing_groups = sorted(group for group in groups if group not in declared_groups)
        if missing_groups:
            missing[file_path] = missing_groups

    assert not missing, (
        "Missing dependency group definitions for source optional dependencies: "
        f"{missing}. Add these under [dependency-groups] in pyproject.toml."
    )


def test_optional_source_uv_groups_are_not_empty() -> None:
    """Every group referenced via require_module must list at least one package."""
    dependency_groups = _pyproject_dependency_groups()
    used_groups = {group for groups in _require_module_uv_groups().values() for group in groups}

    empty_groups = sorted(group for group in used_groups if not dependency_groups.get(group))

    assert not empty_groups, (
        f"Source dependency groups must include at least one package: {empty_groups}"
    )


# ---------------------------------------------------------------------------
# SOURCE_TYPE_GROUPS ↔ require_module consistency
# ---------------------------------------------------------------------------


def test_sources_with_require_module_covered_in_source_type_groups() -> None:
    """Concrete sources that call require_module must have those groups in SOURCE_TYPE_GROUPS.

    This means the parent CLI process will pre-warm the right venv groups before
    spawning the worker pool.  Any gap here causes a first-scan installation race.
    """
    from src.utils.dependency_groups import SOURCE_TYPE_GROUPS

    uncovered: dict[str, list[str]] = {}
    for path in sorted(SOURCES_DIR.glob("*/source.py")):
        if path.parent.name in _ABSTRACT_SOURCE_DIRS:
            continue
        source_type = _ast_source_type(path)
        if source_type is None:
            continue
        groups = _ast_require_module_groups(path)
        if not groups:
            continue
        registered = SOURCE_TYPE_GROUPS.get(source_type.upper(), set())
        missing = sorted(groups - registered)
        if missing:
            uncovered[source_type] = missing

    assert not uncovered, (
        "Sources call require_module with groups absent from SOURCE_TYPE_GROUPS: "
        f"{uncovered}. Add them to src/utils/dependency_groups.py SOURCE_TYPE_GROUPS."
    )


def test_new_source_with_require_module_must_be_in_source_type_groups() -> None:
    """Any concrete source that uses require_module must appear in SOURCE_TYPE_GROUPS.

    This is the enforcement gate: adding a new source/*/source.py that calls
    require_module but omits the SOURCE_TYPE_GROUPS entry will fail here.
    """
    from src.utils.dependency_groups import SOURCE_TYPE_GROUPS

    unregistered: list[str] = []
    for path in sorted(SOURCES_DIR.glob("*/source.py")):
        if path.parent.name in _ABSTRACT_SOURCE_DIRS:
            continue
        source_type = _ast_source_type(path)
        if source_type is None:
            continue
        if not _ast_require_module_groups(path):
            continue  # base-image source, no optional deps needed
        if source_type.upper() not in SOURCE_TYPE_GROUPS:
            unregistered.append(source_type)

    assert not unregistered, (
        f"Sources use optional dependencies but are not in SOURCE_TYPE_GROUPS: {unregistered}. "
        "Add an entry to src/utils/dependency_groups.py SOURCE_TYPE_GROUPS."
    )


def test_source_type_groups_has_no_stale_entries() -> None:
    """Every SOURCE_TYPE_GROUPS entry must correspond to a source that actually uses require_module.

    Catches entries left behind when a source is removed or refactored to use
    only base-image deps.
    """
    from src.utils.dependency_groups import SOURCE_TYPE_GROUPS

    active: dict[str, set[str]] = {}
    for path in sorted(SOURCES_DIR.glob("*/source.py")):
        if path.parent.name in _ABSTRACT_SOURCE_DIRS:
            continue
        source_type = _ast_source_type(path)
        if source_type is None:
            continue
        groups = _ast_require_module_groups(path)
        if groups:
            active[source_type.upper()] = groups

    stale: list[str] = []
    for registered_type in SOURCE_TYPE_GROUPS:
        if registered_type not in active:
            stale.append(registered_type)

    assert not stale, (
        f"SOURCE_TYPE_GROUPS has entries for source types with no require_module calls: {stale}. "
        "Remove them from src/utils/dependency_groups.py SOURCE_TYPE_GROUPS."
    )


def test_source_type_groups_values_match_actual_groups_used() -> None:
    """Groups listed in SOURCE_TYPE_GROUPS must match those require_module actually requests."""
    from src.utils.dependency_groups import SOURCE_TYPE_GROUPS

    mismatches: dict[str, dict[str, list[str]]] = {}
    for path in sorted(SOURCES_DIR.glob("*/source.py")):
        if path.parent.name in _ABSTRACT_SOURCE_DIRS:
            continue
        source_type = _ast_source_type(path)
        if source_type is None:
            continue
        actual = _ast_require_module_groups(path)
        if not actual:
            continue
        declared = SOURCE_TYPE_GROUPS.get(source_type.upper(), set())
        extra = sorted(declared - actual)
        missing = sorted(actual - declared)
        if extra or missing:
            mismatches[source_type] = {"extra_in_map": extra, "missing_from_map": missing}

    assert not mismatches, (
        "SOURCE_TYPE_GROUPS entries don't match the groups actually used by require_module: "
        f"{mismatches}. Keep dependency_groups.py in sync with the source files."
    )


# ---------------------------------------------------------------------------
# Fat Dockerfile coverage
# ---------------------------------------------------------------------------


def test_fat_dockerfile_stage_exists() -> None:
    """Dockerfile must define a cli-fat-builder stage for production images."""
    text = DOCKERFILE_PATH.read_text(encoding="utf-8")
    assert "AS cli-fat-builder" in text, (
        f"{DOCKERFILE_PATH} is missing the cli-fat-builder stage. "
        "Add a stage that bakes all optional dependency groups."
    )


def test_fat_dockerfile_includes_all_source_type_groups() -> None:
    """Fat CLI image must include every group listed in SOURCE_TYPE_GROUPS.

    When a new group is added to SOURCE_TYPE_GROUPS but its --group flag is
    omitted from the Dockerfile fat builder, the production image silently
    breaks for that source type.
    """
    from src.utils.dependency_groups import SOURCE_TYPE_GROUPS

    fat_groups = _fat_dockerfile_groups()
    all_source_groups = {g for gs in SOURCE_TYPE_GROUPS.values() for g in gs}

    missing = sorted(g for g in all_source_groups if g not in fat_groups)
    assert not missing, (
        f"Dockerfile cli-fat-builder stage is missing --group flags: {missing}. "
        "Add them to the RUN uv sync block in the cli-fat-builder stage."
    )


def test_fat_dockerfile_includes_file_processing_group() -> None:
    """Fat image must provide file-processing deps for object storage sources.

    ObjectStorageSourceBase calls require_module(..., uv_groups=['file-processing'])
    at runtime.  The fat builder covers this either with --group file-processing
    directly or transitively via --group detectors (which includes file-processing).
    """
    fat_groups = _fat_dockerfile_groups()
    covered = "file-processing" in fat_groups or "detectors" in fat_groups
    assert covered, (
        "Dockerfile cli-fat-builder must include --group file-processing "
        "(directly or via --group detectors) for object storage text extraction."
    )
