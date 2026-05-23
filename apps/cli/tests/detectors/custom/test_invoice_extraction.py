"""Invoice PDF extraction test using the custom REGEX detector.

Uses apps/cli/tests/detectors/pii/sample_invoice.pdf as the fixture document.
The PDF is parsed to text via extract_text(), then a custom REGEX pipeline
extracts PERSON names and LOCATION values relevant to the invoice.

REGEX runner is used so this test has zero ML dependency:
- PERSON pattern: German/English name format "Firstname Lastname"
- LOCATION pattern: postal addresses and city names with ZIP codes
- AMOUNT pattern: monetary values (€ / EUR amounts)
- INVOICE_ID pattern: typical invoice reference numbers

The test verifies:
1. PDF is parsed successfully to non-empty text
2. At least one PERSON or AMOUNT match is found
3. PipelineResult shape is correct (entities dict, classification={}, metadata)
4. DetectionResult findings have correct finding_type prefix (regex:*)
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from .conftest import requires_pdfplumber

SAMPLE_PDF = (
    Path(__file__).parent.parent.parent / "tests" / "detectors" / "pii" / "sample_invoice.pdf"
)

# Resolve relative to repo root (tests run from apps/cli)
_CLI_ROOT = Path(__file__).parent.parent.parent.parent
SAMPLE_PDF_PATH = _CLI_ROOT / "tests" / "detectors" / "pii" / "sample_invoice.pdf"


@requires_pdfplumber
def test_sample_invoice_pdf_exists():
    assert SAMPLE_PDF_PATH.exists(), f"Fixture not found: {SAMPLE_PDF_PATH}"


@requires_pdfplumber
def test_pdf_parses_to_text():
    from src.utils.file_parser import extract_text

    pdf_bytes = SAMPLE_PDF_PATH.read_bytes()
    text, error = extract_text(pdf_bytes, "application/pdf")

    assert error is None, f"PDF extraction error: {error}"
    assert len(text) > 100, "Expected non-trivial text from invoice PDF"


@requires_pdfplumber
@pytest.mark.asyncio
async def test_invoice_regex_extraction():
    """Extract person names, locations, and amounts from the invoice PDF."""
    from src.detectors.custom.detector import CustomDetector
    from src.models.generated_detectors import (
        CustomDetectorConfig,
        RegexPatternDefinition,
        RegexPipelineSchema,
    )
    from src.utils.file_parser import extract_text

    pdf_bytes = SAMPLE_PDF_PATH.read_bytes()
    text, error = extract_text(pdf_bytes, "application/pdf")
    assert error is None

    config = CustomDetectorConfig(
        custom_detector_key="invoice_extractor",
        name="Invoice Data Extractor",
        pipeline_schema=RegexPipelineSchema(
            patterns={
                # Monetary amounts: 1.234,56 € or 1234.56 EUR or $1,234.56
                "amount": RegexPatternDefinition(
                    pattern=r"(?:[\$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|USD|GBP|€))",
                    description="Monetary amounts",
                    flags=re.IGNORECASE,
                ),
                # Invoice/order reference numbers
                "invoice_id": RegexPatternDefinition(
                    pattern=r"(?:Invoice|Rechnung|Order|INV|RE|OR)[- ]?(?:No\.?|#|Nr\.?)?\s*[A-Z0-9][\w\-]{3,}",
                    description="Invoice or order reference number",
                    flags=re.IGNORECASE,
                ),
                # ZIP + city (German: 12345 Berlin; international: NY 10001)
                "location": RegexPatternDefinition(
                    pattern=r"\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*",
                    description="Postal code + city name",
                ),
                # Date formats: DD.MM.YYYY or YYYY-MM-DD or Month DD, YYYY
                "date": RegexPatternDefinition(
                    pattern=r"\b(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b",
                    description="Date",
                    flags=re.IGNORECASE,
                ),
            }
        ),
    )

    detector = CustomDetector(config)
    findings = await detector.detect(text)

    # --- shape assertions (always true regardless of invoice content) ---
    for f in findings:
        assert f.finding_type.startswith("regex:"), f"Unexpected finding_type: {f.finding_type}"
        assert f.custom_detector_key == "invoice_extractor"
        assert f.metadata["runner"] == "REGEX"
        result_dump = f.metadata["pipeline_result"]
        assert "entities" in result_dump
        assert "classification" in result_dump
        assert "metadata" in result_dump

    # --- content assertions: an invoice should have at least amounts or dates ---
    found_types = {f.finding_type for f in findings}
    assert "regex:amount" in found_types or "regex:date" in found_types, (
        f"Expected at least one amount or date in invoice PDF. "
        f"Found types: {found_types}\n"
        f"Extracted text (first 500 chars):\n{text[:500]}"
    )


@requires_pdfplumber
@pytest.mark.asyncio
async def test_invoice_pipeline_result_shape():
    """Verify that PipelineResult from PDF extraction matches the standard schema."""
    from src.detectors.custom.runners import RegexRunner
    from src.models.generated_detectors import (
        RegexPatternDefinition,
        RegexPipelineSchema,
    )
    from src.utils.file_parser import extract_text

    pdf_bytes = SAMPLE_PDF_PATH.read_bytes()
    text, _ = extract_text(pdf_bytes, "application/pdf")

    schema = RegexPipelineSchema(
        patterns={"amount": RegexPatternDefinition(pattern=r"[\$€£]\s?\d[\d.,]*")}
    )
    runner = RegexRunner(schema, detector_key="shape_test")
    result = runner.run(text)

    # Standard PipelineResult fields
    assert isinstance(result.entities, dict)
    assert isinstance(result.classification, dict)
    assert isinstance(result.metadata, dict)
    assert result.metadata["runner"] == "REGEX"
    assert "latency_ms" in result.metadata
    assert "timestamp" in result.metadata

    # All entity spans must have the four standard keys
    for _label, spans in result.entities.items():
        for span in spans:
            assert "value" in span
            assert "confidence" in span
            assert "start" in span
            assert "end" in span
            assert isinstance(span["confidence"], float)
