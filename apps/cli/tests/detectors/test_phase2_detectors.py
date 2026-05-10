"""Unit tests for Phase 2 model-backed detectors."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content.language_detector import LanguageDetector
from src.models.generated_detectors import (
    LanguageDetectorConfig,
)
from src.models.generated_single_asset_scan_results import DetectorType


def _stub_language_detector(raw_result):
    class _Module:
        @staticmethod
        def detect(_content, **_kwargs):
            return [raw_result] if isinstance(raw_result, dict) else raw_result

    detector = LanguageDetector.__new__(LanguageDetector)
    cfg = LanguageDetectorConfig()
    BaseDetector.__init__(detector, cfg)
    detector._cfg = cfg
    detector._detector_module = _Module()
    detector._initialized = True
    return detector


@pytest.mark.asyncio
async def test_language_detector_emits_quality_finding() -> None:
    detector = _stub_language_detector({"lang": "de", "score": 0.99})

    findings = await detector.detect("Hallo zusammen", content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.LANGUAGE
    assert findings[0].category == "QUALITY"
    assert findings[0].finding_type == "language:de"
