"""Tests for YARA threat detector."""

import pytest

from src.detectors.threat.yara_detector import YaraDetector
from src.models.generated_detectors import DetectorConfig, Severity


@pytest.mark.asyncio
async def test_yara_detector_initialization():
    """Test that YARA detector can be initialized."""
    detector = YaraDetector()
    assert detector.detector_type == "yara"
    assert detector.detector_name == "yara"
    assert detector.config is not None


@pytest.mark.asyncio
async def test_yara_detector_initialization_with_config():
    """Test YARA detector with custom config."""
    config = DetectorConfig(confidence_threshold=0.9)
    detector = YaraDetector(config)
    assert detector.config.confidence_threshold == 0.9


@pytest.mark.asyncio
async def test_detect_suspicious_script(sample_suspicious_script):
    """Test detection of suspicious script patterns."""
    detector = YaraDetector()
    results = await detector.detect(sample_suspicious_script, content_type="application/x-sh")

    # Should detect suspicious patterns
    assert len(results) >= 1, f"Should detect suspicious patterns, got {len(results)} results"

    # Check for high severity
    for finding in results:
        assert finding.severity in [Severity.medium, Severity.high, Severity.critical]


@pytest.mark.asyncio
async def test_detect_malware_patterns(sample_malware_pattern):
    """Test detection of malware-like API calls."""
    detector = YaraDetector()
    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    # Should detect Windows API patterns
    assert len(results) >= 1, (
        f"Should detect malware patterns, got: {[r.finding_type for r in results]}"
    )

    # Malware patterns should be high/critical severity
    for finding in results:
        assert finding.severity in [Severity.high, Severity.critical]


@pytest.mark.asyncio
async def test_no_false_positives_clean_script(sample_clean_script):
    """Test that clean scripts don't trigger false positives."""
    detector = YaraDetector()
    results = await detector.detect(sample_clean_script, content_type="application/x-sh")

    # Clean scripts should have no or very few detections
    # (may detect some generic patterns)
    high_severity_findings = [
        r for r in results if r.severity in [Severity.high, Severity.critical]
    ]
    assert len(high_severity_findings) == 0, (
        f"Clean script should not trigger high-severity alerts: {[r.finding_type for r in results]}"
    )


@pytest.mark.asyncio
async def test_no_false_positives_clean_text(sample_clean_text_bytes):
    """Test that clean text doesn't trigger false positives."""
    detector = YaraDetector()
    results = await detector.detect(sample_clean_text_bytes, content_type="text/plain")

    # Should have no detections for clean text
    assert len(results) == 0, (
        f"Clean text should not trigger detections: {[r.finding_type for r in results]}"
    )


@pytest.mark.asyncio
async def test_supported_content_types():
    """Test that detector reports supported content types."""
    detector = YaraDetector()
    content_types = detector.get_supported_content_types()

    # Should support binary and script types
    assert "application/octet-stream" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    """Test detector metadata."""
    detector = YaraDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "yara"
    assert metadata["detector_name"] == "yara"
    assert "content_types" in metadata
    assert metadata["requires_gpu"] is False


@pytest.mark.asyncio
async def test_confidence_threshold_filtering(sample_malware_pattern):
    """Test that confidence threshold filters results."""
    config = DetectorConfig(confidence_threshold=0.95)
    detector = YaraDetector(config)

    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    # All results should meet threshold
    for result in results:
        assert result.confidence >= 0.95


@pytest.mark.asyncio
async def test_max_findings_limit(sample_malware_pattern):
    """Test that max_findings config is respected."""
    config = DetectorConfig(max_findings=1)
    detector = YaraDetector(config)

    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    # Should limit to max_findings
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_category_is_threat(sample_malware_pattern):
    """Test that all results have category 'threat'."""
    detector = YaraDetector()
    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    for result in results:
        assert result.category == "THREAT"


@pytest.mark.asyncio
async def test_location_tracking(sample_malware_pattern):
    """Test that findings include location information."""
    detector = YaraDetector()
    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    if results:
        # Results should have location info
        assert results[0].location is not None


@pytest.mark.asyncio
async def test_results_have_proper_structure(sample_malware_pattern):
    """Test that results have proper structure."""
    detector = YaraDetector()
    results = await detector.detect(sample_malware_pattern, content_type="application/octet-stream")

    for result in results:
        # Should have all required fields
        assert hasattr(result, "finding_type")
        assert hasattr(result, "category")
        assert hasattr(result, "severity")
        assert hasattr(result, "confidence")
        assert hasattr(result, "matched_content")

        # Category should be threat
        assert result.category == "THREAT"

        # Confidence should be valid
        assert 0 <= result.confidence <= 1


@pytest.mark.asyncio
async def test_handles_empty_content():
    """Test handling of empty content."""
    detector = YaraDetector()
    results = await detector.detect(b"", content_type="application/octet-stream")

    # Should handle gracefully
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_handles_large_content():
    """Test handling of large content."""
    detector = YaraDetector()

    # Create large content
    large_content = b"A" * 1000000  # 1MB of data

    results = await detector.detect(large_content, content_type="application/octet-stream")

    # Should handle gracefully
    assert isinstance(results, list)
