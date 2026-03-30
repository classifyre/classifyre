"""Tests for secrets detector."""

import pytest

from src.detectors.secrets.detector import SecretsDetector
from src.models.generated_detectors import DetectorConfig, Severity


@pytest.mark.asyncio
async def test_secrets_detector_initialization():
    """Test that secrets detector can be initialized."""
    detector = SecretsDetector()
    assert detector.detector_type == "secrets"
    assert detector.detector_name == "secrets"
    assert detector.config is not None


@pytest.mark.asyncio
async def test_secrets_detector_initialization_with_config():
    """Test secrets detector with custom config."""
    config = DetectorConfig(confidence_threshold=0.95)
    detector = SecretsDetector(config)
    assert detector.config.confidence_threshold == 0.95


@pytest.mark.asyncio
async def test_detect_aws_key(sample_aws_content):
    """Test detection of AWS credentials."""
    detector = SecretsDetector()
    results = await detector.detect(sample_aws_content)

    # Should detect AWS access key ID and/or secret key
    assert len(results) >= 1, "Should detect at least one secret in AWS content"

    # Find AWS-related findings (look for AWS in type or check for key patterns)
    aws_findings = [
        r
        for r in results
        if "aws" in r.finding_type.lower() or "AKIA" in r.matched_content  # AWS access key pattern
    ]
    assert len(aws_findings) >= 1, (
        f"Should detect AWS keys, got: {[r.finding_type for r in results]}"
    )

    # Check severity
    for finding in aws_findings:
        assert finding.severity in [Severity.critical, Severity.high]

    # Check confidence
    for finding in aws_findings:
        assert finding.confidence >= 0.7


@pytest.mark.asyncio
async def test_detect_github_token(sample_github_token):
    """Test detection of GitHub personal access token."""
    detector = SecretsDetector()
    results = await detector.detect(sample_github_token)

    # Should detect GitHub token
    github_findings = [
        r for r in results if "github" in r.category.lower() or "github" in r.finding_type.lower()
    ]
    assert len(github_findings) >= 1

    # GitHub tokens are critical
    for finding in github_findings:
        assert finding.severity in [Severity.critical, Severity.high]


@pytest.mark.asyncio
async def test_detect_private_key(sample_private_key):
    """Test detection of private keys."""
    detector = SecretsDetector()
    results = await detector.detect(sample_private_key)

    # Should detect private key
    key_findings = [
        r
        for r in results
        if "private" in r.category.lower()
        or "rsa" in r.category.lower()
        or "key" in r.finding_type.lower()
    ]
    assert len(key_findings) >= 1

    # Private keys are critical
    for finding in key_findings:
        assert finding.severity in [Severity.critical, Severity.high]


@pytest.mark.asyncio
async def test_detect_slack_token(sample_slack_token):
    """Test detection of Slack tokens."""
    detector = SecretsDetector()
    results = await detector.detect(sample_slack_token)

    # Should detect Slack token
    slack_findings = [
        r for r in results if "slack" in r.category.lower() or "slack" in r.finding_type.lower()
    ]
    assert len(slack_findings) >= 1


@pytest.mark.asyncio
async def test_detect_stripe_key(sample_stripe_key):
    """Test detection of Stripe API keys."""
    detector = SecretsDetector()
    results = await detector.detect(sample_stripe_key)

    # Should detect Stripe key
    stripe_findings = [
        r for r in results if "stripe" in r.category.lower() or "stripe" in r.finding_type.lower()
    ]
    assert len(stripe_findings) >= 1


@pytest.mark.asyncio
async def test_no_false_positives_clean_content(sample_clean_content):
    """Test that clean content doesn't trigger false positives."""
    detector = SecretsDetector()
    results = await detector.detect(sample_clean_content)

    # Should have no findings for clean content
    assert len(results) == 0


@pytest.mark.asyncio
async def test_confidence_threshold_filtering():
    """Test that confidence threshold filters low-confidence results."""
    config = DetectorConfig(confidence_threshold=0.95)
    detector = SecretsDetector(config)

    # Ambiguous content that might have low confidence
    content = "maybe_key=abc123"
    results = await detector.detect(content)

    # All results should meet the confidence threshold
    for result in results:
        assert result.confidence >= 0.95


@pytest.mark.asyncio
async def test_redaction():
    """Test that secrets can be redacted."""
    content = "AWS Key: AKIAIOSFODNN7EXAMPLE in config"
    detector = SecretsDetector()
    results = await detector.detect(content)

    if results:
        redacted = detector.redact(content, results)
        # AWS key should be redacted
        assert "AKIA" not in redacted or "*" in redacted


@pytest.mark.asyncio
async def test_location_tracking():
    """Test that findings include location information."""
    content = "line1\nline2\nAWS_KEY=AKIAIOSFODNN7EXAMPLE\nline4"
    detector = SecretsDetector()
    results = await detector.detect(content)

    if results:
        # At least one result should have location info
        has_location = any(r.location is not None for r in results)
        assert has_location


@pytest.mark.asyncio
async def test_supported_content_types():
    """Test that detector reports supported content types."""
    detector = SecretsDetector()
    content_types = detector.get_supported_content_types()

    assert "text/plain" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    """Test detector metadata."""
    detector = SecretsDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "secrets"
    assert metadata["detector_name"] == "secrets"
    assert "content_types" in metadata
    assert metadata["requires_gpu"] is False


@pytest.mark.asyncio
async def test_max_findings_limit():
    """Test that max_findings config is respected."""
    # Content with multiple potential secrets
    content = """
    key1=AKIAIOSFODNN7EXAMPLE
    key2=AKIAIOSFODNN7ANOTHER
    key3=AKIAIOSFODNN7THIRD
    """

    config = DetectorConfig(max_findings=1)
    detector = SecretsDetector(config)
    results = await detector.detect(content)

    # Should limit to max_findings
    assert len(results) <= 1
