"""Tests for TextClassificationDetector."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content.text_classification_detector import TextClassificationDetector
from src.detectors.dependencies import MissingDependencyError
from src.models.generated_detectors import (
    TextClassificationDetectorConfig,
    TextClassificationSeverityRule,
)
from src.models.generated_single_asset_scan_results import Severity


def _stub_detector(
    predictions: list[dict],
    confidence_threshold: float = 0.7,
    severity_map: list[TextClassificationSeverityRule] | None = None,
    max_findings: int | None = None,
) -> TextClassificationDetector:
    """Create a TextClassificationDetector with a pre-built pipeline stub (no network)."""
    config = TextClassificationDetectorConfig(
        model="stub/classifier",
        confidence_threshold=confidence_threshold,
        severity_map=severity_map,
        max_findings=max_findings,
    )
    detector = TextClassificationDetector.__new__(TextClassificationDetector)
    BaseDetector.__init__(detector, config)
    detector._cfg = config
    detector._model_id = "stub/classifier"
    detector._severity_map = severity_map
    detector.pipeline = lambda text, **kwargs: predictions
    return detector


@pytest.mark.asyncio
async def test_detects_label_above_threshold() -> None:
    detector = _stub_detector([{"label": "SPAM", "score": 0.95}, {"label": "HAM", "score": 0.05}])
    findings = await detector.detect("Win big now! Click here!", content_type="text/plain")
    assert len(findings) == 1
    assert findings[0].finding_type == "SPAM"
    assert findings[0].confidence == pytest.approx(0.95)


@pytest.mark.asyncio
async def test_filters_label_below_threshold() -> None:
    detector = _stub_detector([{"label": "SPAM", "score": 0.5}, {"label": "HAM", "score": 0.5}])
    findings = await detector.detect("Some text", content_type="text/plain")
    assert findings == []


@pytest.mark.asyncio
async def test_severity_map_applied() -> None:
    severity_map = [
        TextClassificationSeverityRule(pattern="spam", severity=Severity.high),
        TextClassificationSeverityRule(pattern="ham", severity=Severity.info),
    ]
    detector = _stub_detector(
        [{"label": "SPAM", "score": 0.9}],
        severity_map=severity_map,
    )
    findings = await detector.detect("Win free prizes!", content_type="text/plain")
    assert findings
    assert findings[0].severity == Severity.high


@pytest.mark.asyncio
async def test_empty_content_returns_no_findings() -> None:
    detector = _stub_detector([{"label": "SPAM", "score": 0.99}])
    findings = await detector.detect("   ", content_type="text/plain")
    assert findings == []


@pytest.mark.asyncio
async def test_unsupported_content_type_returns_no_findings() -> None:
    detector = _stub_detector([{"label": "SPAM", "score": 0.99}])
    findings = await detector.detect("some bytes", content_type="image/png")
    assert findings == []


@pytest.mark.asyncio
async def test_max_findings_respected() -> None:
    predictions = [{"label": f"LABEL_{i}", "score": 0.9} for i in range(10)]
    detector = _stub_detector(predictions, confidence_threshold=0.5, max_findings=3)
    findings = await detector.detect("text", content_type="text/plain")
    assert len(findings) <= 3


def test_missing_model_raises_error() -> None:
    config = TextClassificationDetectorConfig(model=None)
    with pytest.raises(MissingDependencyError):
        TextClassificationDetector(config)
