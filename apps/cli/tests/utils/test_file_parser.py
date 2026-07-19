"""Unit tests for src/utils/file_parser.py."""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any

import pytest

from src.utils.file_parser import (
    ParsedFile,
    TextExtractionCoverageCode,
    TextExtractionCoverageError,
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

    def test_image_without_detected_text_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("", None),
        )
        text, err = extract_text(b"\x89PNG\r\n\x1a\n", "image/png")
        assert text == ""
        assert err is None

    def test_docling_unavailable_is_structured_coverage_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("", "Docling converter unavailable"),
        )

        with pytest.raises(TextExtractionCoverageError) as error:
            list(
                iter_file_pages(
                    b"\x89PNG\r\n\x1a\n",
                    "image/png",
                    file_name="receipt.png",
                )
            )

        assert error.value.code == TextExtractionCoverageCode.ENGINE_UNAVAILABLE

    def test_audio_without_speech_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.utils.transcription.transcribe_media",
            lambda *_args, **_kwargs: ("", None),
        )
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

    def test_image_ocr_always_uses_docling(
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
        )

        assert text == "Detected from OCR"
        assert err is None

    def test_plain_text_does_not_use_ocr(
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
        )

        assert "hello plain text" in text
        assert err is None

    def test_markdown_does_not_use_ocr(
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
        )

        assert "Heading" in text
        assert err is None

    def test_audio_is_always_transcribed(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.transcription.transcribe_media",
            lambda *_args, **_kwargs: ("hello from the recording", None),
        )

        text, err = extract_text(
            b"fake-audio-bytes",
            "audio/mpeg",
            file_name="clip.mp3",
        )

        assert text == "hello from the recording"
        assert err is None

    def test_video_combines_transcript_and_visual_ocr(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.transcription.transcribe_media",
            lambda *_args, **_kwargs: ("spoken words from video", None),
        )
        monkeypatch.setattr(
            "src.utils.video_processing.extract_video_ocr",
            lambda *_args, **_kwargs: ("[On-screen text 00:00:01]\nSlide title", None),
        )

        text, err = extract_text(
            b"fake-video-bytes",
            "video/mp4",
            file_name="clip.mp4",
        )

        assert "[Transcript]\nspoken words from video" in text
        assert "[On-screen text 00:00:01]\nSlide title" in text
        assert err is None

    def test_transcription_error_propagates(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "src.utils.transcription.transcribe_media",
            lambda *_args, **_kwargs: ("", "Transcription failed: boom"),
        )

        text, err = extract_text(
            b"fake-audio-bytes",
            "audio/mpeg",
            file_name="clip.mp3",
        )

        assert text == ""
        assert err == "Transcription failed: boom"


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

    def test_docx_uses_native_extraction(self) -> None:
        assert (
            _supports_docling_ocr(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ""
            )
            is False
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

        text1, _ = extract_text(b"\x89PNG\r\n\x1a\nfake", "image/png", file_name="a.png")
        text2, _ = extract_text(b"\x89PNG\r\n\x1a\nfake", "image/png", file_name="b.png")

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

    def test_image_is_binary(
        self, tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("", None),
        )
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

    def test_octet_stream_uses_filename_hint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("", "invalid test PDF"),
        )
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
            )
        )

        assert pages == ["first line\n", "second line"]


# ---------------------------------------------------------------------------
# New format support: magic detection, zip refinement, RTF/XML/EML,
# ODF/MSG docling routing, legacy Office, GIF/HEIC OCR conversion, archives
# ---------------------------------------------------------------------------


def _zip_container(entries: dict[str, bytes]) -> bytes:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


class TestMagicSignatures:
    def test_rtf(self) -> None:
        assert detect_mime_type(rb"{\rtf1\ansi hi}") == "application/rtf"

    def test_gzip(self) -> None:
        import gzip

        assert detect_mime_type(gzip.compress(b"data")) == "application/gzip"

    def test_7z(self) -> None:
        assert detect_mime_type(b"7z\xbc\xaf\x27\x1cxxxx") == "application/x-7z-compressed"

    def test_rar(self) -> None:
        assert detect_mime_type(b"Rar!\x1a\x07\x00xxxx") == "application/vnd.rar"

    def test_ole_compound_file(self) -> None:
        assert (
            detect_mime_type(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32)
            == "application/x-ole-storage"
        )

    def test_tar_ustar_magic(self) -> None:
        import io
        import tarfile

        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            info = tarfile.TarInfo("a.txt")
            info.size = 2
            archive.addfile(info, io.BytesIO(b"hi"))
        assert detect_mime_type(buffer.getvalue()) == "application/x-tar"


