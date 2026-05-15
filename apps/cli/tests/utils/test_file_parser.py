"""Unit tests for src/utils/file_parser.py."""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any

import pytest

from src.utils.file_parser import (
    ParsedFile,
    _get_docling_converter,
    _reset_docling_singleton,
    _supports_docling_ocr,
    detect_mime_type,
    extract_text,
    iter_file_pages,
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

    def test_image_ocr_uses_docling_when_enabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("Detected from OCR", None),
        )

        text, err = extract_text(
            b"\x89PNG\r\n\x1a\nfake-image",
            "image/png",
            file_name="receipt.png",
            enable_ocr=True,
        )

        assert text == "Detected from OCR"
        assert err is None

    def test_image_ocr_is_disabled_by_default(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def fail_if_called(*_args, **_kwargs):
            raise AssertionError("Docling OCR should not run when OCR is disabled")

        monkeypatch.setattr("src.utils.file_parser._extract_docling_markdown", fail_if_called)

        text, err = extract_text(
            b"\x89PNG\r\n\x1a\nfake-image",
            "image/png",
            file_name="receipt.png",
            enable_ocr=False,
        )

        assert text == ""
        assert err is None

    def test_plain_text_does_not_use_ocr_even_when_enabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """text/plain has a fast extraction path; Docling must not be called for it."""

        def fail_if_called(*_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("Docling OCR must not run for plain-text content")

        monkeypatch.setattr("src.utils.file_parser._extract_docling_markdown", fail_if_called)

        text, err = extract_text(
            b"hello plain text",
            "text/plain",
            file_name="notes.txt",
            enable_ocr=True,
        )

        assert "hello plain text" in text
        assert err is None

    def test_markdown_does_not_use_ocr_even_when_enabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """text/markdown has a fast extraction path; Docling must not be called for it."""

        def fail_if_called(*_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("Docling OCR must not run for markdown content")

        monkeypatch.setattr("src.utils.file_parser._extract_docling_markdown", fail_if_called)

        text, err = extract_text(
            b"# Heading\nsome content",
            "text/markdown",
            file_name="readme.md",
            enable_ocr=True,
        )

        assert "Heading" in text
        assert err is None


# ---------------------------------------------------------------------------
# _supports_docling_ocr
# ---------------------------------------------------------------------------


class TestSupportsDoclingOcr:
    def test_image_mime_is_supported(self) -> None:
        assert _supports_docling_ocr("image/png", "") is True
        assert _supports_docling_ocr("image/jpeg", "") is True
        assert _supports_docling_ocr("image/tiff", "") is True

    def test_pdf_mime_is_supported(self) -> None:
        assert _supports_docling_ocr("application/pdf", "") is True

    def test_docx_mime_is_supported(self) -> None:
        assert (
            _supports_docling_ocr(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ""
            )
            is True
        )

    def test_plain_text_is_not_supported(self) -> None:
        assert _supports_docling_ocr("text/plain", "file.txt") is False

    def test_markdown_is_not_supported(self) -> None:
        assert _supports_docling_ocr("text/markdown", "readme.md") is False

    def test_txt_extension_is_not_supported(self) -> None:
        assert _supports_docling_ocr("application/octet-stream", "notes.txt") is False

    def test_md_extension_is_not_supported(self) -> None:
        assert _supports_docling_ocr("application/octet-stream", "doc.md") is False

    def test_png_extension_is_supported(self) -> None:
        assert _supports_docling_ocr("application/octet-stream", "photo.png") is True


# ---------------------------------------------------------------------------
# _get_docling_converter singleton
# ---------------------------------------------------------------------------


class TestDoclingConverterSingleton:
    @pytest.fixture(autouse=True)
    def reset_singleton(self) -> None:
        _reset_docling_singleton()
        yield
        _reset_docling_singleton()

    def _install_fake_docling(self, monkeypatch: pytest.MonkeyPatch, init_count: list[int]) -> None:
        """Inject a fake docling.document_converter into sys.modules."""

        class FakeDocument:
            @staticmethod
            def export_to_markdown() -> str:
                return "ocr output"

        class FakeResult:
            document = FakeDocument()

        class FakeConverter:
            def convert(self, _path: Any) -> FakeResult:
                return FakeResult()

        def make_converter() -> FakeConverter:
            init_count.append(1)
            return FakeConverter()

        fake_module = ModuleType("docling.document_converter")
        fake_module.DocumentConverter = make_converter  # type: ignore[attr-defined]

        parent_module = ModuleType("docling")
        monkeypatch.setitem(sys.modules, "docling", parent_module)
        monkeypatch.setitem(sys.modules, "docling.document_converter", fake_module)

    def test_converter_is_initialized_once(self, monkeypatch: pytest.MonkeyPatch) -> None:
        init_count: list[int] = []
        self._install_fake_docling(monkeypatch, init_count)

        c1, e1 = _get_docling_converter()
        c2, _ = _get_docling_converter()
        c3, _ = _get_docling_converter()

        assert len(init_count) == 1, "DocumentConverter() must be called exactly once"
        assert c1 is c2 is c3
        assert e1 is None

    def test_error_is_cached_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A failed init must not retry require_module on subsequent calls."""
        attempt_count: list[int] = []

        def failing_require(module_name: str, *_args: Any, **_kwargs: Any) -> ModuleType:
            attempt_count.append(1)
            raise ImportError(f"no module named {module_name!r}")

        import src.sources.dependencies as deps

        monkeypatch.setattr(deps, "require_module", failing_require)

        c1, e1 = _get_docling_converter()
        _c2, e2 = _get_docling_converter()

        assert c1 is None
        assert e1 is not None
        assert e2 == e1
        assert len(attempt_count) == 1, "require_module must not be retried after a cached failure"

    def test_extract_uses_cached_converter(self, monkeypatch: pytest.MonkeyPatch) -> None:
        init_count: list[int] = []
        self._install_fake_docling(monkeypatch, init_count)

        text1, _ = extract_text(
            b"\x89PNG\r\n\x1a\nfake", "image/png", file_name="a.png", enable_ocr=True
        )
        text2, _ = extract_text(
            b"\x89PNG\r\n\x1a\nfake", "image/png", file_name="b.png", enable_ocr=True
        )

        assert text1 == text2 == "ocr output"
        assert len(init_count) == 1, "DocumentConverter() must not be re-instantiated per file"


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

    def test_parse_bytes_preserves_binary_flag_when_ocr_extracts_image_text(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("ocr text", None),
        )

        parsed = parse_bytes(
            b"\x89PNG\r\n\x1a\nimage-bytes",
            declared_mime_type="image/png",
            file_name="photo.png",
            enable_ocr=True,
        )

        assert parsed.mime_type == "image/png"
        assert parsed.text_content == "ocr text"
        assert parsed.is_binary is True

    def test_iter_file_pages_uses_ocr_for_images(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("first line\nsecond line", None),
        )

        pages = list(
            iter_file_pages(
                b"\x89PNG\r\n\x1a\nimage-bytes",
                "image/png",
                batch_size=1,
                file_name="photo.png",
                enable_ocr=True,
            )
        )

        assert pages == ["first line\n", "second line"]
