"""Unit tests for src/utils/file_parser.py."""

from __future__ import annotations

import pytest

from src.utils.file_parser import (
    ParsedFile,
    detect_mime_type,
    extract_text,
    parse_bytes,
    parse_file,
)

# ---------------------------------------------------------------------------
# detect_mime_type
# ---------------------------------------------------------------------------


class TestDetectMimeType:
    def test_png_magic_bytes(self) -> None:
        png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        assert detect_mime_type(png_bytes) == "image/png"

    def test_pdf_magic_bytes(self) -> None:
        pdf_bytes = b"%PDF-1.4 " + b"\x00" * 50
        assert detect_mime_type(pdf_bytes) == "application/pdf"

    def test_json_sniff(self) -> None:
        assert detect_mime_type(b'{"key": "value"}') == "application/json"

    def test_json_array_sniff(self) -> None:
        assert detect_mime_type(b"[1, 2, 3]") == "application/json"

    def test_html_sniff(self) -> None:
        assert detect_mime_type(b"<html><body>hi</body></html>") == "text/html"

    def test_html_doctype_sniff(self) -> None:
        assert detect_mime_type(b"<!DOCTYPE html><html></html>") == "text/html"

    def test_xml_sniff(self) -> None:
        assert detect_mime_type(b"<?xml version='1.0'?><root/>") == "application/xml"

    def test_plain_text(self) -> None:
        result = detect_mime_type(b"hello world, this is plain text")
        assert result == "text/plain"

    def test_binary_fallback(self) -> None:
        result = detect_mime_type(b"\x00\x01\x02\x03binary")
        assert result == "application/octet-stream"

    def test_empty_bytes(self) -> None:
        result = detect_mime_type(b"")
        assert result == "application/octet-stream"


# ---------------------------------------------------------------------------
# extract_text
# ---------------------------------------------------------------------------


class TestExtractText:
    def test_plain_text(self) -> None:
        text, err = extract_text(b"hello world", "text/plain")
        assert "hello world" in text
        assert err is None

    def test_html_tags_stripped(self) -> None:
        html = b"<html><body><p>Hello <b>world</b></p></body></html>"
        text, err = extract_text(html, "text/html")
        assert "Hello" in text
        assert "world" in text
        assert "<" not in text
        assert err is None

    def test_json_passthrough(self) -> None:
        data = b'{"key": "value"}'
        text, err = extract_text(data, "application/json")
        assert "key" in text
        assert err is None

    def test_xml_passthrough(self) -> None:
        data = b"<?xml version='1.0'?><root><item>hello</item></root>"
        text, err = extract_text(data, "application/xml")
        assert "hello" in text
        assert err is None

    def test_csv_passthrough(self) -> None:
        data = b"name,age,city\nAlice,30,NYC"
        text, err = extract_text(data, "text/csv")
        assert "Alice" in text
        assert err is None

    def test_image_returns_empty(self) -> None:
        text, err = extract_text(b"\x89PNG\r\n\x1a\n", "image/png")
        assert text == ""
        assert err is None

    def test_audio_returns_empty(self) -> None:
        text, err = extract_text(b"\xff\xfbID3", "audio/mpeg")
        assert text == ""
        assert err is None

    def test_octet_stream_returns_empty(self) -> None:
        text, err = extract_text(b"\x00\x01\x02\x03", "application/octet-stream")
        assert text == ""
        assert err is None

    def test_pdf_extraction(self, tmp_path: pytest.TempPathFactory) -> None:
        pytest.importorskip("pdfplumber")
        # Create a minimal valid PDF (1-page with text using reportlab if available,
        # otherwise skip actual content test)
        pytest.importorskip("reportlab")
        import io

        from reportlab.pdfgen import canvas as rl_canvas

        buf = io.BytesIO()
        c = rl_canvas.Canvas(buf)
        c.drawString(100, 750, "Hello PDF")
        c.save()
        pdf_bytes = buf.getvalue()

        text, err = extract_text(pdf_bytes, "application/pdf")
        assert "Hello" in text
        assert err is None

    def test_xlsx_extraction(self) -> None:
        openpyxl = pytest.importorskip("openpyxl")
        import io

        wb = openpyxl.Workbook()
        ws = wb.active
        ws["A1"] = "Hello"  # type: ignore[index]
        ws["B1"] = "XLSX"  # type: ignore[index]
        buf = io.BytesIO()
        wb.save(buf)
        xlsx_bytes = buf.getvalue()

        text, err = extract_text(
            xlsx_bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        assert "Hello" in text
        assert err is None

    def test_docx_extraction(self) -> None:
        docx = pytest.importorskip("docx")
        import io

        doc = docx.Document()
        doc.add_paragraph("Hello DOCX")
        buf = io.BytesIO()
        doc.save(buf)
        docx_bytes = buf.getvalue()

        text, err = extract_text(
            docx_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        assert "Hello DOCX" in text
        assert err is None


# ---------------------------------------------------------------------------
# parse_file
# ---------------------------------------------------------------------------


class TestParseFile:
    def test_txt_file(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "sample.txt"  # type: ignore[operator]
        p.write_text("hello from a text file")  # type: ignore[union-attr]

        result = parse_file(p)  # type: ignore[arg-type]
        assert isinstance(result, ParsedFile)
        assert "hello" in result.text_content
        assert result.is_binary is False
        assert result.file_size_bytes > 0

    def test_json_file(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "data.json"  # type: ignore[operator]
        p.write_text('{"key": "value"}')  # type: ignore[union-attr]

        result = parse_file(p)  # type: ignore[arg-type]
        assert result.mime_type == "application/json"
        assert "key" in result.text_content
        assert result.is_binary is False

    def test_image_is_binary(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "img.png"  # type: ignore[operator]
        # Minimal PNG header
        p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)  # type: ignore[union-attr]

        result = parse_file(p)  # type: ignore[arg-type]
        assert result.is_binary is True
        assert result.text_content == ""

    def test_file_not_found(self, tmp_path: pytest.TempPathFactory) -> None:
        p = tmp_path / "nonexistent.txt"  # type: ignore[operator]
        with pytest.raises(FileNotFoundError):
            parse_file(p)  # type: ignore[arg-type]


class TestParseBytes:
    def test_declared_plain_text_upgrades_to_csv_from_filename(self) -> None:
        parsed = parse_bytes(
            b"name,age\nAlice,30\n",
            declared_mime_type="text/plain",
            file_name="customers.csv",
        )
        assert parsed.mime_type == "text/csv"
        assert "Alice" in parsed.text_content
        assert "Alice" in parsed.raw_content

    def test_octet_stream_uses_filename_hint(self) -> None:
        parsed = parse_bytes(
            b"%PDF-1.4",
            declared_mime_type="application/octet-stream",
            file_name="invoice.pdf",
        )
        assert parsed.mime_type == "application/pdf"
