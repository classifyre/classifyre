"""MIME detection and text extraction utilities for local file parsing."""

from __future__ import annotations

import logging
import tempfile
import threading
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)


@dataclass
class ParsedFile:
    """Result of parsing a local file."""

    mime_type: str
    text_content: str
    is_binary: bool
    file_size_bytes: int = 0
    encoding: str | None = None
    parse_error: str | None = None


@dataclass
class ParsedBytes:
    """Result of parsing in-memory bytes."""

    mime_type: str
    raw_content: str
    text_content: str
    is_binary: bool
    file_size_bytes: int
    parse_error: str | None = None


_TEXT_RAW_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
}

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

_MIME_HINTS_BY_EXTENSION = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".parquet": "application/parquet",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
    # Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    # Video
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
}

_DOCLING_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/bmp",
    "image/webp",
}

_DOCLING_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/html",
    "application/xhtml+xml",
}
_DOCLING_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
}


class _DoclingState:
    """Mutable singleton state for the Docling DocumentConverter.

    Stored as object attributes so functions can mutate state without `global`
    statements (which ruff PLW0603 disallows). Initializing the converter is
    expensive (loads ML models), so it happens exactly once per process.
    """

    def __init__(self) -> None:
        self.converter: object = None
        self.error: str | None = None
        self.attempted: bool = False
        # Allow one retry when a MissingSourceDependencyError indicates the uv
        # sync itself failed (transient: network blip, registry timeout). A
        # genuine broken package fails on the retry too and is cached then.
        self.install_retry_remaining: int = 1


_docling_state = _DoclingState()
_docling_lock = threading.Lock()
# Limits concurrent converter.convert() calls to prevent OOM. The docling
# StandardPdfPipeline alone holds ~1 GB of model weights; additional working
# memory per in-flight conversion can push the process over the 4 GiB K8s
# limit when two conversions run simultaneously.
_docling_conversion_sem = threading.Semaphore(1)


def _get_docling_converter() -> tuple[object, str | None]:
    """Return a cached DocumentConverter, initializing it on the first call."""
    # Fast-path: only skip the lock once initialization is settled (converter
    # ready or permanently failed).  Checking `attempted` alone is not enough —
    # `attempted` is set before the install+init finishes, so threads that reach
    # here while another thread holds the lock would return (None, None) and
    # emit a spurious "unavailable" warning instead of waiting.
    if _docling_state.converter is not None or _docling_state.error is not None:
        return _docling_state.converter, _docling_state.error
    with _docling_lock:
        if _docling_state.attempted:
            return _docling_state.converter, _docling_state.error
        _docling_state.attempted = True
        try:
            from ..sources.dependencies import require_module

            converter_module = require_module(
                "docling.document_converter",
                "file parser OCR",
                ["ocr"],
                detail="OCR extraction requires the Docling optional dependency.",
            )
            _docling_state.converter = converter_module.DocumentConverter()
        except Exception as exc:
            from ..sources.dependencies import MissingSourceDependencyError

            if (
                isinstance(exc, MissingSourceDependencyError)
                and _docling_state.install_retry_remaining > 0
            ):
                # The uv sync may have failed transiently (network blip, registry
                # timeout). Reset so the next call retries once; on second failure
                # the error is cached permanently regardless of exception type.
                _docling_state.install_retry_remaining -= 1
                _docling_state.attempted = False
                logger.warning(
                    "OCR dependency install failed (may be transient); will retry once: %s", exc
                )
            else:
                _docling_state.error = str(exc)
    return _docling_state.converter, _docling_state.error


def _reset_docling_singleton() -> None:
    """Reset the cached Docling converter. Intended for test isolation only."""
    with _docling_lock:
        _docling_state.converter = None
        _docling_state.error = None
        _docling_state.attempted = False
        _docling_state.install_retry_remaining = 1


def _require_file_processing(module_name: str) -> object:
    """Import an optional file-parsing dependency, auto-installing on first miss.

    The CLI image ships only default dependencies; file-parsing libraries
    (pdfplumber, python-docx, openpyxl, pyarrow, filetype, chardet) live in the
    optional ``file-processing`` uv group and are installed on demand at runtime
    (mirrors how detectors pull their own groups). Raises MissingDependencyError
    if the group cannot be installed; callers already treat that as a parse
    failure / fall back gracefully.
    """
    from ..detectors.dependencies import require_module

    return require_module(module_name, "file parser", ["file-processing"])


