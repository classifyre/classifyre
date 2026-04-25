"""Tests for PII detector."""

from pathlib import Path

import pytest

from src.detectors.pii.detector import PIIDetector
from src.models.generated_detectors import DetectorConfig, PIIDetectorConfig, Severity
from src.sources.tabular_utils import format_tabular_sample_content
from src.utils.file_parser import parse_bytes

from .conftest import requires_pdfplumber, requires_presidio

_FIXTURES_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
# Integration tests — require a working Presidio installation
# ---------------------------------------------------------------------------


@requires_presidio
@pytest.mark.asyncio
async def test_pii_detector_initialization():
    detector = PIIDetector()
    assert detector.detector_type == "pii"
    assert detector.detector_name == "pii"
    assert detector.config is not None
    assert detector.analyzer is not None


@requires_presidio
@pytest.mark.asyncio
async def test_pii_detector_initialization_with_config():
    config = DetectorConfig(confidence_threshold=0.9)
    detector = PIIDetector(config)
    assert detector.config.confidence_threshold == 0.9


@requires_presidio
@pytest.mark.asyncio
async def test_detect_ssn(sample_ssn):
    detector = PIIDetector()
    results = await detector.detect(sample_ssn)

    assert len(results) >= 1, (
        f"Should detect something in SSN content, got: {[r.finding_type for r in results]}"
    )
    assert results[0].location is not None
    assert "078-05-1120" in sample_ssn


@requires_presidio
@pytest.mark.asyncio
async def test_detect_credit_card(sample_credit_card):
    detector = PIIDetector()
    results = await detector.detect(sample_credit_card)

    assert len(results) >= 1, (
        f"Should detect something in credit card content, got: {[r.finding_type for r in results]}"
    )
    assert "4532123456789010" in sample_credit_card


@requires_presidio
@pytest.mark.asyncio
async def test_detect_email(sample_email):
    detector = PIIDetector()
    results = await detector.detect(sample_email)

    email_findings = [r for r in results if "EMAIL" in r.finding_type.upper()]
    assert len(email_findings) >= 1, (
        f"Should detect email, got: {[r.finding_type for r in results]}"
    )
    assert any("john.doe@example.com" in f.matched_content for f in email_findings)


@requires_presidio
@pytest.mark.asyncio
async def test_detect_phone(sample_phone):
    detector = PIIDetector()
    results = await detector.detect(sample_phone)

    assert "212-555-1234" in sample_phone
    if results:
        for finding in results:
            assert finding.location is not None
            assert finding.confidence > 0


@requires_presidio
@pytest.mark.asyncio
async def test_detect_person_names(sample_person_name):
    detector = PIIDetector()
    results = await detector.detect(sample_person_name)

    name_findings = [
        r for r in results if "PERSON" in r.finding_type.upper() or "NAME" in r.finding_type.upper()
    ]
    if name_findings:
        for finding in name_findings:
            assert finding.severity in [Severity.low, Severity.medium, Severity.high]


@requires_presidio
@pytest.mark.asyncio
async def test_detect_mixed_pii(sample_mixed_pii):
    detector = PIIDetector()
    results = await detector.detect(sample_mixed_pii)

    assert len(results) >= 3, f"Should detect multiple PII items, got {len(results)}"

    finding_types = [r.finding_type.upper() for r in results]
    has_contact = any("EMAIL" in t or "PHONE" in t for t in finding_types)
    assert has_contact, "Should detect at least email or phone"


@requires_presidio
@pytest.mark.asyncio
async def test_no_false_positives_clean_content(sample_clean_content):
    detector = PIIDetector()
    results = await detector.detect(sample_clean_content)
    assert len(results) <= 2, f"Too many false positives: {[r.finding_type for r in results]}"


@requires_presidio
@pytest.mark.asyncio
async def test_confidence_threshold_filtering():
    config = DetectorConfig(confidence_threshold=0.95)
    detector = PIIDetector(config)

    content = "Call me at 123-456-7890"
    results = await detector.detect(content)

    for result in results:
        assert result.confidence >= 0.95


@requires_presidio
@pytest.mark.asyncio
async def test_redaction():
    content = "My email is john@example.com and phone is 555-1234"
    detector = PIIDetector()
    results = await detector.detect(content)

    if results:
        redacted = detector.redact(content, results)
        assert "john@example.com" not in redacted or "*" in redacted


@requires_presidio
@pytest.mark.asyncio
async def test_location_tracking():
    content = "Name: Alice\nEmail: alice@test.com\nPhone: 555-0000"
    detector = PIIDetector()
    results = await detector.detect(content)

    if results:
        assert any(r.location is not None for r in results)


@requires_presidio
@pytest.mark.asyncio
async def test_max_findings_limit():
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
    assert len(results) <= 2


@requires_presidio
@pytest.mark.asyncio
async def test_category_is_pii():
    detector = PIIDetector()
    content = "Email: test@example.com and SSN: 123-45-6789"
    results = await detector.detect(content)

    for result in results:
        assert result.category == "PII"


