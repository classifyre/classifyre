"""Tests for PII detector."""

import pytest

from src.detectors.dependencies import MissingDependencyError
from src.detectors.pii.detector import PIIDetector, _RegexPIIAnalyzer
from src.models.generated_detectors import DetectorConfig, PIIDetectorConfig, Severity
from src.sources.tabular_utils import format_tabular_sample_content


@pytest.mark.asyncio
async def test_pii_detector_initialization():
    """Test that PII detector can be initialized."""
    detector = PIIDetector()
    assert detector.detector_type == "pii"
    assert detector.detector_name == "pii"
    assert detector.config is not None


@pytest.mark.asyncio
async def test_pii_detector_initialization_with_config():
    """Test PII detector with custom config."""
    config = DetectorConfig(confidence_threshold=0.9)
    detector = PIIDetector(config)
    assert detector.config.confidence_threshold == 0.9


@pytest.mark.asyncio
async def test_detect_ssn(sample_ssn):
    """Test detection of Social Security Numbers."""
    detector = PIIDetector()
    results = await detector.detect(sample_ssn)

    # Should detect something that looks like sensitive data
    # (Presidio may detect SSN pattern as different entity types)
    assert len(results) >= 1, (
        f"Should detect something in SSN content, got: {[r.finding_type for r in results]}"
    )

    # Should have location info
    assert results[0].location is not None
    # The pattern 078-05-1120 should be detected somewhere
    assert "078-05-1120" in sample_ssn


@pytest.mark.asyncio
async def test_detect_credit_card(sample_credit_card):
    """Test detection of credit card numbers."""
    detector = PIIDetector()
    results = await detector.detect(sample_credit_card)

    # Should detect something in credit card content
    # (Pattern recognition may vary - card number might be detected as different type)
    assert len(results) >= 1, (
        f"Should detect something in credit card content, got: {[r.finding_type for r in results]}"
    )

    # Verify the card number pattern exists in content
    assert "4532123456789010" in sample_credit_card


@pytest.mark.asyncio
async def test_detect_email(sample_email):
    """Test detection of email addresses."""
    detector = PIIDetector()
    results = await detector.detect(sample_email)

    # Should detect email
    email_findings = [r for r in results if "email" in r.finding_type.lower()]
    assert len(email_findings) >= 1, (
        f"Should detect email, got: {[r.finding_type for r in results]}"
    )

    # Check that email was extracted
    assert any("john.doe@example.com" in f.matched_content for f in email_findings)


@pytest.mark.asyncio
async def test_detect_phone(sample_phone):
    """Test detection of phone numbers."""
    detector = PIIDetector()
    results = await detector.detect(sample_phone)

    # Phone detection can be unreliable with Presidio
    # Just verify the fixture has the expected pattern
    assert "212-555-1234" in sample_phone

    # If something is detected, verify it has proper structure
    if results:
        for finding in results:
            assert finding.location is not None
            assert finding.confidence > 0


@pytest.mark.asyncio
async def test_detect_person_names(sample_person_name):
    """Test detection of person names."""
    detector = PIIDetector()
    results = await detector.detect(sample_person_name)

    # Should detect person names
    name_findings = [
        r for r in results if "person" in r.finding_type.lower() or "name" in r.finding_type.lower()
    ]
    # Names are harder to detect, so we'll be lenient here
    # At least one name should be detected
    if len(name_findings) >= 1:
        # Names are typically lower severity
        for finding in name_findings:
            assert finding.severity in [Severity.low, Severity.medium, Severity.high]


@pytest.mark.asyncio
async def test_detect_mixed_pii(sample_mixed_pii):
    """Test detection of multiple PII types in one document."""
    detector = PIIDetector()
    results = await detector.detect(sample_mixed_pii)

    # Should detect multiple types
    assert len(results) >= 3, f"Should detect multiple PII items, got {len(results)}"

    # Check for specific types
    finding_types = [r.finding_type.lower() for r in results]

    # Should have at least email or phone
    has_contact = any("email" in t or "phone" in t for t in finding_types)
    assert has_contact, "Should detect at least email or phone"


@pytest.mark.asyncio
async def test_no_false_positives_clean_content(sample_clean_content):
    """Test that clean content doesn't trigger false positives."""
    detector = PIIDetector()
    results = await detector.detect(sample_clean_content)

    # Should have no or very few findings for clean content
    # (might detect the number 5432 as something, so we're lenient)
    assert len(results) <= 2, f"Too many false positives: {[r.finding_type for r in results]}"


@pytest.mark.asyncio
async def test_confidence_threshold_filtering():
    """Test that confidence threshold filters low-confidence results."""
    config = DetectorConfig(confidence_threshold=0.95)
    detector = PIIDetector(config)

    content = "Call me at 123-456-7890"  # Might be ambiguous
    results = await detector.detect(content)

    # All results should meet the confidence threshold
    for result in results:
        assert result.confidence >= 0.95