def _normalize_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return ""
    return str(mime_type).split(";", 1)[0].strip().lower()


def _file_extension(file_name: str) -> str:
    if not file_name:
        return ""
    path = urlsplit(file_name).path
    value = path if path else file_name
    return Path(value).suffix.lower()


def infer_mime_type_from_file_name(file_name: str) -> str:
    """Infer MIME type from file name or URL path extension."""
    extension = _file_extension(file_name)
    return _MIME_HINTS_BY_EXTENSION.get(extension, "application/octet-stream")


def normalize_detected_mime_type(detected_mime_type: str, file_name: str) -> str:
    """
    Normalize detected MIME with filename-based fallbacks.

    Keeps parser behavior stable for sources that declare generic or plain-text
    content-types for tabular files.
    """
    mime = _normalize_mime_type(detected_mime_type)
    inferred_mime = infer_mime_type_from_file_name(file_name)

    if not mime or mime == "application/octet-stream":
        return inferred_mime

    if mime == "text/plain" and inferred_mime in _TABULAR_MIME_TYPES:
        return inferred_mime

    return mime


def _is_text_like_mime_type(mime_type: str) -> bool:
    normalized_mime = _normalize_mime_type(mime_type)
    return normalized_mime.startswith("text/") or normalized_mime in _TEXT_RAW_MIME_TYPES


def _detect_magic_mime_type(file_bytes: bytes) -> str | None:
    signatures: tuple[tuple[bytes, str], ...] = (
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"%PDF-", "application/pdf"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"PK\x03\x04", "application/zip"),
    )

    for signature, mime_type in signatures:
        if file_bytes.startswith(signature):
            return mime_type

    return None


def _sniff_text_mime(file_bytes: bytes) -> str:
    """Fallback MIME detection for text formats not handled by filetype."""
    # Check for null bytes → binary
    if b"\x00" in file_bytes[:8192]:
        return "application/octet-stream"

    # Try to decode a sample for text-based sniffing
    sample = ""
    try:
        chardet = _require_file_processing("chardet")

        detected = chardet.detect(file_bytes[:4096])  # type: ignore[attr-defined]
        encoding = detected.get("encoding") or "utf-8"
        sample = file_bytes[:4096].decode(encoding, errors="replace")
    except Exception:
        try:
            sample = file_bytes[:4096].decode("utf-8", errors="replace")
        except Exception:
            return "application/octet-stream"

    stripped = sample.lstrip()

    if stripped.startswith("{") or stripped.startswith("["):
        return "application/json"
    if stripped.startswith("<?xml"):
        return "application/xml"
    if stripped.lower().startswith("<!doctype html") or stripped.lower().startswith("<html"):
        return "text/html"

    # CSV heuristic: first non-empty line has multiple commas
    first_line = stripped.split("\n")[0] if "\n" in stripped else stripped
    if first_line.count(",") >= 2:
        return "text/csv"

    return "text/plain"


def detect_mime_type(file_bytes: bytes) -> str:
    """
    Detect MIME type from file bytes.

    Uses magic-byte detection first (filetype library), then falls back to
    text-based sniffing for formats that filetype doesn't cover.
    """
    if not file_bytes:
        return "application/octet-stream"

    magic_mime_type = _detect_magic_mime_type(file_bytes)
    if magic_mime_type:
        return magic_mime_type

    try:
        filetype = _require_file_processing("filetype")

        kind = filetype.guess(file_bytes)  # type: ignore[attr-defined]
        if kind is not None:
            return str(kind.mime)
    except Exception as e:
        logger.debug(f"filetype detection failed: {e}")

    return _sniff_text_mime(file_bytes)


def _supports_docling_ocr(mime_type: str, file_name: str) -> bool:
    normalized = _normalize_mime_type(mime_type)
    if normalized in _DOCLING_IMAGE_MIME_TYPES:
        return True
    if normalized in _DOCLING_MIME_TYPES:
        return True
    return _file_extension(file_name) in _DOCLING_EXTENSIONS


