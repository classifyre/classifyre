from __future__ import annotations

import ast
import tomllib
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = CLI_ROOT / "src" / "sources"
PYPROJECT_PATH = CLI_ROOT / "pyproject.toml"


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


def _require_module_uv_groups() -> dict[str, set[str]]:
    groups_by_file: dict[str, set[str]] = {}
    for path in SOURCES_DIR.rglob("*.py"):
        module_ast = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(module_ast):
            if not isinstance(node, ast.Call):
                continue

            func_name = node.func.id if isinstance(node.func, ast.Name) else None
            if func_name != "require_module":
                continue

            uv_groups_keyword = next(
                (kw for kw in node.keywords if kw.arg == "uv_groups"),
                None,
            )
            if uv_groups_keyword is None or not isinstance(uv_groups_keyword.value, ast.List):
                continue

            for item in uv_groups_keyword.value.elts:
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    groups_by_file.setdefault(str(path), set()).add(item.value)

    return groups_by_file


def test_optional_source_uv_groups_exist_in_pyproject_dependency_groups() -> None:
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
    dependency_groups = _pyproject_dependency_groups()
    used_groups = {group for groups in _require_module_uv_groups().values() for group in groups}

    empty_groups = sorted(group for group in used_groups if not dependency_groups.get(group))

    assert not empty_groups, (
        f"Source dependency groups must include at least one package: {empty_groups}"
    )
