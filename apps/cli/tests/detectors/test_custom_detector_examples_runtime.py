"""Runtime smoke tests for selected CUSTOM detector examples."""

import json
from pathlib import Path
from typing import ClassVar

import pytest

from src.detectors.custom.detector import CustomDetector
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
async def test_ruleset_example_internal_product_codes_detects_regex(custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "internal_product_codes")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    content = "Public docs accidentally mention INT-OPS-12345 and PROJ-AB12CD34."
    findings = await detector.detect(content)

    assert len(findings) >= 2
    finding_types = {finding.finding_type for finding in findings}
    assert "regex:sku_format" in finding_types
    assert "regex:project_code" in finding_types
    assert all(f.custom_detector_key == "internal_product_codes" for f in findings)


@pytest.mark.asyncio
async def test_classifier_example_sarcasm_uses_scores(monkeypatch, custom_examples: list[dict]):
    example = _example_by_key(custom_examples, "sarcasm_detector")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    # Force zero-shot path and deterministic scores without loading transformer models.
    monkeypatch.setattr(detector, "_classify_with_setfit", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        detector,
        "_classify_with_zero_shot",
        lambda *_args, **_kwargs: {"sarcastic": 0.91, "sincere": 0.09},
    )

    findings = await detector.detect("Great, another perfectly smooth deployment rollback...")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.finding_type == "class:sarcastic"
    assert finding.confidence >= 0.9
    assert finding.custom_detector_name == "Sarcasm & Irony Detector"


@pytest.mark.asyncio
async def test_entity_example_vendor_extractor_emits_entity_findings(
    monkeypatch, custom_examples: list[dict]
):
    example = _example_by_key(custom_examples, "vendor_entity_extractor")
    config = CustomDetectorConfig.model_validate(example["config"])
    detector = CustomDetector(config)

    class FakeEntityModel:
        def extract_entities(self, _content: str, _labels: list[str] | dict[str, str], **_kwargs):
            return {
                "entities": {
                    "supplier company": [
                        {
                            "text": "Acme Lieferant GmbH",
                            "start": 21,
                            "end": 40,
                            "confidence": 0.82,
                        }
                    ]
                }
            }

    monkeypatch.setattr(detector, "_load_entity_model", lambda _cfg: FakeEntityModel())

    findings = await detector.detect("Contract signed with Acme Lieferant GmbH for annual support.")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.finding_type == "entity:supplier company"
    assert finding.matched_content == "Acme Lieferant GmbH"
    assert finding.confidence >= 0.8


def test_classifier_hypothesis_template_missing_placeholder_is_normalized():
    config = CustomDetectorConfig.model_validate(
        {
            "custom_detector_key": "tmpl_missing_placeholder",
            "name": "Template Missing Placeholder",
            "method": "CLASSIFIER",
            "classifier": {
                "labels": [
                    {"id": "a", "name": "Label A"},
                    {"id": "b", "name": "Label B"},
                ],
                "hypothesis_template": "This text is promotional content.",
            },
        }
    )
    detector = CustomDetector(config)

    class FakePipeline:
        def __init__(self):
            self.last_template = None

        def __call__(self, _text, candidate_labels, hypothesis_template, multi_label):
            self.last_template = hypothesis_template
            assert multi_label is True
            return {"labels": candidate_labels, "scores": [0.8, 0.1]}

    pipeline = FakePipeline()
    detector._zero_shot_pipeline = pipeline
    scores = detector._classify_with_zero_shot(["example"], config.classifier)

    assert pipeline.last_template == "This text is promotional content {}."
    assert scores.get("a", 0.0) > 0.7


def test_classifier_hypothesis_template_label_token_is_normalized():
    config = CustomDetectorConfig.model_validate(
        {
            "custom_detector_key": "tmpl_label_placeholder",
            "name": "Template Label Placeholder",
            "method": "CLASSIFIER",
            "classifier": {
                "labels": [
                    {"id": "a", "name": "Label A"},
                    {"id": "b", "name": "Label B"},
                ],
                "hypothesis_template": "This text contains {label}.",
            },
        }
    )
    detector = CustomDetector(config)

    class FakePipeline:
        def __init__(self):
            self.last_template = None

        def __call__(self, _text, candidate_labels, hypothesis_template, multi_label):
            self.last_template = hypothesis_template
            assert multi_label is True
            return {"labels": candidate_labels, "scores": [0.71, 0.2]}

    pipeline = FakePipeline()
    detector._zero_shot_pipeline = pipeline
    scores = detector._classify_with_zero_shot(["example"], config.classifier)

    assert pipeline.last_template == "This text contains {}."
    assert scores.get("a", 0.0) > 0.7


def test_setfit_probability_columns_follow_model_class_ids():
    config = CustomDetectorConfig.model_validate(
        {
            "custom_detector_key": "setfit_sparse_classes",
            "name": "SetFit Sparse Classes",
            "method": "CLASSIFIER",
            "classifier": {
                "labels": [
                    {"id": "label_0", "name": "Label 0"},
                    {"id": "label_1", "name": "Label 1"},
                    {"id": "label_2", "name": "Label 2"},
                ]
            },
        }
    )
    detector = CustomDetector(config)

    class FakeSetFitModel:
        class model_head:  # noqa: N801 - mirrors sklearn attribute name
            classes_: ClassVar[list[int]] = [0, 2]

        @staticmethod
        def predict_proba(_items):
            return [[0.2, 0.9]]

    detector._setfit_model = FakeSetFitModel()

    scores = detector._classify_with_setfit(["sample"], config.classifier)

    assert scores == {"label_0": 0.2, "label_2": 0.9}


def test_setfit_probability_columns_accept_index_like_class_ids():
    config = CustomDetectorConfig.model_validate(
        {
            "custom_detector_key": "setfit_index_like_classes",
            "name": "SetFit Index-like Classes",
            "method": "CLASSIFIER",
            "classifier": {
                "labels": [
                    {"id": "label_0", "name": "Label 0"},
                    {"id": "label_1", "name": "Label 1"},
                    {"id": "label_2", "name": "Label 2"},
                ]
            },
        }
    )
    detector = CustomDetector(config)

    class IndexLikeInt:
        def __init__(self, value: int):
            self.value = value

        def __index__(self) -> int:
            return self.value

    class FakeSetFitModel:
        class model_head:  # noqa: N801 - mirrors sklearn attribute name
            classes_: ClassVar[list[IndexLikeInt]] = [IndexLikeInt(0), IndexLikeInt(2)]

        @staticmethod
        def predict_proba(_items):
            return [[0.3, 0.8]]

    detector._setfit_model = FakeSetFitModel()

    scores = detector._classify_with_setfit(["sample"], config.classifier)

    assert scores == {"label_0": 0.3, "label_2": 0.8}
