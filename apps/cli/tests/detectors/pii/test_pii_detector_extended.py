"""Extended tests for PII detector to validate DetectionResult fields."""

import pytest

from src.detectors.pii.detector import PIIDetector
from src.models.generated_detectors import Severity
from src.models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location

from .conftest import requires_presidio

pytestmark = requires_presidio


@pytest.mark.asyncio
async def test_detection_result_has_detector_type():
    """Test that all DetectionResults have detector_type field."""
    detector = PIIDetector()
    content = "Email: test@example.com and SSN: 123-45-6789"
    results = await detector.detect(content)

    assert len(results) > 0, "Should detect PII"
    for result in results:
        assert isinstance(result, DetectionResult)
        assert result.detector_type == DetectorType.PII


@pytest.mark.asyncio
async def test_detection_result_fields_complete():
    """Test that DetectionResult has all expected fields populated."""
    detector = PIIDetector()
    content = "Contact me at john.doe@example.com"
    results = await detector.detect(content)

    assert len(results) > 0, "Should detect email"

    for result in results:
        # Required fields
        assert result.detector_type is not None
        assert result.finding_type is not None
        assert result.category == "PII"
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
async def test_detection_result_email_specific():
    """Test email detection produces correct result structure."""
    detector = PIIDetector()
    content = "My email is john.doe@example.com for contact"
    results = await detector.detect(content)

    email_findings = [r for r in results if "email" in r.finding_type.lower()]
    assert len(email_findings) >= 1, (
        f"Should detect email, got: {[r.finding_type for r in results]}"
    )

    email_result = email_findings[0]
    assert "john.doe@example.com" in email_result.matched_content
    assert email_result.category == "PII"
    assert email_result.detector_type == DetectorType.PII


@pytest.mark.asyncio
async def test_detection_result_severity_levels():
    """Test that different PII types have appropriate severity levels."""
    detector = PIIDetector()

    # Test credit card (should be critical)
    cc_content = "Card: 4532123456789010"
    cc_results = await detector.detect(cc_content)
    for r in cc_results:
        if "credit" in r.finding_type.lower() or "card" in r.finding_type.lower():
            assert r.severity == Severity.critical


@pytest.mark.asyncio
async def test_detection_result_metadata():
    """Test that DetectionResult includes metadata."""
    detector = PIIDetector()
    content = "Email: test@example.com"
    results = await detector.detect(content)

    for result in results:
        assert result.metadata is not None
        assert "recognizer" in result.metadata
        assert "entity_type" in result.metadata


@pytest.mark.asyncio
async def test_detection_result_location_format():
    """Test that location is properly formatted as Location model."""
    detector = PIIDetector()
    content = "Name: John Smith\nEmail: john@test.com"
    results = await detector.detect(content)

    for result in results:
        # Location should be a Location model
        assert isinstance(result.location, Location)
        loc = result.location
        assert loc.path is not None
        assert isinstance(loc.path, str)


@pytest.mark.asyncio
async def test_detector_type_enum_value():
    """Test that detector_type is proper enum value."""
    detector = PIIDetector()
    content = "SSN: 078-05-1120"
    results = await detector.detect(content)

    for result in results:
        # Should be enum value, not string
        assert result.detector_type == DetectorType.PII
        assert str(result.detector_type.value) == "PII"


@pytest.mark.asyncio
async def test_no_errors_with_real_wordpress_content():
    """Test detector works with typical WordPress blog content."""
    detector = PIIDetector()

    # Typical blog content (should have minimal PII)
    content = """
    Welcome to our blog! In this article, we'll discuss investment strategies.

    John Smith is a financial advisor with 20 years of experience.
    He works at ABC Financial Services in New York.

    For questions, contact us at info@example.com

    This is educational content and not financial advice.
    """

    results = await detector.detect(content)

    # Should detect some things (names, email, location) but not crash
    assert isinstance(results, list)

    # All results should have proper structure
    for result in results:
        assert result.detector_type == DetectorType.PII
        assert result.finding_type is not None
        assert result.confidence > 0


@pytest.mark.asyncio
async def test_detection_result_json_serialization():
    """Test that DetectionResult can be serialized to JSON."""
    detector = PIIDetector()
    content = "Email: test@example.com"
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
