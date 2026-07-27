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
    missing = sorted(referenced - declared)
    assert not missing, f"Groups not declared in pyproject [dependency-groups]: {missing}"


def test_automatic_media_groups_exist_in_pyproject() -> None:
    assert {"ocr", "transcription", "video"}.issubset(_declared_groups())


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


def test_recipe_groups_skips_disabled_detectors() -> None:
    recipe = {
        "type": "POSTGRESQL",
        "detectors": [
            {"type": "PII", "enabled": False},
            {"type": "SECRETS", "enabled": True},
        ],
        "sampling": {"strategy": "ALL"},
    }
    assert recipe_uv_groups(recipe) == {"postgresql", "security"}


def test_recipe_groups_source_without_driver_is_empty() -> None:
    """WORDPRESS talks plain HTTP over the default dependencies."""
    recipe = {"type": "WORDPRESS", "sampling": {"strategy": "LATEST"}}
    assert recipe_uv_groups(recipe) == set()


def test_slack_recipe_requires_the_slack_sdk_group() -> None:
    recipe = {"type": "SLACK", "sampling": {"strategy": "LATEST"}}
    assert recipe_uv_groups(recipe) == {"slack"}


def test_kafka_rest_recipe_skips_the_librdkafka_group() -> None:
    """REST Proxy Kafka is plain HTTP — no confluent-kafka install needed."""
    broker = {"type": "KAFKA", "required": {"auth_mode": "SASL", "host": "b", "port": 9093}}
    rest = {"type": "KAFKA", "required": {"auth_mode": "REST", "host": "b", "port": 8082}}
    assert "kafka" in recipe_uv_groups(broker)
    assert "kafka" not in recipe_uv_groups(rest)
