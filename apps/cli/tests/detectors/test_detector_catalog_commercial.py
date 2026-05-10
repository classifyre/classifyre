"""Tests for commercially-safe detector catalog recommendations."""

import json
from pathlib import Path


def _load_detector_catalog() -> list[dict]:
    repo_root = Path(__file__).parent.parent.parent.parent.parent
    schema_path = repo_root / "packages" / "schemas" / "src" / "schemas" / "all_detectors.json"
    with schema_path.open() as handle:
        payload = json.load(handle)
    return payload["definitions"]["DetectorCatalog"]["default"]


def test_catalog_excludes_known_non_verified_models() -> None:
    catalog = _load_detector_catalog()
    blocked = {
        "sentinet-electra-self-harm",
        "vit-base-violence-detector",
    }
    recommended = {item.get("recommended_model") for item in catalog}
    assert blocked.isdisjoint(recommended)


def test_catalog_categories_are_uppercase_enum_values() -> None:
    catalog = _load_detector_catalog()
    allowed = {
        "SECURITY",
        "PRIVACY",
        "THREAT",
        "CONTENT",
        "QUALITY",
        "FAIRNESS",
        "COMPLIANCE",
        "CLASSIFICATION",
    }
    for entry in catalog:
        categories = set(entry.get("categories", []))
        assert categories
        assert categories.issubset(allowed)


def test_catalog_phase0_detectors_are_active() -> None:
    catalog = _load_detector_catalog()
    by_type = {entry["detector_type"]: entry for entry in catalog}
    assert by_type["SECRETS"]["lifecycle_status"] == "active"


def test_catalog_phase2_detectors_are_active_with_safe_models() -> None:
    catalog = _load_detector_catalog()
    by_type = {entry["detector_type"]: entry for entry in catalog}

    assert by_type["LANGUAGE"]["lifecycle_status"] == "active"
    assert by_type["LANGUAGE"]["recommended_model"] == "fast-langdetect"

    # Transformer detectors (TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, FEATURE_EXTRACTION,
    # OBJECT_DETECTION) are now custom detectors configured via pipeline_schema, not
    # standalone catalog entries.
    for transformer_type in (
        "TEXT_CLASSIFICATION",
        "IMAGE_CLASSIFICATION",
        "FEATURE_EXTRACTION",
        "OBJECT_DETECTION",
    ):
        assert transformer_type not in by_type, (
            f"{transformer_type} should no longer be a standalone catalog entry"
        )


def test_catalog_phase3_detectors_are_active_with_safe_models() -> None:
    catalog = _load_detector_catalog()
    by_type = {entry["detector_type"]: entry for entry in catalog}

    assert by_type["CODE_SECURITY"]["lifecycle_status"] == "active"
    assert by_type["CODE_SECURITY"]["recommended_model"] == "bandit"
