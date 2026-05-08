"""Tests for the generic image-classification detector."""

import pytest

from src.detectors.content.image_classification_detector import ImageClassificationDetector
from src.detectors.dependencies import MissingDependencyError, ensure_torch, require_module
from src.models.generated_detectors import (
    DetectorConfig,
    ImageClassificationDetectorConfig,
    ImageClassificationSeverityRule,
    Severity,
)

try:
    ensure_torch("image_classification", ["content", "detectors"])
    require_module("transformers", "image_classification", ["content", "detectors"])
    require_module("PIL.Image", "image_classification", ["content", "detectors"])
except MissingDependencyError as exc:
    pytest.skip(str(exc), allow_module_level=True)


@pytest.mark.asyncio
async def test_initialization_defaults():
    detector = ImageClassificationDetector()
    assert detector.detector_type == "image_classification"
    assert detector.detector_name == "image_classification"
    assert detector.pipeline is not None


@pytest.mark.asyncio
async def test_initialization_with_config():
    config = ImageClassificationDetectorConfig(
        model="google/vit-base-patch16-224",
        device="cpu",
        top_k=3,
        confidence_threshold=0.5,
    )
    detector = ImageClassificationDetector(config)
    assert detector._model_id == "google/vit-base-patch16-224"
    assert detector._top_k == 3


@pytest.mark.asyncio
async def test_skips_non_image_content():
    detector = ImageClassificationDetector()
    results = await detector.detect(b"plain text", content_type="text/plain")
    assert results == []


@pytest.mark.asyncio
async def test_skips_string_content():
    detector = ImageClassificationDetector()
    results = await detector.detect("not bytes", content_type="image/jpeg")
    assert results == []


@pytest.mark.asyncio
async def test_invalid_image_handled_gracefully():
    detector = ImageClassificationDetector()
    results = await detector.detect(b"not an image", content_type="image/png")
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_detect_safe_image(sample_safe_image):
    detector = ImageClassificationDetector(DetectorConfig(confidence_threshold=0.1))
    results = await detector.detect(sample_safe_image, content_type="image/png")
    assert isinstance(results, list)
    for r in results:
        assert 0.0 <= r.confidence <= 1.0
        assert r.category == "CONTENT"


@pytest.mark.asyncio
async def test_confidence_threshold_filters(sample_safe_image):
    config = ImageClassificationDetectorConfig(confidence_threshold=0.99)
    detector = ImageClassificationDetector(config)
    results = await detector.detect(sample_safe_image, content_type="image/png")
    for r in results:
        assert r.confidence >= 0.99


@pytest.mark.asyncio
async def test_max_findings_respected(sample_safe_image):
    config = ImageClassificationDetectorConfig(max_findings=1, confidence_threshold=0.0)
    detector = ImageClassificationDetector(config)
    results = await detector.detect(sample_safe_image, content_type="image/png")
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_severity_map_applied(sample_safe_image):
    config = ImageClassificationDetectorConfig(
        confidence_threshold=0.0,
        severity_map=[
            ImageClassificationSeverityRule(pattern=".", severity=Severity.high),
        ],
    )
    detector = ImageClassificationDetector(config)
    results = await detector.detect(sample_safe_image, content_type="image/png")
    for r in results:
        assert r.severity == Severity.high


@pytest.mark.asyncio
async def test_no_severity_map_returns_info(sample_safe_image):
    config = ImageClassificationDetectorConfig(confidence_threshold=0.0, severity_map=None)
    detector = ImageClassificationDetector(config)
    results = await detector.detect(sample_safe_image, content_type="image/png")
    for r in results:
        assert r.severity == Severity.info


@pytest.mark.asyncio
async def test_results_sorted_by_confidence(sample_safe_image):
    detector = ImageClassificationDetector(DetectorConfig(confidence_threshold=0.0))
    results = await detector.detect(sample_safe_image, content_type="image/png")
    scores = [r.confidence for r in results]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.asyncio
async def test_result_structure(sample_safe_image):
    detector = ImageClassificationDetector(DetectorConfig(confidence_threshold=0.0))
    results = await detector.detect(sample_safe_image, content_type="image/png")
    for r in results:
        assert hasattr(r, "finding_type")
        assert hasattr(r, "category")
        assert hasattr(r, "severity")
        assert hasattr(r, "confidence")
        assert hasattr(r, "matched_content")
        assert r.category == "CONTENT"


@pytest.mark.asyncio
async def test_supported_content_types():
    detector = ImageClassificationDetector()
    types = detector.get_supported_content_types()
    assert "image/jpeg" in types
    assert "image/png" in types
    assert isinstance(types, list)