# PDFs with fewer extracted chars than this are likely scanned/image-only and
# need the full docling OCR pipeline.  Most text-layer PDFs yield hundreds of
# chars; a threshold of 50 is conservative enough to never skip real content.
_MIN_NATIVE_PDF_CHARS = 50


def _extract_pdf_text(file_bytes: bytes) -> tuple[str, str | None]:
    """Extract text from a PDF using pdfplumber (no ML models required)."""
    try:
        import io

        pdfplumber = _require_file_processing("pdfplumber")

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:  # type: ignore[attr-defined]
            pages = []
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text:
                    pages.append(text)
        return "\n\n".join(pages), None
    except Exception as e:
        return "", f"PDF extraction failed: {e}"


def _temp_file_name(file_name: str, mime_type: str) -> str:
    extension = _file_extension(file_name)
    if extension:
        return f"input{extension}"

    for suffix, candidate_mime in _MIME_HINTS_BY_EXTENSION.items():
        if candidate_mime == mime_type:
            return f"input{suffix}"

    if mime_type.startswith("image/"):
        suffix = mime_type.split("/", maxsplit=1)[1].replace("jpeg", "jpg")
        return f"input.{suffix}"

    return "input.bin"


def _extract_docling_markdown(
    file_bytes: bytes,
    *,
    mime_type: str,
    file_name: str,
) -> tuple[str, str | None]:
    converter, error = _get_docling_converter()
    if error:
        return "", error
    if converter is None:
        return "", "Docling converter unavailable"

    temp_fname = _temp_file_name(file_name, mime_type)
    try:
        with tempfile.TemporaryDirectory(prefix="classifyre-docling-") as temp_dir:
            temp_path = Path(temp_dir) / temp_fname
            temp_path.write_bytes(file_bytes)
            with _docling_conversion_sem:
                result = converter.convert(temp_path)  # type: ignore[union-attr]
            text = result.document.export_to_markdown().strip()
            page_count = len(result.document.pages) if hasattr(result.document, "pages") else None
            logger.info(
                "OCR extracted %d chars from %s (%s%s)",
                len(text),
                file_name or mime_type,
                mime_type,
                f", {page_count} pages" if page_count else "",
            )
            return text, None
    except Exception as exc:
        return "", f"Docling extraction failed: {exc}"


