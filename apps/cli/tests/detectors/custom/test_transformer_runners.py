"""Stub-based unit tests for transformer pipeline runners."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.detectors.custom.runners import (
    ImageClassificationRunner,
    ObjectDetectionRunner,
    TextClassificationRunner,
)
from src.models.generated_detectors import (
    ImageClassificationPipelineSchema,
    ObjectDetectionPipelineSchema,
    PipelineSeverityRule,
    Severity,
    TextClassificationPipelineSchema,
)
from src.models.generated_single_asset_scan_results import DetectorType

# ── TextClassificationRunner ─────────────────────────────────────────────────


def _make_text_cls_runner(
    predictions: list,
    model: str = "stub/spam-model",
    confidence_threshold: float = 0.7,
    severity_map: list | None = None,
) -> TextClassificationRunner:
    schema = TextClassificationPipelineSchema(
        type="TEXT_CLASSIFICATION",
        model=model,
        confidence_threshold=confidence_threshold,
        severity_map=severity_map,
    )
    runner = TextClassificationRunner.__new__(TextClassificationRunner)
    runner._schema = schema
    runner._detector_key = "spam_detector"
    runner._detector_name = "Spam Detector"
    runner._pipe = MagicMock(return_value=predictions)
    return runner


@pytest.mark.asyncio
async def test_text_classification_runner_emits_classification_finding() -> None:
    runner = _make_text_cls_runner([{"label": "SPAM", "score": 0.95}])
    findings = runner.detect("Win a free iPhone now!", "text/plain")
    assert len(findings) == 1
    f = findings[0]
    assert f.detector_type == DetectorType.CUSTOM
    assert f.finding_type == "classification:SPAM"
    assert f.confidence == pytest.approx(0.95)
    assert f.custom_detector_key == "spam_detector"


@pytest.mark.asyncio
async def test_text_classification_runner_filters_below_threshold() -> None:
    runner = _make_text_cls_runner(
        [{"label": "SPAM", "score": 0.5}, {"label": "HAM", "score": 0.95}],
        confidence_threshold=0.8,
    )
    findings = runner.detect("Hello there", "text/plain")
    labels = {f.finding_type for f in findings}
    assert "classification:SPAM" not in labels
    assert "classification:HAM" in labels


@pytest.mark.asyncio
async def test_text_classification_runner_skips_image_content() -> None:
    runner = _make_text_cls_runner([{"label": "SPAM", "score": 0.99}])
    assert runner.detect(b"\x89PNG...", "image/png") == []


@pytest.mark.asyncio
async def test_text_classification_runner_skips_empty_text() -> None:
    runner = _make_text_cls_runner([{"label": "SPAM", "score": 0.99}])
    assert runner.detect("   ", "text/plain") == []


@pytest.mark.asyncio
async def test_text_classification_runner_applies_severity_map() -> None:
    runner = _make_text_cls_runner(
        [{"label": "spam", "score": 0.9}],
        severity_map=[PipelineSeverityRule(pattern="spam", severity=Severity.high)],
    )
    findings = runner.detect("Buy now!", "text/plain")
    assert findings[0].severity == Severity.high


def test_text_classification_run_raises_not_implemented() -> None:
    runner = _make_text_cls_runner([])
    with pytest.raises(NotImplementedError):
        runner.run("text")


def test_text_classification_supported_types() -> None:
    runner = _make_text_cls_runner([])
    types = runner.get_supported_content_types()
    assert "text/plain" in types
    assert "image/jpeg" not in types


# ── ImageClassificationRunner ─────────────────────────────────────────────────


def _make_image_cls_runner(
    predictions: list,
    model: str | None = None,
    confidence_threshold: float = 0.0,
    severity_map: list | None = None,
) -> ImageClassificationRunner:
    schema = ImageClassificationPipelineSchema(
        type="IMAGE_CLASSIFICATION",
        model=model,
        confidence_threshold=confidence_threshold,
        severity_map=severity_map,
    )
    runner = ImageClassificationRunner.__new__(ImageClassificationRunner)
    runner._schema = schema
    runner._detector_key = "nsfw_detector"
    runner._detector_name = "NSFW Detector"
    runner._model_id = model or "google/vit-base-patch16-224"
    runner._pipe = MagicMock(return_value=predictions)
    mock_img = MagicMock()
    mock_img.size = (224, 224)
    mock_img.mode = "RGB"
    runner._pil = MagicMock()
    runner._pil.open.return_value = mock_img
    return runner


@pytest.mark.asyncio
async def test_image_classification_runner_emits_classification_finding() -> None:
    runner = _make_image_cls_runner([{"label": "nsfw", "score": 0.88}])
    findings = runner.detect(b"\xff\xd8\xff", "image/jpeg")
    assert len(findings) == 1
    f = findings[0]
    assert f.detector_type == DetectorType.CUSTOM
    assert f.finding_type == "classification:nsfw"
    assert f.confidence == pytest.approx(0.88)


@pytest.mark.asyncio
async def test_image_classification_runner_skips_text_content() -> None:
    runner = _make_image_cls_runner([{"label": "nsfw", "score": 0.99}])
    assert runner.detect("some text", "text/plain") == []


@pytest.mark.asyncio
async def test_image_classification_runner_skips_bytes_passed_as_text() -> None:
    runner = _make_image_cls_runner([{"label": "nsfw", "score": 0.99}])
    assert runner.detect("some text", "image/jpeg") == []


def test_image_classification_run_raises_not_implemented() -> None:
    runner = _make_image_cls_runner([])
    with pytest.raises(NotImplementedError):
        runner.run("text")


def test_image_classification_supported_types() -> None:
    runner = _make_image_cls_runner([])
    types = runner.get_supported_content_types()
    assert "image/jpeg" in types
    assert "image/png" in types
    assert "text/plain" not in types


# ── ObjectDetectionRunner ─────────────────────────────────────────────────────


def _make_object_runner(
    detections: list,
    model: str = "facebook/detr-resnet-50",
    confidence_threshold: float = 0.5,
    severity_map: list | None = None,
) -> ObjectDetectionRunner:
    schema = ObjectDetectionPipelineSchema(
        type="OBJECT_DETECTION",
        model=model,
        confidence_threshold=confidence_threshold,
        severity_map=severity_map,
    )
    runner = ObjectDetectionRunner.__new__(ObjectDetectionRunner)
    runner._schema = schema
    runner._detector_key = "object_detector"
    runner._detector_name = "Object Detector"
    runner._pipe = MagicMock(return_value=detections)
    mock_img = MagicMock()
    mock_img.size = (640, 480)
    runner._pil = MagicMock()
    runner._pil.open.return_value = mock_img
    return runner


@pytest.mark.asyncio
async def test_object_detection_runner_emits_entity_finding_with_box() -> None:
    det = {
        "label": "person",
        "score": 0.92,
        "box": {"xmin": 10, "ymin": 20, "xmax": 100, "ymax": 200},
    }
    runner = _make_object_runner([det])
    findings = runner.detect(b"\xff\xd8\xff", "image/jpeg")
    assert len(findings) == 1
    f = findings[0]
    assert f.finding_type == "person"
    assert f.detector_type == DetectorType.CUSTOM
    assert f.location is not None
    assert "box" in (f.metadata or {})


@pytest.mark.asyncio
async def test_object_detection_runner_filters_below_threshold() -> None:
    dets = [
        {"label": "car", "score": 0.3, "box": {"xmin": 0, "ymin": 0, "xmax": 50, "ymax": 50}},
        {"label": "person", "score": 0.8, "box": {"xmin": 0, "ymin": 0, "xmax": 50, "ymax": 50}},
    ]
    runner = _make_object_runner(dets, confidence_threshold=0.5)
    findings = runner.detect(b"\xff\xd8\xff", "image/jpeg")
    labels = {f.finding_type for f in findings}
    assert "car" not in labels
    assert "person" in labels


@pytest.mark.asyncio
async def test_object_detection_runner_skips_text() -> None:
    runner = _make_object_runner([{"label": "cat", "score": 0.9, "box": {}}])
    assert runner.detect("some text", "text/plain") == []


def test_object_detection_run_raises_not_implemented() -> None:
    runner = _make_object_runner([])
    with pytest.raises(NotImplementedError):
        runner.run("text")


def test_object_detection_supported_types() -> None:
    runner = _make_object_runner([])
    types = runner.get_supported_content_types()
    assert "image/jpeg" in types
    assert "text/plain" not in types


# ── Schema validation ─────────────────────────────────────────────────────────


def test_text_classification_schema_requires_model() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        TextClassificationPipelineSchema(type="TEXT_CLASSIFICATION")  # type: ignore[call-arg]


def test_object_detection_schema_requires_model() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ObjectDetectionPipelineSchema(type="OBJECT_DETECTION")  # type: ignore[call-arg]
