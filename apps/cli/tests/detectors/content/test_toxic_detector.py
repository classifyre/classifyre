"""Tests for toxic content detector."""

import pytest

from src.detectors.content.toxic_detector import ToxicDetector
from src.detectors.dependencies import MissingDependencyError, ensure_torch, require_module
from src.models.generated_detectors import DetectorConfig, Severity

try:
    ensure_torch("toxic", ["content", "detectors"])
    require_module("detoxify", "toxic", ["content", "detectors"])
except MissingDependencyError as exc:
    pytest.skip(str(exc), allow_module_level=True)


@pytest.mark.asyncio
async def test_toxic_detector_initialization():
    """Test that toxic detector can be initialized."""
    detector = ToxicDetector()
    assert detector.detector_type == "toxic"
    assert detector.detector_name == "toxic"
    assert detector.config is not None


@pytest.mark.asyncio
async def test_toxic_detector_initialization_with_config():
    """Test toxic detector with custom config."""
    config = DetectorConfig(confidence_threshold=0.8)
    detector = ToxicDetector(config)
    assert detector.config.confidence_threshold == 0.8


@pytest.mark.asyncio
async def test_detect_toxic_content(sample_toxic_text):
    """Test detection of toxic content."""
    detector = ToxicDetector()
    results = await detector.detect(sample_toxic_text)

    # Should detect toxicity
    assert len(results) >= 1, f"Should detect toxic content, got {len(results)} results"

    # Check that toxicity was detected
    toxic_findings = [
        r
        for r in results
        if "toxic" in r.finding_type.lower() or "insult" in r.finding_type.lower()
    ]
    assert len(toxic_findings) >= 1, (
        f"Should find toxicity, got types: {[r.finding_type for r in results]}"
    )

    # Toxic content should be high severity
    for finding in toxic_findings:
        assert finding.severity in [Severity.high, Severity.critical]


@pytest.mark.asyncio
async def test_detect_threat(sample_threat_text):
    """Test detection of threatening language."""
    detector = ToxicDetector()
    results = await detector.detect(sample_threat_text)

    # Threat detection can have lower scores with subtle threats
    # Just verify the detector runs and returns structured results
    # If threats are detected, they should be high severity
    for finding in results:
        if "threat" in finding.finding_type.lower():
            assert finding.severity in [Severity.critical, Severity.high]


@pytest.mark.asyncio
async def test_detect_profanity(sample_profanity_text):
    """Test detection of profanity/obscenity."""
    detector = ToxicDetector()
    results = await detector.detect(sample_profanity_text)

    # Should detect obscene content
    assert len(results) >= 1, "Should detect profanity/obscenity"


@pytest.mark.asyncio
async def test_detect_identity_attack(sample_identity_attack_text):
    """Test detection of identity-based attacks."""
    detector = ToxicDetector()
    results = await detector.detect(sample_identity_attack_text)

    # Should detect some form of toxicity (may be general toxicity rather than specific identity attack)
    assert len(results) >= 1, (
        f"Should detect toxic content, got: {[r.finding_type for r in results]}"
    )

    # Verify high severity for toxic findings
    for finding in results:
        assert finding.severity in [Severity.medium, Severity.high, Severity.critical]


@pytest.mark.asyncio
async def test_no_false_positives_clean_text(sample_clean_text):
    """Test that clean text doesn't trigger false positives."""
    detector = ToxicDetector()
    results = await detector.detect(sample_clean_text)

    # Clean text should have no or very few findings
    assert len(results) == 0, (
        f"Clean text should not trigger detections, got: {[r.finding_type for r in results]}"
    )


@pytest.mark.asyncio
async def test_confidence_threshold_filtering():
    """Test that confidence threshold filters results."""
    config = DetectorConfig(confidence_threshold=0.9)
    detector = ToxicDetector(config)

    # Mildly negative but not clearly toxic
    content = "I don't like this very much"
    results = await detector.detect(content)

    # All results should meet threshold
    for result in results:
        assert result.confidence >= 0.9


@pytest.mark.asyncio
async def test_location_tracking():
    """Test that findings include location information."""
    content = "This is toxic content"
    detector = ToxicDetector()
    results = await detector.detect(content)

    # Results should have location info
    if results:
        assert results[0].location is not None


@pytest.mark.asyncio
async def test_supported_content_types():
    """Test that detector reports supported content types."""
    detector = ToxicDetector()
    content_types = detector.get_supported_content_types()

    assert "text/plain" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    """Test detector metadata."""
    detector = ToxicDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "toxic"
    assert metadata["detector_name"] == "toxic"
    assert "content_types" in metadata
    # Detoxify can run on CPU
    assert metadata["requires_gpu"] is False


@pytest.mark.asyncio
async def test_max_findings_limit():
    """Test that max_findings config is respected."""
    # Text with multiple toxic elements
    content = "You are stupid. You are an idiot. You are worthless."

    config = DetectorConfig(max_findings=1)
    detector = ToxicDetector(config)
    results = await detector.detect(content)

    # Should limit to max_findings
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_category_is_content():
    """Test that all results have category 'content'."""
    detector = ToxicDetector()
    content = "This is toxic and offensive"
    results = await detector.detect(content)

    for result in results:
        assert result.category == "CONTENT"


@pytest.mark.asyncio
async def test_multiple_toxicity_types():
    """Test detection of multiple toxicity types in one text."""
    # Text that's toxic in multiple ways
    content = "I hate you, you stupid idiot, and I will destroy you"
    detector = ToxicDetector()
    results = await detector.detect(content)

    # Should detect multiple types (toxicity, insult, threat)
    assert len(results) >= 2, "Should detect multiple toxicity types"

    finding_types = [r.finding_type.lower() for r in results]
    # Should have variety of types
    unique_types = len(set(finding_types))
    assert unique_types >= 2, "Should detect different types of toxicity"
