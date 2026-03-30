import pytest

from src.detectors.base import BaseDetector
from src.models.generated_detectors import DetectorConfig, Severity
from src.models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location


class DummyDetector(BaseDetector):
    """Test implementation of BaseDetector"""

    detector_type = "test"
    detector_name = "dummy"

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        return [
            DetectionResult(
                detector_type=DetectorType.SECRETS,
                finding_type="test",
                category="dummy",
                severity=Severity.info,
                confidence=1.0,
                matched_content="test",
                location=Location(path="line 1", description="character range 0-4"),
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


def test_base_detector_initialization():
    """Test that detector can be initialized"""
    detector = DummyDetector()
    assert detector.detector_type == "test"
    assert detector.detector_name == "dummy"
    assert detector.config is not None


def test_base_detector_initialization_with_config():
    """Test detector initialization with custom config"""
    config = DetectorConfig(confidence_threshold=0.9, max_findings=10)
    detector = DummyDetector(config)
    assert detector.config.confidence_threshold == 0.9
    assert detector.config.max_findings == 10


@pytest.mark.asyncio
async def test_base_detector_detect():
    """Test that detect method returns results"""
    detector = DummyDetector()
    results = await detector.detect("test content")
    assert len(results) == 1
    assert results[0].category == "dummy"
    assert results[0].finding_type == "test"
    assert results[0].severity == Severity.info
    assert results[0].confidence == 1.0


def test_base_detector_metadata():
    """Test detector metadata retrieval"""
    detector = DummyDetector()
    meta = detector.get_metadata()
    assert meta["detector_type"] == "test"
    assert meta["detector_name"] == "dummy"
    assert "text/plain" in meta["content_types"]
    assert "requires_gpu" in meta
    assert isinstance(meta["requires_gpu"], bool)


def test_base_detector_requires_gpu_default():
    """Test that requires_gpu defaults to False"""
    detector = DummyDetector()
    assert detector.requires_gpu() is False


def test_base_detector_redact():
    """Test redaction functionality"""
    content = "This is a test secret value here"
    findings = [
        DetectionResult(
            detector_type=DetectorType.SECRETS,
            finding_type="test",
            category="test",
            severity=Severity.high,
            confidence=0.95,
            matched_content="secret",
            location=Location(path="line 1", description="character range 15-21"),
        )
    ]

    detector = DummyDetector()
    redacted = detector.redact(content, findings)
    assert "secret" not in redacted
    assert "******" in redacted
    assert redacted == "This is a test ****** value here"


def test_base_detector_redact_multiple_findings():
    """Test redaction with multiple findings"""
    content = "secret1 and secret2 here"
    findings = [
        DetectionResult(
            detector_type=DetectorType.SECRETS,
            finding_type="test",
            category="test",
            severity=Severity.high,
            confidence=0.95,
            matched_content="secret1",
            location=Location(path="line 1", description="character range 0-7"),
        ),
        DetectionResult(
            detector_type=DetectorType.SECRETS,
            finding_type="test",
            category="test",
            severity=Severity.high,
            confidence=0.95,
            matched_content="secret2",
            location=Location(path="line 1", description="character range 12-19"),
        ),
    ]

    detector = DummyDetector()
    redacted = detector.redact(content, findings)
    assert "secret1" not in redacted
    assert "secret2" not in redacted
    assert redacted == "******* and ******* here"


def test_base_detector_redact_no_location():
    """Test redaction when findings have no location"""
    content = "This is test content"
    findings = [
        DetectionResult(
            detector_type=DetectorType.SECRETS,
            finding_type="test",
            category="test",
            severity=Severity.high,
            confidence=0.95,
            matched_content="test",
            # No location specified
        )
    ]

    detector = DummyDetector()
    redacted = detector.redact(content, findings)
    # Should return original content when no location
    assert redacted == content
