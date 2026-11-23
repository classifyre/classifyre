"""Tests for PII detector."""

from pathlib import Path

import pytest

from src.detectors.pii.detector import PIIDetector
from src.models.generated_detectors import PIIDetectorConfig, Severity
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
    config = PIIDetectorConfig(confidence_threshold=0.9)
    detector = PIIDetector(config)
    assert detector._cfg.confidence_threshold == 0.9


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
    config = PIIDetectorConfig(confidence_threshold=0.95)
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
    config = PIIDetectorConfig(max_findings=2)
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
    stub = _SubstringAnalyzer(
        {
            "Patrick Clark": "PERSON",
            "carlacherry@example.org": "EMAIL_ADDRESS",
            "https://example.org/patrick": "PERSON",
            "Powell": "PERSON",
        }
    )

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
    detector.analyzer = stub

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
    stub = _SubstringAnalyzer(
        {"Patrick Clark": "PERSON", "Powell": "PERSON", "Moore, Powell": "PERSON"}
    )

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
    detector.analyzer = stub

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


async def test_contact_column_keeps_emails() -> None:
    """A "contact" column is not a name column: it holds how to reach someone.

    Treated as one, an e-mail address in it was dropped as "not a PERSON".
    """
    detector = PIIDetector()
    page = "row_1:\n  contact: pip.marlow@example.com\n\nrow_2:\n  contact: Zephyr Quill\n"
    results = await detector.detect(page)
    found = {(r.finding_type, r.matched_content) for r in results}
    assert ("EMAIL_ADDRESS", "pip.marlow@example.com") in found
    assert ("PERSON", "Zephyr Quill") in found


# ---------------------------------------------------------------------------
# Tabular pages of realistic size: every finding keeps its row and column
# ---------------------------------------------------------------------------


class _SubstringAnalyzer:
    """Finds each known value wherever it occurs in the text it is given."""

    def __init__(self, values: dict[str, str]) -> None:
        self.values = values
        self.calls = 0

    def analyze(self, text: str, language: str = "en", entities: list | None = None):
        del language
        self.calls += 1
        out = []
        for value, entity in self.values.items():
            if entities is not None and entity not in entities:
                continue
            start = text.find(value)
            while start != -1:
                out.append(_make_result(entity, start, start + len(value)))
                start = text.find(value, start + 1)
        return out

    def get_supported_entities(self) -> list[str]:
        return sorted(set(self.values.values()))


def _page(rows: list[tuple[str, ...]], columns: list[str], row_offset: int = 0) -> str:
    return format_tabular_sample_content(
        scope_label="table",
        scope_value="crm.contacts",
        strategy="ALL",
        rows=rows,
        column_names=columns,
        serialize_cell=str,
        include_column_names=True,
        row_offset=row_offset,
    )[1]


@pytest.mark.asyncio
async def test_tabular_page_over_the_cell_limit_keeps_columns() -> None:
    """A 100-row page of a 13-column table used to fall back to full-text
    analysis, losing every finding's column, so no column was classified and
    nothing was masked by default (DQ §5.8)."""
    columns = ["contact_id", "first_name", "email", "phone", *[f"extra_{i}" for i in range(9)]]
    rows = [
        (str(1000 + i), f"Person{i}", f"p{i}@example.com", f"+43 664 {1000000 + i}", *["x"] * 9)
        for i in range(100)
    ]
    assert len(rows) * len(columns) > 200  # the old per-cell limit
    analyzer = _SubstringAnalyzer(
        {"p7@example.com": "EMAIL_ADDRESS", "+43 664 1000042": "PHONE_NUMBER"}
    )
    detector = PIIDetector(PIIDetectorConfig(confidence_threshold=0.0))
    detector.analyzer = analyzer

    results = await detector.detect(_page(rows, columns))

    assert {
        (
            r.finding_type,
            r.matched_content,
            r.metadata["tabular_row_index"],
            r.metadata["tabular_column_name"],
        )
        for r in results
    } == {
        ("EMAIL_ADDRESS", "p7@example.com", 8, "email"),
        ("PHONE_NUMBER", "+43 664 1000042", 43, "phone"),
    }
    # One analysis per column that may hold PII, not one per cell.
    assert analyzer.calls <= len(columns)


