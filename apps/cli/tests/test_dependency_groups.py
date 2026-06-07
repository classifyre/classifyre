"""Guard the recipe -> uv group resolution used for parent-process warm-up."""

from __future__ import annotations

import tomllib
from pathlib import Path

from src.models.generated_detectors import DetectorType
from src.utils.dependency_groups import (
    DETECTOR_TYPE_GROUPS,
    SOURCE_TYPE_GROUPS,
    recipe_uv_groups,
)

CLI_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT_PATH = CLI_ROOT / "pyproject.toml"


def _declared_groups() -> set[str]:
    data = tomllib.loads(PYPROJECT_PATH.read_text(encoding="utf-8"))
    return set(data.get("dependency-groups", {}).keys())


def test_every_detector_type_is_mapped() -> None:
    for detector_type in DetectorType:
        assert detector_type.value in DETECTOR_TYPE_GROUPS, (
            f"DetectorType.{detector_type.name} is missing from DETECTOR_TYPE_GROUPS"
        )


def test_all_referenced_groups_exist_in_pyproject() -> None:
    declared = _declared_groups()
    referenced: set[str] = set()
    for groups in (*DETECTOR_TYPE_GROUPS.values(), *SOURCE_TYPE_GROUPS.values()):
        referenced |= groups
    referenced.add("ocr")  # added by recipe_uv_groups when enable_ocr is set
    missing = sorted(referenced - declared)
    assert not missing, f"Groups not declared in pyproject [dependency-groups]: {missing}"


def test_recipe_groups_source_plus_detectors() -> None:
    recipe = {
        "type": "EMAIL",
        "detectors": [
            {"type": "PII", "enabled": True},
            {"type": "SECRETS", "enabled": True},
        ],
        "sampling": {"strategy": "LATEST"},
    }
    assert recipe_uv_groups(recipe) == {"email", "privacy", "security"}


def test_recipe_groups_skips_disabled_and_adds_ocr() -> None:
    recipe = {
        "type": "POSTGRESQL",
        "detectors": [
            {"type": "PII", "enabled": False},
            {"type": "SECRETS", "enabled": True},
        ],
        "sampling": {"strategy": "ALL", "enable_ocr": True},
    }
    assert recipe_uv_groups(recipe) == {"postgresql", "security", "ocr"}


def test_recipe_groups_source_without_driver_is_empty() -> None:
    recipe = {"type": "SLACK", "sampling": {"strategy": "LATEST"}}
    assert recipe_uv_groups(recipe) == set()
