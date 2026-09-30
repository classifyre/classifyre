"""Every shipped code-detector template passes its own test scenarios.

The templates are what an author starts from, and each ships with scenarios
(PRD G1 section 7.6). Running them here keeps a template from drifting away
from the SDK it teaches.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from src.file_evaluation import FileEvaluationRunner
from src.models.generated_detectors import CustomDetectorConfig

EXAMPLES = (
    Path(__file__).resolve().parents[3] / "packages/schemas/src/schemas/all_detectors_examples.json"
)


def _templates() -> list[dict[str, Any]]:
    data = json.loads(EXAMPLES.read_text())
    return [
        entry
        for entry in data["CUSTOM"]
        if entry["config"]["pipeline_schema"].get("type") == "CUSTOM_DETECTOR"
    ]


def _matches(expected: dict[str, Any], findings: list[Any]) -> bool:
    if "shouldMatch" in expected:
        return bool(findings) == bool(expected["shouldMatch"])
    wanted = expected["findings"]
    for spec in wanted:
        hits = [
            f
            for f in findings
            if f.finding_type == spec["label"]
            and ("identity" not in spec or f.identity_key == spec["identity"])
            and ("value" not in spec or f.matched_content == spec["value"])
            and ("severity" not in spec or str(f.severity) == spec["severity"])
        ]
        if len(hits) != spec.get("count", len(hits) or 1):
            return False
    if expected.get("match") == "exact":
        labels = {spec["label"] for spec in wanted}
        return all(f.finding_type in labels for f in findings)
    return True


def test_the_starter_comes_first_then_the_five_prd_templates() -> None:
    keys = [t["config"]["custom_detector_key"] for t in _templates()]
    assert keys == [
        "starter_code_detector",
        "row_integrity",
        "list_screening",
        "iban_special_category",
        "metadata_threshold",
        "byo_model",
    ]


@pytest.mark.parametrize("template", _templates(), ids=lambda t: t["config"]["custom_detector_key"])
def test_template_passes_its_scenarios(template: dict[str, Any], tmp_path: Path) -> None:
    config = CustomDetectorConfig.model_validate(template["config"])
    assert config.pipeline_schema is not None
    runner = FileEvaluationRunner(
        [{"type": "CUSTOM", "enabled": True, "config": template["config"]}]
    )
    assert template["test_scenarios"], "every template ships with scenarios"
    for index, scenario in enumerate(template["test_scenarios"]):
        if "inputAsset" in scenario:
            path = tmp_path / f"s{index}.classifyre-asset.json"
            path.write_text(json.dumps(scenario["inputAsset"]))
        else:
            path = tmp_path / f"s{index}.txt"
            path.write_text(scenario["inputText"])
        _parsed, findings = runner.run(path)
        assert runner.detector_errors == [], runner.detector_errors
        assert _matches(scenario["expectedOutcome"], findings), (
            scenario["name"],
            [(f.finding_type, f.identity_key, f.matched_content) for f in findings],
        )