class TestZipMimeRefinement:
    def test_odt_detected_from_mimetype_entry(self) -> None:
        data = _zip_container(
            {"mimetype": b"application/vnd.oasis.opendocument.text", "content.xml": b"<x/>"}
        )
        assert detect_mime_type(data) == "application/vnd.oasis.opendocument.text"

    def test_docx_detected_from_content_types(self) -> None:
        data = _zip_container({"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<d/>"})
        assert (
            detect_mime_type(data)
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    def test_xlsx_detected_from_content_types(self) -> None:
        data = _zip_container({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": b"<w/>"})
        assert (
            detect_mime_type(data)
            == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_plain_zip_stays_zip(self) -> None:
        data = _zip_container({"readme.txt": b"hello"})
        assert detect_mime_type(data) == "application/zip"

    def test_truncated_zip_falls_back_by_extension(self) -> None:
        from src.utils.file_parser import resolve_mime_type

        # Unreadable container bytes + a .docx name → extension wins.
        assert (
            resolve_mime_type(b"PK\x03\x04truncated", file_name="report.docx")
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )


class TestOleMimeResolution:
    def test_doc_extension_refines_ole(self) -> None:
        from src.utils.file_parser import resolve_mime_type

        ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32
        assert resolve_mime_type(ole, file_name="legacy.doc") == "application/msword"
        assert resolve_mime_type(ole, file_name="legacy.xls") == "application/vnd.ms-excel"
        assert resolve_mime_type(ole, file_name="legacy.ppt") == "application/vnd.ms-powerpoint"
        assert resolve_mime_type(ole, file_name="mail.msg") == "application/vnd.ms-outlook"

    def test_ole_without_extension_stays_generic(self) -> None:
        from src.utils.file_parser import resolve_mime_type

        ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32
        assert resolve_mime_type(ole, file_name="blob") == "application/x-ole-storage"


class TestRtfExtraction:
    def test_text_extracted(self) -> None:
        pytest.importorskip("striprtf")
        text, error = extract_text(rb"{\rtf1\ansi Hello {\b World}!}", "application/rtf")
        assert error is None
        assert "Hello" in text and "World" in text
        assert "rtf1" not in text


class TestXmlExtraction:
    def test_element_text_and_attributes(self) -> None:
        pytest.importorskip("defusedxml")
        data = b"<?xml version='1.0'?><root attr='v'><item>hello</item></root>"
        text, error = extract_text(data, "application/xml")
        assert error is None
        assert "item: hello" in text
        assert "root@attr: v" in text

    def test_malformed_xml_falls_back_to_raw(self) -> None:
        data = b"<?xml version='1.0'?><unclosed>"
        text, error = extract_text(data, "application/xml")
        assert error is None
        assert "unclosed" in text

    def test_entity_expansion_is_defused(self) -> None:
        pytest.importorskip("defusedxml")
        bomb = b"<?xml version='1.0'?><!DOCTYPE a [<!ENTITY x 'yyyy'>]><root>&x;</root>"
        text, _error = extract_text(bomb, "application/xml")
        # defusedxml rejects the DTD, so the raw fallback is returned with the
        # entity reference left unexpanded.
        assert "&x;" in text
        assert "root: yyyy" not in text


class TestEmlExtraction:
    def test_headers_body_and_attachments(self) -> None:
        import email.message
        import email.policy

        message = email.message.EmailMessage(policy=email.policy.default)
        message["From"] = "alice@example.com"
        message["To"] = "bob@example.com"
        message["Subject"] = "Quarterly numbers"
        message.set_content("Hello Bob,\nplease find the report attached.")
        message.add_attachment(
            b"fake-bytes", maintype="application", subtype="pdf", filename="report.pdf"
        )

        text, error = extract_text(message.as_bytes(), "message/rfc822")
        assert error is None
        assert "From: alice@example.com" in text
        assert "Subject: Quarterly numbers" in text
        assert "please find the report attached." in text
        assert "[Attachment: report.pdf (application/pdf)]" in text

    def test_html_only_body_is_stripped(self) -> None:
        import email.message
        import email.policy

        message = email.message.EmailMessage(policy=email.policy.default)
        message["From"] = "a@example.com"
        message.set_content("<html><body><p>Rich text</p></body></html>", subtype="html")

        text, error = extract_text(message.as_bytes(), "message/rfc822")
        assert error is None
        assert "Rich text" in text
        assert "<p>" not in text


class TestDoclingNativeFormats:
    def test_odt_routes_to_docling(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[str] = []
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **kwargs: (calls.append(kwargs["mime_type"]), ("odt text", None))[1],
        )
        text, error = extract_text(
            b"odt-bytes", "application/vnd.oasis.opendocument.text", file_name="doc.odt"
        )
        assert (text, error) == ("odt text", None)
        assert calls == ["application/vnd.oasis.opendocument.text"]

    def test_msg_routes_to_docling(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.utils.file_parser._extract_docling_markdown",
            lambda *_args, **_kwargs: ("msg text", None),
        )
        text, error = extract_text(b"msg-bytes", "application/vnd.ms-outlook", file_name="mail.msg")
        assert (text, error) == ("msg text", None)


class TestLegacyOfficeExtraction:
    def test_converted_bytes_flow_through_modern_extractor(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import io

        docx = pytest.importorskip("docx")
        docx_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        buffer = io.BytesIO()
        document = docx.Document()
        document.add_paragraph("converted body")
        document.save(buffer)
        monkeypatch.setattr(
            "src.utils.legacy_office.convert_legacy_office",
            lambda _bytes, _mime: (buffer.getvalue(), docx_mime, None),
        )

        text, error = extract_text(b"old-doc-bytes", "application/msword", file_name="a.doc")
        assert error is None
        assert "converted body" in text

    def test_conversion_failure_surfaces_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.utils.legacy_office.convert_legacy_office",
            lambda _bytes, _mime: (None, "target/mime", "soffice missing"),
        )
        text, error = extract_text(b"old", "application/vnd.ms-powerpoint", file_name="a.ppt")
        assert text == ""
        assert error == "soffice missing"


class TestOcrImageConversion:
    def test_gif_supported_for_ocr(self) -> None:
        assert _supports_docling_ocr("image/gif", "animation.gif")
        assert _supports_docling_ocr("image/heic", "photo.heic")

    def test_gif_converted_to_png_before_docling(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pytest.importorskip("PIL")
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (10, 10), (255, 0, 0)).save(buffer, format="GIF")

        received: dict[str, Any] = {}

        def _fake_docling(file_bytes: bytes, *, mime_type: str, file_name: str):
            _ = file_name
            received["mime_type"] = mime_type
            received["magic"] = file_bytes[:8]
            return "ocr text", None

        monkeypatch.setattr("src.utils.file_parser._extract_docling_markdown", _fake_docling)
        text, error = extract_text(buffer.getvalue(), "image/gif", file_name="anim.gif")
        assert (text, error) == ("ocr text", None)
        assert received["mime_type"] == "image/png"
        assert received["magic"] == b"\x89PNG\r\n\x1a\n"

    def test_convert_image_to_png_gif_first_frame(self) -> None:
        pytest.importorskip("PIL")
        import io

        from PIL import Image

        from src.utils.file_parser import _convert_image_to_png

        buffer = io.BytesIO()
        Image.new("RGB", (4, 4), (0, 255, 0)).save(buffer, format="GIF")
        png, error = _convert_image_to_png(buffer.getvalue(), "image/gif")
        assert error is None
        assert png is not None and png.startswith(b"\x89PNG\r\n\x1a\n")

    def test_invalid_image_returns_error(self) -> None:
        from src.utils.file_parser import _convert_image_to_png

        png, error = _convert_image_to_png(b"not-an-image", "image/gif")
        assert png is None
        assert error is not None


class TestArchiveMimeHandling:
    def test_archives_yield_no_text_and_no_error(self) -> None:
        data = _zip_container({"a.txt": b"hello"})
        text, error = extract_text(data, "application/zip", file_name="a.zip")
        assert (text, error) == ("", None)

    def test_parse_bytes_marks_archives_binary(self) -> None:
        data = _zip_container({"a.txt": b"hello"})
        parsed = parse_bytes(data, file_name="a.zip")
        assert parsed.mime_type == "application/zip"
        assert parsed.is_binary is True