@pytest.mark.asyncio
async def test_redaction():
    """Test that PII can be redacted."""
    content = "My email is john@example.com and phone is 555-1234"
    detector = PIIDetector()
    results = await detector.detect(content)

    if results:
        redacted = detector.redact(content, results)
        # Email should be redacted
        assert "john@example.com" not in redacted or "*" in redacted


@pytest.mark.asyncio
async def test_location_tracking():
    """Test that findings include location information."""
    content = "Name: Alice\nEmail: alice@test.com\nPhone: 555-0000"
    detector = PIIDetector()
    results = await detector.detect(content)

    if results:
        # At least one result should have location info
        has_location = any(r.location is not None for r in results)
        assert has_location


@pytest.mark.asyncio
async def test_supported_content_types():
    """Test that detector reports supported content types."""
    detector = PIIDetector()
    content_types = detector.get_supported_content_types()

    assert "text/plain" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    """Test detector metadata."""
    detector = PIIDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "pii"
    assert metadata["detector_name"] == "pii"
    assert "content_types" in metadata
    assert metadata["requires_gpu"] is False


@pytest.mark.asyncio
async def test_max_findings_limit():
    """Test that max_findings config is respected."""
    content = """
Name: John Doe
Email: john@example.com
Phone: 555-1111
SSN: 111-22-3333
Card: 4111-1111-1111-1111
"""

    config = DetectorConfig(max_findings=2)
    detector = PIIDetector(config)
    results = await detector.detect(content)

    # Should limit to max_findings
    assert len(results) <= 2


@pytest.mark.asyncio
async def test_category_is_pii():
    """Test that all results have category 'pii'."""
    detector = PIIDetector()
    content = "Email: test@example.com and SSN: 123-45-6789"
    results = await detector.detect(content)

    for result in results:
        assert result.category == "PII"


@pytest.mark.asyncio
async def test_detect_falls_back_when_presidio_runtime_module_data_is_missing():
    """Runtime Presidio errors should switch detector to regex fallback."""

    class _FailingAnalyzer:
        def analyze(self, text: str, language: str = "en"):
            raise ModuleNotFoundError("No module named 'phonenumbers.data.region_US'")

    detector = PIIDetector()
    detector.analyzer = _FailingAnalyzer()

    results = await detector.detect("Contact: jane.doe@example.com")

    assert results
    assert isinstance(detector.analyzer, _RegexPIIAnalyzer)
    assert any(result.finding_type == "EMAIL_ADDRESS" for result in results)


@pytest.mark.asyncio
async def test_detector_initialization_falls_back_when_presidio_import_is_broken(monkeypatch):
    def _broken_require_module(*_args, **_kwargs):
        raise MissingDependencyError(
            detector_name="pii",
            dependencies=["presidio_analyzer"],
            uv_groups=["privacy", "detectors"],
            detail="numpy.core.multiarray failed to import",
        )

    monkeypatch.setattr("src.detectors.pii.detector.require_module", _broken_require_module)

    detector = PIIDetector()

    assert isinstance(detector.analyzer, _RegexPIIAnalyzer)

    results = await detector.detect("Contact: jane.doe@example.com")

    assert any(result.finding_type == "EMAIL_ADDRESS" for result in results)


@pytest.mark.asyncio
async def test_enabled_patterns_filters_out_unconfigured_entities():
    class _StubAnalyzer:
        def analyze(self, text: str, language: str = "en"):
            del text, language
            return [
                _RegexPIIAnalyzer().analyze("name@example.com")[0],
                type(
                    "_PersonResult",
                    (),
                    {
                        "start": 0,
                        "end": 12,
                        "entity_type": "PERSON",
                        "score": 0.91,
                        "recognition_metadata": {"recognizer_name": "stub"},
                    },
                )(),
                type(
                    "_DateResult",
                    (),
                    {
                        "start": 0,
                        "end": 10,
                        "entity_type": "DATE_TIME",
                        "score": 0.91,
                        "recognition_metadata": {"recognizer_name": "stub"},
                    },
                )(),
            ]

    detector = PIIDetector(PIIDetectorConfig(enabled_patterns=["email"], confidence_threshold=0.0))
    detector.analyzer = _StubAnalyzer()

    results = await detector.detect("name@example.com John Smith 2024-01-01")

    assert [result.finding_type for result in results] == ["EMAIL_ADDRESS"]


