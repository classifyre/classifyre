"""Integration tests for the custom detector pipeline.

Covers the full path:
    CustomDetectorConfig → CustomDetector → Runner → PipelineResult → DetectionResult

Tests use the REGEX runner (no ML dependency) for the integration path, and
separately verify GLiNER2 runner behaviour via a monkeypatched model.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.detectors.custom.detector import CustomDetector
from src.detectors.custom.runners import GLiNER2Runner, RegexRunner, create_runner
from src.models.generated_detectors import (
    CustomDetectorConfig,
    GLiNER2PipelineSchema,
    PipelineClassificationDefinition,
    PipelineEntityDefinition,
    PipelineModelConfig,
    PipelineValidationConfig,
    RegexPatternDefinition,
    RegexPipelineSchema,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

FIXTURE_TEXT = """\
Order ORD-7890 placed by Alice Müller (alice@example.com).
Refund request: amount 320€. Priority: urgent.
Project code PROJ-AB12CD34 approved for Q1.
"""


def _make_regex_detector(key: str = "test_regex") -> CustomDetector:
    config = CustomDetectorConfig(
        custom_detector_key=key,
        name="Test Regex Detector",
        pipeline_schema=RegexPipelineSchema(
            patterns={
                "order_id": RegexPatternDefinition(
                    pattern=r"ORD-\d+",
                    description="Order ID",
                ),
                "email": RegexPatternDefinition(
                    pattern=r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
                    description="Email address",
                ),
                "project_code": RegexPatternDefinition(
                    pattern=r"PROJ-[A-Z]{2}\d{2}[A-Z]{2}\d{2}",
                    description="Internal project code",
                ),
            }
        ),
    )
    return CustomDetector(config)


def _make_gliner2_detector(key: str = "test_gliner2") -> CustomDetector:
    """Return a CustomDetector backed by a mocked GLiNER2 model."""
    mock_model = MagicMock()
    mock_model.extract_entities.return_value = {
        "entities": {
            "order_id": [{"text": "ORD-7890", "confidence": 0.93, "start": 6, "end": 14}],
            "amount": [{"text": "320€", "confidence": 0.88, "start": 63, "end": 67}],
        }
    }
    mock_model.classify.return_value = {"label": "refund", "confidence": 0.95}

    config = CustomDetectorConfig(
        custom_detector_key=key,
        name="Test GLiNER2 Detector",
        pipeline_schema=GLiNER2PipelineSchema(
            model=PipelineModelConfig(name="fastino/gliner2-base-v1"),
            entities={
                "order_id": PipelineEntityDefinition(description="Order ID like ORD-123"),
                "amount": PipelineEntityDefinition(description="Monetary value like 320€"),
            },
            classification={
                "intent": PipelineClassificationDefinition(
                    labels=["refund", "question", "complaint"]
                )
            },
        ),
    )
    detector = CustomDetector(config)
    # Inject mock model directly into runner
    assert isinstance(detector._runner, GLiNER2Runner)
    detector._runner._model = mock_model
    return detector


# ── REGEX integration ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_regex_detector_finds_all_patterns():
    detector = _make_regex_detector()
    findings = await detector.detect(FIXTURE_TEXT)

    finding_types = {f.finding_type for f in findings}
    assert "regex:order_id" in finding_types
    assert "regex:email" in finding_types
    assert "regex:project_code" in finding_types


@pytest.mark.asyncio
async def test_regex_detector_finding_metadata():
    detector = _make_regex_detector()
    findings = await detector.detect(FIXTURE_TEXT)

    for f in findings:
        assert f.finding_type.startswith("regex:")
        assert f.metadata["runner"] == "REGEX"
        assert "pipeline_result" in f.metadata


@pytest.mark.asyncio
async def test_regex_detector_location_offsets():
    text = "See order ORD-42 here."
    config = CustomDetectorConfig(
        custom_detector_key="loc_test",
        name="Location Test",
        pipeline_schema=RegexPipelineSchema(
            patterns={"order_id": RegexPatternDefinition(pattern=r"ORD-\d+")}
        ),
    )
    detector = CustomDetector(config)
    findings = await detector.detect(text)

    assert len(findings) == 1
    loc = findings[0].location
    assert loc is not None
    assert text[loc.start : loc.end] == "ORD-42"


@pytest.mark.asyncio
async def test_regex_detector_empty_content_returns_no_findings():
    detector = _make_regex_detector()
    findings = await detector.detect("   ")
    assert findings == []


# ── GLiNER2 integration (mocked model) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_gliner2_detector_entities_and_classification():
    detector = _make_gliner2_detector()
    findings = await detector.detect(FIXTURE_TEXT)

    finding_types = {f.finding_type for f in findings}
    assert "entity:order_id" in finding_types
    assert "entity:amount" in finding_types
    assert "classification:intent:refund" in finding_types


@pytest.mark.asyncio
async def test_gliner2_detector_metadata():
    detector = _make_gliner2_detector()
    findings = await detector.detect(FIXTURE_TEXT)

    for f in findings:
        assert f.metadata["runner"] == "GLINER2"
        assert "pipeline_result" in f.metadata


@pytest.mark.asyncio
async def test_gliner2_confidence_threshold_filters_low_scores():
    mock_model = MagicMock()
    mock_model.extract_entities.return_value = {
        "entities": {
            "order_id": [
                {"text": "ORD-7890", "confidence": 0.95, "start": 6, "end": 14},
                {"text": "ORD-LOW", "confidence": 0.30, "start": 0, "end": 7},
            ]
        }
    }
    mock_model.classify.return_value = {}

    config = CustomDetectorConfig(
        custom_detector_key="threshold_test",
        name="Threshold Test",
        pipeline_schema=GLiNER2PipelineSchema(
            entities={"order_id": PipelineEntityDefinition(description="Order ID")},
            validation=PipelineValidationConfig(confidence_threshold=0.8),
        ),
    )
    detector = CustomDetector(config)
    assert isinstance(detector._runner, GLiNER2Runner)
    detector._runner._model = mock_model

    findings = await detector.detect("ORD-7890 and ORD-LOW text")
    matched = [f for f in findings if f.finding_type == "entity:order_id"]
    # Only ORD-7890 (0.95) should pass the 0.8 threshold
    assert len(matched) == 1
    assert matched[0].matched_content == "ORD-7890"


# ── Runner factory ────────────────────────────────────────────────────────────


def test_factory_returns_regex_runner_for_regex_schema():
    schema = RegexPipelineSchema(patterns={"x": RegexPatternDefinition(pattern=r"\d+")})
    assert isinstance(create_runner(schema), RegexRunner)


def test_factory_returns_gliner2_runner_for_gliner2_schema():
    schema = GLiNER2PipelineSchema(entities={"x": PipelineEntityDefinition(description="anything")})
    assert isinstance(create_runner(schema), GLiNER2Runner)


def test_factory_passes_detector_key():
    schema = RegexPipelineSchema(patterns={"x": RegexPatternDefinition(pattern=r"\d+")})
    runner = create_runner(schema, detector_key="my_key")
    assert isinstance(runner, RegexRunner)
    assert runner._detector_key == "my_key"