@pytest.mark.asyncio
async def test_tabular_sweep_page_that_does_not_start_at_row_1_keeps_columns() -> None:
    """The second page of a sweep starts at row_101; it is still a table."""
    analyzer = _SubstringAnalyzer({"late@example.com": "EMAIL_ADDRESS"})
    detector = PIIDetector(PIIDetectorConfig(confidence_threshold=0.0))
    detector.analyzer = analyzer

    page = _page([("1101", "late@example.com")], ["contact_id", "email"], row_offset=100)
    results = await detector.detect(page)

    assert [
        (r.metadata["tabular_row_index"], r.metadata["tabular_column_name"]) for r in results
    ] == [(101, "email")]


@pytest.mark.asyncio
async def test_tabular_match_reaching_into_the_column_label_is_cut_to_the_value() -> None:
    """The label written before each value is context, never part of a finding."""

    class _Greedy(_SubstringAnalyzer):
        def analyze(self, text: str, language: str = "en", entities: list | None = None):
            start = text.find("name: Ada Ferrow")
            return (
                [_make_result("PERSON", start, start + len("name: Ada Ferrow"))]
                if start >= 0
                else []
            )

    detector = PIIDetector(PIIDetectorConfig(confidence_threshold=0.0))
    detector.analyzer = _Greedy({"Ada Ferrow": "PERSON"})

    results = await detector.detect(_page([("Ada Ferrow",)], ["name"]))

    assert [(r.matched_content, r.metadata["tabular_column_name"]) for r in results] == [
        ("Ada Ferrow", "name")
    ]


@requires_presidio
@pytest.mark.asyncio
async def test_tabular_phone_and_iban_columns_are_found_with_their_column() -> None:
    """Context-dependent recognisers (phone numbers score 0.4 alone) need the
    column's name beside the value, as full-text analysis had; analysed cell by
    cell, a phone column of a small table classified nothing."""
    rows = [
        ("1001", "Margarethe", "+43 664 2718281", "AT48 3200 0000 1234 5864"),
        ("1002", "Florian", "+49 151 38504945", "DE89 3704 0044 0532 0130 00"),
        ("1003", "Sigrid", "+46 70 123 45 67", "SE45 5000 0000 0583 9825 7466"),
    ]
    detector = PIIDetector()
    results = await detector.detect(_page(rows, ["contact_id", "first_name", "phone", "iban"]))

    by_column = {(r.finding_type, r.metadata.get("tabular_column_name")) for r in results}
    assert ("PHONE_NUMBER", "phone") in by_column
    assert ("IBAN_CODE", "iban") in by_column
    assert all(r.metadata.get("tabular_column_name") for r in results)


def test_camel_case_column_names_get_the_same_hints_as_snake_case() -> None:
    """Salesforce and HubSpot exports name columns FirstName, MobilePhone,
    Email__c. Read as one word, they got no hint: no PERSON in FirstName, and
    every recogniser on MobilePhone (PESEL, VAT and card "findings" in phone
    numbers made the column sensitive)."""
    detector = PIIDetector()
    for camel, snake in [
        ("FirstName", "first_name"),
        ("MobilePhone", "mobile_phone"),
        ("Email__c", "email__c"),
        ("MailingStreet", "mailing_street"),
        ("HTTPReferrerURL", "http_referrer_url"),
    ]:
        assert detector._allowed_entities_for_column(
            camel
        ) == detector._allowed_entities_for_column(snake), camel
    assert detector._allowed_entities_for_column("MobilePhone") == {"PHONE_NUMBER"}
    assert "PERSON" in detector._allowed_entities_for_column("LastName")
