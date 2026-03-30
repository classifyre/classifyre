"""Unit tests for Phase 2 model-backed detectors."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.content.language_detector import LanguageDetector
from src.detectors.content.spam_detector import SpamDetector
from src.detectors.threat.phishing_url_detector import PhishingURLDetector
from src.models.generated_detectors import DetectorConfig
from src.models.generated_single_asset_scan_results import DetectorType


def _stub_spam_detector(predictions):
    detector = SpamDetector.__new__(SpamDetector)
    BaseDetector.__init__(detector, DetectorConfig(confidence_threshold=0.7))
    detector.classifier = lambda *_args, **_kwargs: predictions
    detector._model_id = "stub/spam"
    detector._max_length = 512
    detector._transformers = None
    return detector


def _stub_phishing_detector(predictions):
    detector = PhishingURLDetector.__new__(PhishingURLDetector)
    BaseDetector.__init__(detector, DetectorConfig(confidence_threshold=0.7))
    detector.classifier = lambda *_args, **_kwargs: predictions
    detector._model_id = "stub/phishing"
    detector._transformers = None
    return detector


def _stub_language_detector(raw_result):
    class _Module:
        @staticmethod
        def detect(_content):
            return raw_result

    detector = LanguageDetector.__new__(LanguageDetector)
    BaseDetector.__init__(detector, DetectorConfig(confidence_threshold=0.7))
    detector._detector_module = _Module()
    return detector


@pytest.mark.asyncio
async def test_spam_detector_emits_quality_finding() -> None:
    detector = _stub_spam_detector(
        [{"label": "SPAM", "score": 0.95}, {"label": "HAM", "score": 0.05}]
    )

    findings = await detector.detect("Win a free vacation now!", content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.SPAM
    assert findings[0].category == "QUALITY"


@pytest.mark.asyncio
async def test_phishing_url_detector_emits_threat_finding() -> None:
    detector = _stub_phishing_detector(
        [{"label": "phishing", "score": 0.92}, {"label": "benign", "score": 0.08}]
    )

    content = "Go to https://secure-login-example.com to confirm your account."
    findings = await detector.detect(content, content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.PHISHING_URL
    assert findings[0].category == "THREAT"


@pytest.mark.asyncio
async def test_language_detector_emits_quality_finding() -> None:
    detector = _stub_language_detector({"lang": "de", "score": 0.99})

    findings = await detector.detect("Hallo zusammen", content_type="text/plain")

    assert findings
    assert findings[0].detector_type == DetectorType.LANGUAGE
    assert findings[0].category == "QUALITY"
    assert findings[0].finding_type == "language:de"