# ---------------------------------------------------------------------------
# Unit tests — use stub analyzers, no real Presidio needed
# ---------------------------------------------------------------------------


def _make_result(entity_type: str, start: int, end: int, score: float = 0.95):
    return type(
        "_StubResult",
        (),
        {
            "start": start,
            "end": end,
            "entity_type": entity_type,
            "score": score,
            "recognition_metadata": {"recognizer_name": "stub"},
        },
    )()


class _SimpleStubAnalyzer:
    def __init__(self, results: list):
        self._results = results

    def analyze(self, text: str, language: str = "en", entities: list | None = None):
        if entities is not None:
            return [r for r in self._results if r.entity_type in entities]
        return self._results

    def get_supported_entities(self) -> list[str]:
        return list({r.entity_type for r in self._results})


@pytest.mark.asyncio
async def test_supported_content_types():
    detector = PIIDetector()
    content_types = detector.get_supported_content_types()
    assert "text/plain" in content_types
    assert isinstance(content_types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    detector = PIIDetector()
    metadata = detector.get_metadata()

    assert metadata["detector_type"] == "pii"
    assert metadata["detector_name"] == "pii"
    assert "content_types" in metadata
    assert metadata["requires_gpu"] is False


@pytest.mark.asyncio
async def test_enabled_patterns_filters_out_unconfigured_entities():
    stub_results = [
        _make_result("EMAIL_ADDRESS", 0, 16, 0.99),
        _make_result("PERSON", 0, 12, 0.91),
        _make_result("DATE_TIME", 0, 10, 0.91),
    ]

    detector = PIIDetector(
        PIIDetectorConfig(enabled_patterns=["EMAIL_ADDRESS"], confidence_threshold=0.0)
    )
    detector.analyzer = _SimpleStubAnalyzer(stub_results)

    results = await detector.detect("name@example.com John Smith 2024-01-01")
    assert [result.finding_type for result in results] == ["EMAIL_ADDRESS"]


@pytest.mark.asyncio
async def test_enabled_patterns_none_runs_all_entities():
    """When enabled_patterns is None, entities=None is passed to Presidio (all entities)."""
    analyzed_entities: list[list[str] | None] = []

    class _CapturingAnalyzer:
        def analyze(self, text: str, language: str = "en", entities: list | None = None):
            analyzed_entities.append(entities)
            return []

        def get_supported_entities(self) -> list[str]:
            return ["EMAIL_ADDRESS", "US_SSN"]

    detector = PIIDetector(PIIDetectorConfig(enabled_patterns=None, confidence_threshold=0.0))
    detector.analyzer = _CapturingAnalyzer()

    await detector.detect("some text")

    assert analyzed_entities[0] is None


@pytest.mark.asyncio
async def test_enabled_patterns_passed_as_entity_list():
    """Enabled patterns are forwarded as sorted entity list to Presidio."""
    analyzed_entities: list[list[str] | None] = []

    class _CapturingAnalyzer:
        def analyze(self, text: str, language: str = "en", entities: list | None = None):
            analyzed_entities.append(entities)
            return []

        def get_supported_entities(self) -> list[str]:
            return ["EMAIL_ADDRESS", "US_SSN"]

    detector = PIIDetector(
        PIIDetectorConfig(enabled_patterns=["EMAIL_ADDRESS", "US_SSN"], confidence_threshold=0.0)
    )
    detector.analyzer = _CapturingAnalyzer()

    await detector.detect("some text")

    assert analyzed_entities[0] is not None
    assert set(analyzed_entities[0]) == {"EMAIL_ADDRESS", "US_SSN"}


@pytest.mark.asyncio
async def test_tabular_detection_scans_per_cell_and_filters_entities_by_column() -> None:
    class _StubAnalyzer:
        def analyze(self, text: str, language: str = "en", entities: list | None = None):
            del language
            if text == "Patrick Clark":
                return [_make_result("PERSON", 0, len("Patrick Clark"))]
            if text == "carlacherry@example.org":
                return [_make_result("EMAIL_ADDRESS", 0, len("carlacherry@example.org"))]
            if text == "https://example.org/patrick":
                return [_make_result("PERSON", 0, len("https://example.org/patrick"))]
            if text == "Moore, Powell and Carter":
                idx = text.index("Powell")
                return [_make_result("PERSON", idx, idx + len("Powell"))]
            if text == "Patrick Clark can be reached at carlacherry@example.org":
                email_start = text.index("carlacherry@example.org")
                return [
                    _make_result("PERSON", 0, len("Patrick Clark"), 0.96),
                    _make_result(
                        "EMAIL_ADDRESS",
                        email_start,
                        email_start + len("carlacherry@example.org"),
                        0.99,
                    ),
                ]
            return []

        def get_supported_entities(self) -> list[str]:
            return ["PERSON", "EMAIL_ADDRESS"]

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
        PIIDetectorConfig(enabled_patterns=["PERSON", "EMAIL_ADDRESS"], confidence_threshold=0.0)
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
        def analyze(self, text: str, language: str = "en", entities: list | None = None):
            del language, entities
            if text == "Patrick Clark":
                return [_make_result("PERSON", 0, len("Patrick Clark"), 0.98)]
            if text == "Moore, Powell and Carter":
                powell_idx = text.index("Powell")
                return [
                    _make_result("PERSON", powell_idx, powell_idx + len("Powell"), 0.92),
                    _make_result("PERSON", 0, len("Moore, Powell"), 0.94),
                ]
            return []

        def get_supported_entities(self) -> list[str]:
            return ["PERSON"]

    _raw_content, text_content = format_tabular_sample_content(
        scope_label="table",
        scope_value="public.training_set",
        strategy="ALL",
        rows=[("Patrick Clark", "Moore, Powell and Carter")],
        column_names=["name", "text"],
        serialize_cell=str,
        include_column_names=True,
    )

    detector = PIIDetector(PIIDetectorConfig(enabled_patterns=["PERSON"], confidence_threshold=0.0))
    detector.analyzer = _StubAnalyzer()

    results = await detector.detect(text_content)

    assert {
        (result.matched_content, result.metadata["tabular_column_name"]) for result in results
    } == {
        ("Patrick Clark", "name"),
        ("Moore, Powell", "text"),
    }


@pytest.mark.asyncio
async def test_custom_recognizer_config_is_parsed() -> None:
    """PIICustomRecognizer config is accepted by Pydantic without error."""
    from src.models.generated_detectors import PIICustomRecognizer, PIIRecognizerPattern

    # enabled_patterns contains only valid PIIEnabledPattern values; the custom recognizer
    # fires for its own entity type (EMPLOYEE_ID) regardless of this list.
    config = PIIDetectorConfig(
        enabled_patterns=["EMAIL_ADDRESS"],
        confidence_threshold=0.0,
        custom_recognizers=[
            PIICustomRecognizer(
                name="Employee ID Recognizer",
                supported_entity="EMPLOYEE_ID",
                supported_language="en",
                patterns=[
                    PIIRecognizerPattern(
                        name="employee id (strong)",
                        regex=r"\bEMP-\d{6}\b",
                        score=0.9,
                    )
                ],
                context=["employee", "id"],
            )
        ],
    )
    assert config.custom_recognizers is not None
    assert len(config.custom_recognizers) == 1
    assert config.custom_recognizers[0].supported_entity == "EMPLOYEE_ID"
    patterns = config.custom_recognizers[0].patterns.root
    assert patterns[0].regex == r"\bEMP-\d{6}\b"


@pytest.mark.asyncio
async def test_custom_deny_list_recognizer_config_is_parsed() -> None:
    """Deny-list recognizer config is accepted without error."""
    from src.models.generated_detectors import PIICustomRecognizer

    config = PIIDetectorConfig(
        confidence_threshold=0.7,
        custom_recognizers=[
            PIICustomRecognizer(
                name="Internal Project Recognizer",
                supported_entity="INTERNAL_PROJECT",
                deny_list=["Project Phoenix", "Operation Sunrise"],
                context=["project", "codename"],
            )
        ],
    )
    rec = config.custom_recognizers[0]  # type: ignore[index]
    deny_list = rec.deny_list.root
    assert "Project Phoenix" in deny_list
    assert "Operation Sunrise" in deny_list
    assert rec.patterns is None


# ---------------------------------------------------------------------------
# PDF parsing + PII detection integration
# ---------------------------------------------------------------------------


@requires_pdfplumber
def test_pdf_parse_extracts_text() -> None:
    """file_parser.parse_bytes must extract non-empty text from a real PDF invoice."""
    pdf_bytes = (_FIXTURES_DIR / "sample_invoice.pdf").read_bytes()
    result = parse_bytes(pdf_bytes, file_name="sample_invoice.pdf")

    assert result.mime_type == "application/pdf"
    assert result.text_content, "Expected non-empty text from PDF"
    # The invoice contains a known person name and location
    assert "Natalie Webber" in result.text_content
    assert "Abidjan" in result.text_content


@requires_pdfplumber
@requires_presidio
@pytest.mark.asyncio
async def test_pii_detector_on_pdf_content() -> None:
    """PII detector must find PERSON and LOCATION in text extracted from a PDF invoice."""
    pdf_bytes = (_FIXTURES_DIR / "sample_invoice.pdf").read_bytes()
    parsed = parse_bytes(pdf_bytes, file_name="sample_invoice.pdf")

    assert parsed.text_content, "PDF text extraction prerequisite failed"

    detector = PIIDetector()
    results = await detector.detect(parsed.text_content)

    finding_types = {r.finding_type for r in results}
    assert "PERSON" in finding_types, f"Expected PERSON finding in invoice, got: {finding_types}"
    assert "LOCATION" in finding_types, (
        f"Expected LOCATION finding in invoice, got: {finding_types}"
    )

    person_findings = [r for r in results if r.finding_type == "PERSON"]
    assert any(
        "Natalie" in r.matched_content or "Webber" in r.matched_content for r in person_findings
    ), (
        f"Expected 'Natalie Webber' in PERSON findings, got: {[r.matched_content for r in person_findings]}"
    )
