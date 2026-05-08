"""Unit tests for Phase 2 model-backed detectors."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content.language_detector import LanguageDetector
from src.detectors.content.text_classification_detector import TextClassificationDetector
from src.models.generated_detectors import DetectorConfig, GenericDetectorConfig, TextClassificationDetectorConfig
from src.models.generated_single_asset_scan_results import DetectorType


def _stub_text_classification_detector(predictions):
    config = TextClassificationDetectorConfig(model="stub/classifier", confidence_threshold=0.7)
    detector = TextClassificationDetector.__new__(TextClassificationDetector)
    BaseDetector.__init__(detector, config)
    detector._cfg = config
    detector._model_id = "stub/classifier"
    detector._severity_map = None
    detector.pipeline = lambda text, **kwargs: predictions
    return detector


def _stub_language_detector(raw_result):
    class _Module:
        @staticmethod
        def detect(_content):
            return raw_result

    detector = LanguageDetector.__new__(LanguageDetector)
    cfg = GenericDetectorConfig()
    BaseDetector.__init__(detector, cfg)
    detector._cfg = cfg
    detector._detector_module = _Module()
    return detector


@pytest.mark.asyncio
async def test_text_classification_detector_emits_finding() -> None:
    detector = _stub_text_classification_detector(
        [{"label": "SPAM", "score": 0.95}, {"label": "HAM", "score": 0.05}]
    )

    findings = await detector.detect("Win a free vacation now!", content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.TEXT_CLASSIFICATION
    assert findings[0].category == "CONTENT"


@pytest.mark.asyncio
async def test_language_detector_emits_quality_finding() -> None:
    detector = _stub_language_detector({"lang": "de", "score": 0.99})

    findings = await detector.detect("Hallo zusammen", content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.LANGUAGE
    assert findings[0].category == "QUALITY"
    assert findings[0].finding_type == "language:de"
