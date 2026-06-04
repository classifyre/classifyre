"""Normalized file metadata extraction.

Produces a dict of normalized metadata keys (``size_bytes``, ``row_count``,
``page_count`` ...) that mean the same thing regardless of which source the
file came from (object storage, Confluence/Jira attachment, Notion file, ...).

All extraction is best-effort: any failure is captured under ``parse_error``
and a partial dict is returned. This function never raises.

The optional parsing libraries (pdfplumber, openpyxl, pyarrow, chardet, PIL)
live in the ``file-processing`` / ``content`` uv groups and are imported
lazily so this module is importable even when they are absent.
"""

from __future__ import annotations

import csv
import io
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

# Cap CSV sniffing so a huge file does not force a full read just for metadata.
_CSV_MAX_SCAN_BYTES = 5 * 1024 * 1024


def _normalize_mime(mime_type: str) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _extension(file_name: str) -> str:
    if not file_name:
        return ""
    path = urlsplit(file_name).path or file_name
    return Path(path).suffix.lower()


def extract_file_metadata(
    file_bytes: bytes,
    mime_type: str,
    *,
    file_name: str = "",
) -> dict[str, Any]:
    """Return normalized metadata for a file's raw bytes.

    Always sets ``size_bytes`` and ``mime_type``. Adds format-specific keys
    (``page_count``, ``row_count``, ``column_count``, ``column_names``,
    ``encoding``, ``image_width``, ``image_height``) where they can be derived.
    On any extraction error, sets ``parse_error`` and returns what was gathered.
    """
    metadata: dict[str, Any] = {
        "size_bytes": len(file_bytes),
    }
    normalized = _normalize_mime(mime_type)
    if normalized:
        metadata["mime_type"] = normalized
    extension = _extension(file_name)

    try:
        if normalized == "application/pdf" or extension == ".pdf":
            metadata.update(_pdf_metadata(file_bytes))
        elif _is_parquet(normalized, extension):
            metadata.update(_parquet_metadata(file_bytes))
        elif _is_xlsx(normalized, extension):
            metadata.update(_xlsx_metadata(file_bytes))
        elif _is_delimited(normalized, extension):
            metadata.update(_csv_metadata(file_bytes, extension))
        elif normalized.startswith("image/") or extension in _IMAGE_EXTENSIONS:
            metadata.update(_image_metadata(file_bytes))
        elif normalized.startswith("text/") or extension in _TEXT_EXTENSIONS:
            metadata.update(_encoding_metadata(file_bytes))
    except Exception as exc:  # never raise - metadata is best-effort
        logger.debug("File metadata extraction failed for %s: %s", file_name, exc)
        metadata["parse_error"] = str(exc)

    return metadata


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico"}
_TEXT_EXTENSIONS = {".txt", ".md", ".json", ".xml", ".log", ".yaml", ".yml"}


def _is_parquet(mime: str, extension: str) -> bool:
    return "parquet" in mime or extension == ".parquet"


def _is_xlsx(mime: str, extension: str) -> bool:
    return (
        mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        or extension == ".xlsx"
    )


def _is_delimited(mime: str, extension: str) -> bool:
    return mime in ("text/csv", "text/tab-separated-values") or extension in (".csv", ".tsv")


def _pdf_metadata(file_bytes: bytes) -> dict[str, Any]:
    import pdfplumber  # type: ignore[import-untyped]

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        return {"page_count": len(pdf.pages)}


def _parquet_metadata(file_bytes: bytes) -> dict[str, Any]:
    import pyarrow.parquet as pq  # type: ignore[import-untyped]

    parquet_file = pq.ParquetFile(io.BytesIO(file_bytes))
    schema = parquet_file.schema_arrow
    column_names = list(schema.names)
    return {
        "row_count": parquet_file.metadata.num_rows,
        "column_count": len(column_names),
        "column_names": column_names,
    }


def _xlsx_metadata(file_bytes: bytes) -> dict[str, Any]:
    import openpyxl  # type: ignore[import-untyped]

    workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    try:
        sheet = workbook.worksheets[0]
        header_row = next(sheet.iter_rows(values_only=True), None)
        column_names = [str(cell) for cell in header_row if cell is not None] if header_row else []
        # max_row/max_column are reliable on read-only sheets after dimension scan.
        row_count = (sheet.max_row or 1) - 1  # exclude header row
        result: dict[str, Any] = {
            "row_count": max(row_count, 0),
            "column_count": len(column_names) or (sheet.max_column or 0),
        }
        if column_names:
            result["column_names"] = column_names
        return result
    finally:
        workbook.close()


def _csv_metadata(file_bytes: bytes, extension: str) -> dict[str, Any]:
    encoding_meta = _encoding_metadata(file_bytes)
    encoding = encoding_meta.get("encoding") or "utf-8"
    scan = file_bytes[:_CSV_MAX_SCAN_BYTES]
    text = scan.decode(encoding, errors="replace")
    delimiter = "\t" if extension == ".tsv" else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    column_names: list[str] = []
    row_count = 0
    for index, row in enumerate(reader):
        if index == 0:
            column_names = [cell.strip() for cell in row]
            continue
        row_count += 1
    result: dict[str, Any] = {
        "row_count": row_count,
        "column_count": len(column_names),
    }
    if column_names:
        result["column_names"] = column_names
    result.update(encoding_meta)
    return result


def _image_metadata(file_bytes: bytes) -> dict[str, Any]:
    from PIL import Image  # type: ignore[import-untyped]

    with Image.open(io.BytesIO(file_bytes)) as image:
        return {"image_width": image.width, "image_height": image.height}


def _encoding_metadata(file_bytes: bytes) -> dict[str, Any]:
    try:
        import chardet  # type: ignore[import-untyped]
    except ImportError:
        return {}
    detected = chardet.detect(file_bytes[:65536])
    encoding = detected.get("encoding") if isinstance(detected, dict) else None
    return {"encoding": encoding} if encoding else {}