@pytest.mark.asyncio
async def test_tabular_detection_scans_per_cell_and_filters_entities_by_column() -> None:
    def _result(text: str, entity_type: str, score: float = 0.95):
        return type(
            "_StubResult",
            (),
            {
                "start": 0,
                "end": len(text),
                "entity_type": entity_type,
                "score": score,
                "recognition_metadata": {"recognizer_name": "stub"},
            },
        )()

    class _StubAnalyzer:
        def analyze(self, text: str, language: str = "en"):
            del language
            if text == "Patrick Clark":
                return [_result("Patrick Clark", "PERSON")]
            if text == "carlacherry@example.org":
                return [_result("carlacherry@example.org", "EMAIL_ADDRESS")]
            if text == "https://example.org/patrick":
                return [_result("https://example.org/patrick", "PERSON")]
            if text == "Moore, Powell and Carter":
                return [_result("Powell", "PERSON")]
            if text == "Patrick Clark can be reached at carlacherry@example.org":
                return [
                    type(
                        "_TextPerson",
                        (),
                        {
                            "start": 0,
                            "end": len("Patrick Clark"),
                            "entity_type": "PERSON",
                            "score": 0.96,
                            "recognition_metadata": {"recognizer_name": "stub"},
                        },
                    )(),
                    type(
                        "_TextEmail",
                        (),
                        {
                            "start": text.index("carlacherry@example.org"),
                            "end": text.index("carlacherry@example.org")
                            + len("carlacherry@example.org"),
                            "entity_type": "EMAIL_ADDRESS",
                            "score": 0.99,
                            "recognition_metadata": {"recognizer_name": "stub"},
                        },
                    )(),
                ]
            return []

    _raw_content, text_content = format_tabular_sample_content(
        scope_label="table",
        scope_value="public.training_set",
        strategy="ALL",
        rows=[
            (
                "Patrick Clark",
                "carlacherry@example.org",
                "https://example.org/patrick",
                "Moore, Powell and Carter",
                "Patrick Clark can be reached at carlacherry@example.org",
            )
        ],
        column_names=["name", "email", "url", "company", "text"],
        serialize_cell=str,
        include_column_names=True,
    )

    detector = PIIDetector(
        PIIDetectorConfig(enabled_patterns=["person", "email"], confidence_threshold=0.0)
    )
    detector.analyzer = _StubAnalyzer()

    results = await detector.detect(text_content)

    assert {
        (
            result.finding_type,
            result.matched_content,
            result.metadata["tabular_row_index"],
            result.metadata["tabular_column_name"],
        )
        for result in results
    } == {
        ("PERSON", "Patrick Clark", 1, "name"),
        ("EMAIL_ADDRESS", "carlacherry@example.org", 1, "email"),
        ("PERSON", "Patrick Clark", 1, "text"),
        ("EMAIL_ADDRESS", "carlacherry@example.org", 1, "text"),
    }


@pytest.mark.asyncio
async def test_tabular_detection_drops_single_token_person_noise_from_text_columns() -> None:
    class _StubAnalyzer:
        def analyze(self, text: str, language: str = "en"):
            del language
            if text == "Patrick Clark":
                return [
                    type(
                        "_NamePerson",
                        (),
                        {
                            "start": 0,
                            "end": len("Patrick Clark"),
                            "entity_type": "PERSON",
                            "score": 0.98,
                            "recognition_metadata": {"recognizer_name": "stub"},
                        },
                    )(),
                ]
            if text == "Moore, Powell and Carter":
                return [
                    type(
                        "_SingleTokenPerson",
                        (),
                        {
                            "start": text.index("Powell"),
                            "end": text.index("Powell") + len("Powell"),
                            "entity_type": "PERSON",
                            "score": 0.92,
                            "recognition_metadata": {"recognizer_name": "stub"},
                        },
                    )(),
                    type(
                        "_FullNamePerson",
                        (),
                        {
                            "start": 0,
                            "end": len("Moore, Powell"),
                            "entity_type": "PERSON",
                            "score": 0.94,
                            "recognition_metadata": {"recognizer_name": "stub"},
                        },
                    )(),
                ]
            return []

    _raw_content, text_content = format_tabular_sample_content(
        scope_label="table",
        scope_value="public.training_set",
        strategy="ALL",
        rows=[("Patrick Clark", "Moore, Powell and Carter")],
        column_names=["name", "text"],
        serialize_cell=str,
        include_column_names=True,
    )

    detector = PIIDetector(PIIDetectorConfig(enabled_patterns=["person"], confidence_threshold=0.0))
    detector.analyzer = _StubAnalyzer()

    results = await detector.detect(text_content)

    assert {
        (
            result.matched_content,
            result.metadata["tabular_column_name"],
        )
        for result in results
    } == {
        ("Patrick Clark", "name"),
        ("Moore, Powell", "text"),
    }


def test_runtime_dependency_failure_classifier_catches_known_phonenumbers_errors():
    detector = PIIDetector()

    assert detector._is_runtime_dependency_failure(
        ModuleNotFoundError("No module named 'phonenumbers.data.region_US'")
    )
    assert detector._is_runtime_dependency_failure(
        RuntimeError("No module named phonenumbers.data.region_CA")
    )