def extract_text(
    file_bytes: bytes,
    mime_type: str,
    *,
    file_name: str = "",
    enable_ocr: bool = False,
    enable_transcription: bool = False,
) -> tuple[str, str | None]:
    """
    Extract plain text from file bytes based on MIME type.

    Returns:
        (text_content, error_message_or_None)
    """
    if enable_ocr and _supports_docling_ocr(mime_type, file_name):
        # PDFs: try cheap native text extraction first.  Only hand off to the
        # heavy docling pipeline when the native path yields too little text,
        # which indicates a scanned or image-only PDF that genuinely needs OCR.
        # This avoids loading the ~1 GB StandardPdfPipeline for the majority of
        # PDFs that already carry a text layer.
        if mime_type == "application/pdf":
            cheap_text, cheap_error = _extract_pdf_text(file_bytes)
            if len(cheap_text.strip()) >= _MIN_NATIVE_PDF_CHARS:
                logger.info(
                    "OCR extracted %d chars from %s (%s, native text layer)",
                    len(cheap_text.strip()),
                    file_name or mime_type,
                    mime_type,
                )
                return cheap_text, cheap_error
        # Images, DOCX, PPTX, and sparse/scanned PDFs: use docling.
        text, error = _extract_docling_markdown(
            file_bytes,
            mime_type=mime_type,
            file_name=file_name,
        )
        if text:
            return text, None
        if error:
            logger.warning("OCR extraction failed for %s: %s", file_name or mime_type, error)

    # Audio / video — transcribe to text via faster-whisper when enabled.
    if mime_type.startswith(("audio/", "video/")):
        if enable_transcription:
            from .transcription import transcribe_media

            text, error = transcribe_media(
                file_bytes,
                mime_type=mime_type,
                file_name=file_name,
            )
            if text:
                return text, None
            if error:
                logger.warning("Transcription failed for %s: %s", file_name or mime_type, error)
            return "", error
        return "", None

    # Images — no native text extraction (OCR handled above when enabled)
    if mime_type.startswith("image/"):
        return "", None

    # PDF
    if mime_type == "application/pdf":
        return _extract_pdf_text(file_bytes)

    # DOCX
    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            import io

            docx = _require_file_processing("docx")

            doc = docx.Document(io.BytesIO(file_bytes))  # type: ignore[attr-defined]
            parts: list[str] = []
            for para in doc.paragraphs:
                if para.text.strip():
                    parts.append(para.text)
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            parts.append(cell.text)
            return "\n".join(parts), None
        except Exception as e:
            return "", f"DOCX extraction failed: {e}"

    # XLSX
    if mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        try:
            import io

            openpyxl = _require_file_processing("openpyxl")

            wb = openpyxl.load_workbook(  # type: ignore[attr-defined]
                io.BytesIO(file_bytes), read_only=True, data_only=True
            )
            rows: list[str] = []
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(c.strip() for c in cells):
                        rows.append("\t".join(cells))
            return "\n".join(rows), None
        except Exception as e:
            return "", f"XLSX extraction failed: {e}"

    # HTML / XHTML
    if mime_type in ("text/html", "application/xhtml+xml"):
        try:
            from .content_extraction import html_to_text

            text = _decode_bytes(file_bytes)
            return html_to_text(text), None
        except Exception as e:
            return "", f"HTML extraction failed: {e}"

    # JSON, XML — decode as-is
    if mime_type in (
        "application/json",
        "application/xml",
        "text/xml",
    ):
        return _decode_bytes(file_bytes), None

    # Plain text, CSV, Markdown, and other text/* types
    if mime_type.startswith("text/"):
        return _decode_bytes(file_bytes), None

    # Parquet — stream row-by-row (never read_table the whole file into memory)
    # and reuse the page iterator so image columns get placeholders, not raw bytes.
    if mime_type in ("application/parquet", "application/vnd.apache.parquet"):
        try:
            pages = _iter_parquet_pages(file_bytes, batch_size=1000, include_column_names=True)
            return "\n".join(pages), None
        except Exception as e:
            return "", f"Parquet extraction failed: {e}"

    # Unknown / binary
    return "", None


def _decode_bytes(file_bytes: bytes) -> str:
    """Decode bytes to str using chardet for encoding detection."""
    try:
        chardet = _require_file_processing("chardet")

        detected = chardet.detect(file_bytes[:65536])  # type: ignore[attr-defined]
        encoding = detected.get("encoding") or "utf-8"
        return file_bytes.decode(encoding, errors="replace")
    except Exception:
        return file_bytes.decode("utf-8", errors="replace")


def resolve_mime_type(
    file_bytes: bytes,
    *,
    declared_mime_type: str | None = None,
    file_name: str = "",
) -> str:
    """
    Resolve effective MIME type from declared hint, magic-byte detection, and file extension.

    Kept separate from full parsing so callers can detect format cheaply without
    paying for text extraction (e.g. when content will be streamed in pages later).
    """
    declared_mime = _normalize_mime_type(declared_mime_type)
    detected_mime = _normalize_mime_type(detect_mime_type(file_bytes))
    inferred_mime = infer_mime_type_from_file_name(file_name)

    if declared_mime and declared_mime != "application/octet-stream":
        mime_type = declared_mime
    elif detected_mime and detected_mime != "application/octet-stream":
        mime_type = detected_mime
    elif inferred_mime and inferred_mime != "application/octet-stream":
        mime_type = inferred_mime
    else:
        mime_type = declared_mime or detected_mime or inferred_mime or "application/octet-stream"

    mime_type = normalize_detected_mime_type(mime_type, file_name)
    if mime_type == "application/octet-stream" and inferred_mime != "application/octet-stream":
        mime_type = inferred_mime

    return mime_type


