"""Extended tests for Secrets detector to validate DetectionResult fields."""

import pytest

from src.detectors.secrets.detector import SecretsDetector
from src.models.generated_detectors import Severity
from src.models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location


@pytest.mark.asyncio
async def test_detection_result_has_detector_type():
    """Test that all DetectionResults have detector_type field."""
    detector = SecretsDetector()
    content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    results = await detector.detect(content)

    assert len(results) > 0, "Should detect AWS secret"
    for result in results:
        assert isinstance(result, DetectionResult)
        assert result.detector_type == DetectorType.SECRETS


@pytest.mark.asyncio
async def test_detection_result_fields_complete():
    """Test that DetectionResult has all expected fields populated."""
    detector = SecretsDetector()
    content = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    results = await detector.detect(content)

    assert len(results) > 0, "Should detect GitHub token"

    for result in results:
        # Required fields
        assert result.detector_type is not None
        assert result.finding_type is not None
        assert result.category == "SECRETS"
        assert result.severity in [
            Severity.critical,
            Severity.high,
            Severity.medium,
            Severity.low,
            Severity.info,
        ]
        assert 0 <= result.confidence <= 1
        assert result.matched_content is not None and len(result.matched_content) > 0

        # Location fields (Location is a Pydantic model, not dict)
        assert result.location is not None
        assert isinstance(result.location, Location)
        assert result.location.path is not None
        assert len(result.location.path) > 0


@pytest.mark.asyncio
async def test_detection_result_aws_specific():
    """Test AWS detection produces correct result structure."""
    detector = SecretsDetector()
    content = """
    # AWS Config
    AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
    AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
    """
    results = await detector.detect(content)

    assert len(results) > 0, f"Should detect AWS keys, got: {[r.finding_type for r in results]}"

    for result in results:
        assert result.category == "SECRETS"
        assert result.detector_type == DetectorType.SECRETS
        assert result.severity == Severity.critical  # AWS keys are critical


@pytest.mark.asyncio
async def test_detection_result_private_key():
    """Test private key detection."""
    detector = SecretsDetector()
    content = """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgwMbRvI0MBZhpI
-----END RSA PRIVATE KEY-----"""

    results = await detector.detect(content)

    # Should detect private key
    key_findings = [
        r for r in results if "private" in r.finding_type.lower() or "key" in r.finding_type.lower()
    ]
    assert len(key_findings) >= 1, (
        f"Should detect private key, got: {[r.finding_type for r in results]}"
    )

    for result in key_findings:
        assert result.detector_type == DetectorType.SECRETS
        assert result.severity == Severity.critical


@pytest.mark.asyncio
async def test_detection_result_metadata():
    """Test that DetectionResult includes metadata."""
    detector = SecretsDetector()
    content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    results = await detector.detect(content)

    for result in results:
        assert result.metadata is not None
        assert "detector" in result.metadata
        assert "plugin" in result.metadata


@pytest.mark.asyncio
async def test_detection_result_location_format():
    """Test that location is properly formatted as Location model."""
    detector = SecretsDetector()
    content = "line1\nline2\nAWS_KEY=AKIAIOSFODNN7EXAMPLE\nline4"
    results = await detector.detect(content)

    for result in results:
        # Location should be a Location model
        assert isinstance(result.location, Location)
        loc = result.location
        assert loc.path is not None
        assert isinstance(loc.path, str)
        assert "line 3" in loc.path


@pytest.mark.asyncio
async def test_detector_type_enum_value():
    """Test that detector_type is proper enum value."""
    detector = SecretsDetector()
    content = "sk_live_1234567890abcdefghijklmnopqrstuv"
    results = await detector.detect(content)

    for result in results:
        assert result.detector_type == DetectorType.SECRETS
        assert str(result.detector_type.value) == "SECRETS"


@pytest.mark.asyncio
async def test_no_errors_with_clean_content():
    """Test detector handles clean content without errors."""
    detector = SecretsDetector()

    content = """
    Welcome to our blog! In this article, we'll discuss investment strategies.

    This is educational content and not financial advice.

    Regular text without any secrets or API keys.
    """

    results = await detector.detect(content)

    # Should return empty list for clean content
    assert isinstance(results, list)
    assert len(results) == 0


@pytest.mark.asyncio
async def test_multiple_secrets_detection():
    """Test detection of multiple secrets in one document."""
    detector = SecretsDetector()
    content = """
    AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE

    GitHub token: ghp_1234567890abcdefghijklmnopqrstuvwxyz

    Stripe key: sk_live_1234567890abcdefghijklmnopqrstuv
    """

    results = await detector.detect(content)

    # Should detect multiple secrets
    assert len(results) >= 1, f"Should detect secrets, got: {[r.finding_type for r in results]}"

    # All should have proper detector type
    for result in results:
        assert result.detector_type == DetectorType.SECRETS
        assert result.category == "SECRETS"


@pytest.mark.asyncio
async def test_confidence_scores():
    """Test that confidence scores are reasonable."""
    detector = SecretsDetector()
    content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    results = await detector.detect(content)

    for result in results:
        # Confidence should be between 0 and 1
        assert 0 <= result.confidence <= 1
        # AWS keys should have high confidence
        if "aws" in result.finding_type.lower():
            assert result.confidence >= 0.7


@pytest.mark.asyncio
async def test_detection_result_json_serialization():
    """Test that DetectionResult can be serialized to JSON."""
    detector = SecretsDetector()
    content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    results = await detector.detect(content)

    assert len(results) > 0

    for result in results:
        # Should be able to serialize to dict (JSON)
        result_dict = result.model_dump()
        assert isinstance(result_dict, dict)
        assert "detector_type" in result_dict
        assert "finding_type" in result_dict
        assert "location" in result_dict
        # Location should be dict after serialization
        assert isinstance(result_dict["location"], dict)
        assert "path" in result_dict["location"]
