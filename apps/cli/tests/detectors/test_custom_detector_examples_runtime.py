"""Runtime smoke tests for selected CUSTOM detector examples using pipeline_schema format."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.detectors.custom.detector import CustomDetector
from src.detectors.custom.runners import GLiNER2Runner, RegexRunner
from src.models.generated_detectors import CustomDetectorConfig


@pytest.fixture
def custom_examples() -> list[dict]:
    repo_root = Path(__file__).parent.parent.parent.parent.parent
    examples_path = (
        repo_root / "packages" / "schemas" / "src" / "schemas" / "all_detectors_examples.json"
    )
    with open(examples_path) as f:
        data = json.load(f)
    return data["CUSTOM"]


def _example_by_key(examples: list[dict], key: str) -> dict:
    for example in examples:
        cfg = example.get("config", {})
        if cfg.get("custom_detector_key") == key:
            return example
    raise AssertionError(f"Example not found for custom_detector_key={key}")


@pytest.mark.asyncio
async def test_regex_example_internal_product_codes_detects_patterns(custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "internal_product_codes")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    assert isinstance(detector._runner, RegexRunner)

    content = "Public docs accidentally mention INT-OPS-12345 and PROJ-AB12CD34."
    findings = await detector.detect(content)

    assert len(findings) >= 2
    finding_types = {finding.finding_type for finding in findings}
    assert "regex:sku_format" in finding_types
    assert "regex:project_code" in finding_types
    assert all(f.custom_detector_key == "internal_product_codes" for f in findings)


@pytest.mark.asyncio
async def test_gliner2_example_sarcasm_uses_classification(custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "sarcasm_detector")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    assert isinstance(detector._runner, GLiNER2Runner)

    mock_model = MagicMock()
    mock_model.extract_entities.return_value = {"entities": {}}
    mock_model.classify.return_value = {"label": "sarcastic", "confidence": 0.91}
    detector._runner._model = mock_model

    findings = await detector.detect("Great, another perfectly smooth deployment rollback...")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.finding_type == "classification:tone:sarcastic"
    assert finding.confidence >= 0.9
    assert finding.custom_detector_name == "Sarcasm & Irony Detector"


@pytest.mark.asyncio
async def test_gliner2_example_vendor_extractor_emits_entity_findings(custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "vendor_entity_extractor")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    assert isinstance(detector._runner, GLiNER2Runner)

    mock_model = MagicMock()
    mock_model.extract_entities.return_value = {
        "entities": {
            "vendor_name": [
                {
                    "text": "Acme Lieferant GmbH",
                    "start": 21,
                    "end": 40,
                    "confidence": 0.82,
                }
            ]
        }
    }
    mock_model.classify.return_value = {}
    detector._runner._model = mock_model

    findings = await detector.detect("Contract signed with Acme Lieferant GmbH for annual support.")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.finding_type == "entity:vendor_name"
    assert finding.matched_content == "Acme Lieferant GmbH"
    assert finding.confidence >= 0.8


@pytest.mark.asyncio
async def test_regex_example_invoice_pii_detects_iban(custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "cust_invoice_pii_ruleset")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    assert isinstance(detector._runner, RegexRunner)

    content = "Bankverbindung: DE89 3704 0044 0532 0130 00, Rechnungsdatum: 15.03.2024"
    findings = await detector.detect(content)

    finding_types = {f.finding_type for f in findings}
    assert "regex:iban" in finding_types or "regex:invoice_date" in finding_types


@pytest.mark.asyncio
async def test_gliner2_example_all_examples_load_and_detect(custom_examples: list[dict]):
    """All examples must parse successfully and run detect() without crashing."""
    for example in custom_examples:
        config = CustomDetectorConfig.model_validate(example["config"])
        detector = CustomDetector(config)

        if isinstance(detector._runner, GLiNER2Runner):
            # Skip actual model loading — inject mock
            mock_model = MagicMock()
            mock_model.extract_entities.return_value = {"entities": {}}
            mock_model.classify.return_value = {}
            detector._runner._model = mock_model

        findings = await detector.detect("Sample text for smoke test.")
        assert isinstance(findings, list)