def parse_bytes(
    file_bytes: bytes,
    *,
    declared_mime_type: str | None = None,
    file_name: str = "",
    enable_ocr: bool = False,
    enable_transcription: bool = False,
) -> ParsedBytes:
    """
    Parse in-memory bytes: resolve MIME type and extract raw/text content.

    Used by the sandbox and any caller that needs a complete ParsedBytes in one shot.
    Object-storage sources prefer resolve_mime_type() + iter_file_pages() to avoid
    loading all content into memory before detector scanning.
    """
    file_size_bytes = len(file_bytes)
    mime_type = resolve_mime_type(
        file_bytes, declared_mime_type=declared_mime_type, file_name=file_name
    )

    text_content, parse_error = extract_text(
        file_bytes,
        mime_type,
        file_name=file_name,
        enable_ocr=enable_ocr,
        enable_transcription=enable_transcription,
    )
    raw_content = _decode_bytes(file_bytes) if _is_text_like_mime_type(mime_type) else ""

    if mime_type in {"text/html", "application/xhtml+xml"} and raw_content and not text_content:
        from .content_extraction import html_to_text

        text_content = html_to_text(raw_content)

    is_binary = (
        mime_type.startswith(("image/", "audio/", "video/"))
        or mime_type == "application/octet-stream"
    )

    return ParsedBytes(
        mime_type=mime_type,
        raw_content=raw_content,
        text_content=text_content,
        is_binary=is_binary,
        file_size_bytes=file_size_bytes,
        parse_error=parse_error,
    )


def iter_file_pages(
    file_bytes: bytes,
    mime_type: str,
    batch_size: int = 100,
    include_column_names: bool = True,
    *,
    file_name: str = "",
    enable_ocr: bool = False,
    enable_transcription: bool = False,
) -> Generator[str, None, None]:
    """
    Iterate over file content in pages of up to batch_size rows or lines.

    Parquet / CSV / TSV  → yields batch_size *rows* per page with labelled columns.
    All other extractable types (PDF, DOCX, TXT, JSON, XML, XLSX, …) → extracts the
    full text once via extract_text(), then yields batch_size *lines* per page.
    Audio/video → transcript lines when enable_transcription is set, else nothing.
    Non-extractable types (images, unknown binary) → yields nothing.

    New file formats only need to be added to extract_text() — not here.
    """
    normalized = _normalize_mime_type(mime_type)

    if normalized in ("application/parquet", "application/vnd.apache.parquet"):
        yield from _iter_parquet_pages(file_bytes, batch_size, include_column_names)
    elif normalized in ("text/csv", "text/tab-separated-values"):
        yield from _iter_csv_pages(file_bytes, include_column_names)
    elif normalized.startswith(("audio/", "video/")) and enable_transcription:
        # Stream transcript pages directly from the chunked transcription pipeline
        # so the detector receives text as each ~10-min audio chunk completes
        # instead of waiting for the full file and buffering the entire transcript.
        from .transcription import iter_transcription_pages

        yield from iter_transcription_pages(
            file_bytes,
            mime_type=normalized,
            file_name=file_name,
            segments_per_page=batch_size,
        )
    else:
        text, error = extract_text(
            file_bytes,
            normalized,
            file_name=file_name,
            enable_ocr=enable_ocr,
            enable_transcription=enable_transcription,
        )
        if error:
            logger.warning("Text extraction error (%s): %s", mime_type, error)
        if text:
            yield from _iter_text_lines(text, batch_size)


def _iter_text_lines(text: str, batch_size: int) -> Generator[str, None, None]:
    """Yield non-empty text in chunks of batch_size lines."""
    lines = text.splitlines(keepends=True)
    for start in range(0, len(lines), batch_size):
        chunk = "".join(lines[start : start + batch_size])
        if chunk.strip():
            yield chunk


_PARQUET_MAGIC = b"PAR1"


def _iter_parquet_pages(
    file_bytes: bytes,
    batch_size: int,
    include_column_names: bool,
) -> Generator[str, None, None]:
    # Parquet files begin AND end with the 4-byte magic "PAR1".  If the footer
    # is missing the bytes were truncated mid-download; pyarrow's C++ thread
    # pool will hang indefinitely trying to read schema metadata that isn't
    # there, locking all worker threads on a futex.  Bail out early instead.
    if len(file_bytes) < 8 or file_bytes[-4:] != _PARQUET_MAGIC:
        logger.warning(
            "Parquet bytes appear truncated (footer magic missing, %d bytes); skipping",
            len(file_bytes),
        )
        return

    try:
        import io

        pq = _require_file_processing("pyarrow.parquet")

        # ParquetFile + iter_batches() reads one row-group at a time instead of
        # loading the whole table into memory, and surfaces schema errors early
        # (before reading any data) so a bad file can't lock the C++ thread pool.
        pf = pq.ParquetFile(io.BytesIO(file_bytes))  # type: ignore[attr-defined]

        # Image columns (HF Image structs, raw image-byte columns) carry binary
        # blobs that are useless and wasteful as row text — they're surfaced
        # separately as child IMAGE assets. Render a compact placeholder instead.
        from .embedded_images import detect_parquet_image_columns, extract_image_bytes

        image_columns = detect_parquet_image_columns(pf)

        abs_row = 0
        for batch in pf.iter_batches(batch_size=batch_size):
            col_names = batch.schema.names
            for local_idx in range(batch.num_rows):
                lines: list[str] = []
                lines.append(f"row_{abs_row + 1}:")
                for col_i, col in enumerate(col_names):
                    cell = batch.column(col_i)[local_idx].as_py()
                    if col in image_columns:
                        cell_str = _format_image_placeholder(
                            extract_image_bytes(cell, image_columns[col])
                        )
                    else:
                        cell_str = "" if cell is None else str(cell)
                    first, *rest = cell_str.splitlines() or [""]
                    lines.append(f"  {col}: {first}" if include_column_names else f"  {first}")
                    lines.extend(f"    {c}" for c in rest)
                lines.append("")
                abs_row += 1
                if lines:
                    yield "\n".join(lines)
    except Exception as exc:
        logger.warning("Parquet page iteration failed: %s", exc)


def _iter_csv_pages(
    file_bytes: bytes,
    include_column_names: bool,
) -> Generator[str, None, None]:
    import csv
    import io

    try:
        text = _decode_bytes(file_bytes)
        reader = csv.DictReader(io.StringIO(text))
        headers = list(reader.fieldnames or [])

        total_seen = 0

        for row in reader:
            total_seen += 1
            yield _format_tabular_page([dict(row)], headers, total_seen, include_column_names)
    except Exception as exc:
        logger.warning("CSV page iteration failed: %s", exc)


def _format_image_placeholder(raw: bytes | None) -> str:
    """Compact stand-in for an embedded-image cell, so its bytes never hit text detectors."""
    if not raw:
        return "<image>"
    size = len(raw)
    if size >= 1024 * 1024:
        human = f"{size / 1024 / 1024:.1f} MB"
    elif size >= 1024:
        human = f"{size / 1024:.0f} KB"
    else:
        human = f"{size} B"
    return f"<image: {human}>"


def _format_tabular_page(
    rows: list[dict[str, str]],
    headers: list[str],
    abs_row_start: int,
    include_column_names: bool,
) -> str:
    lines: list[str] = []
    for i, row in enumerate(rows):
        lines.append(f"row_{abs_row_start + i}:")
        for col in headers:
            first, *rest = (row.get(col) or "").splitlines() or [""]
            lines.append(f"  {col}: {first}" if include_column_names else f"  {first}")
            lines.extend(f"    {c}" for c in rest)
        lines.append("")
    return "\n".join(lines)


def parse_file(file_path: Path, *, enable_ocr: bool = False) -> ParsedFile:
    """
    Parse a local file: detect MIME type and extract text.

    Args:
        file_path: Path to the file on disk.

    Returns:
        ParsedFile with mime_type, text_content, is_binary, etc.

    Raises:
        FileNotFoundError: If file_path does not exist.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    file_bytes = file_path.read_bytes()
    parsed = parse_bytes(file_bytes, file_name=file_path.name, enable_ocr=enable_ocr)

    encoding: str | None = None
    if not parsed.is_binary and parsed.text_content:
        try:
            chardet = _require_file_processing("chardet")

            detected = chardet.detect(file_bytes[:65536])  # type: ignore[attr-defined]
            encoding = detected.get("encoding")
        except Exception:
            pass

    return ParsedFile(
        mime_type=parsed.mime_type,
        text_content=parsed.text_content,
        is_binary=parsed.is_binary,
        file_size_bytes=parsed.file_size_bytes,
        encoding=encoding,
        parse_error=parsed.parse_error,
    )
