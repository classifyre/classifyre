"""Extract whole files embedded inside parquet rows and OOXML media folders.

Some files carry other *files* inside them rather than beside them: a HuggingFace
dataset stores an ``image`` or ``audio`` column as ``struct<bytes, path>``, a
parquet export can hold a column of PDF or archive blobs, and Office documents
embed media under their ``media/`` folders. This module surfaces those as raw
bytes so the scan pipeline can turn each one into its own child asset — parsed by
``utils.file_parser`` and scanned like any standalone file — instead of dumping
undecodable bytes into text detectors.

Parquet extraction is row-addressable. ``start_row``/``max_rows`` bound it to the
same window the sampling strategy applies to that payload's rows (see
``pipeline.payload_window``), so a run materializes the children of the rows it
actually scanned rather than the first N rows of the file on every run. Row
numbers stay absolute, which is what keeps a child's identity stable: the image in
row 4,000,001 is ``row=4000001;col=image`` whichever window found it. OOXML media
has no row axis, so the bounds are ignored there.

On any missing optional dependency or parse failure the iterators log a warning and
yield nothing, so callers degrade gracefully.
"""

from __future__ import annotations

import io
import logging
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from .file_parser import (
    OCTET_STREAM,
    _normalize_mime_type,
    _parquet_row_group_start,
    _require_file_processing,
    resolve_mime_type,
)

logger = logging.getLogger(__name__)

_PARQUET_MIME_TYPES = frozenset({"application/parquet", "application/vnd.apache.parquet"})
_OOXML_MIME_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
    }
)
# Archive paths Office formats store embedded media under.
_OOXML_MEDIA_PREFIXES = ("xl/media/", "word/media/", "ppt/media/")

_PARQUET_MAGIC = b"PAR1"

# Cap embedded files extracted per container to bound child-asset fan-out. Under a
# windowed strategy ``max_rows`` is the real bound and this is only a backstop; the
# ALL strategy has no window, so this is what stops a million-row dataset from
# becoming a million assets.
DEFAULT_MAX_EMBEDDED_FILES = 200

# Rows read to decide what a binary column holds. Deliberately small: one sample
# batch of an image dataset materializes that many blobs at once.
_COLUMN_SAMPLE_ROWS = 8

# Rows decoded per batch while walking for embedded files.
_ROW_BATCH_SIZE = 64


@dataclass(frozen=True)
class EmbeddedFile:
    """A single file extracted from inside a container file."""

    location: str  # e.g. "row=12;col=image" or "ppt/media/image3.png"
    file_bytes: bytes
    mime_type: str  # resolved from the bytes (and the cell's own path, when it has one)


@dataclass(frozen=True)
class EmbeddedColumn:
    """A parquet column whose cells hold whole files instead of values."""

    kind: str  # "struct" (a HuggingFace feature: struct<bytes, path>) or "binary"
    mime_hint: str  # sniffed once from a sample cell; used for row-text placeholders


def is_embeddable_file_mime(mime_type: str) -> bool:
    """Whether sniffed bytes look like a self-contained file worth its own asset.

    Text-shaped payloads are excluded deliberately. A binary column holding JSON or
    plain text already reads correctly as row text, so promoting it to a child asset
    would split one record across two assets and scan the same characters twice.
    Unrecognized bytes are excluded too: a column of embedding vectors or digests is
    binary without being a file, and each cell must not become an asset.
    """
    normalized = _normalize_mime_type(mime_type)
    if not normalized or normalized == OCTET_STREAM:
        return False
    if normalized.startswith("text/"):
        return False
    return normalized not in ("application/json", "application/xml", "application/xhtml+xml")


def has_embedded_files(mime_type: str) -> bool:
    """Return True if this MIME type is a container we can pull whole files out of."""
    normalized = _normalize_mime_type(mime_type)
    return normalized in _PARQUET_MIME_TYPES or normalized in _OOXML_MIME_TYPES


def iter_embedded_files(
    file_bytes: bytes,
    mime_type: str,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
    max_files: int = DEFAULT_MAX_EMBEDDED_FILES,
) -> Iterator[EmbeddedFile]:
    """Yield the files embedded in a parquet or OOXML container.

    ``start_row``/``max_rows`` bound a parquet walk to one row window and are
    ignored for containers with no row axis.
    """
    if not file_bytes:
        return
    normalized = _normalize_mime_type(mime_type)
    if normalized in _PARQUET_MIME_TYPES:
        yield from _iter_parquet_files(
            file_bytes,
            start_row=start_row,
            max_rows=max_rows,
            max_files=max_files,
        )
    elif normalized in _OOXML_MIME_TYPES:
        yield from _iter_ooxml_files(file_bytes, max_files)


# ---------------------------------------------------------------------------
# Parquet
# ---------------------------------------------------------------------------


def extract_embedded_bytes(cell: object, kind: str) -> bytes | None:
    """Pull raw file bytes from a parquet cell value given its column kind."""
    if kind == "struct" and isinstance(cell, dict):
        value = cell.get("bytes")
        if isinstance(value, bytes | bytearray):
            return bytes(value)
        return None
    if kind == "binary" and isinstance(cell, bytes | bytearray):
        return bytes(cell)
    return None


def embedded_cell_name(cell: object, kind: str) -> str:
    """The file name a HuggingFace feature carries beside its bytes, or "".

    Worth reading: it is often the only extension available, and extension is what
    resolves formats whose magic bytes are ambiguous (OLE compound files, ZIP
    containers) or absent (HEIC, WebP variants).
    """
    if kind == "struct" and isinstance(cell, dict):
        path = cell.get("path")
        if isinstance(path, str) and path:
            return path.rsplit("/", 1)[-1]
    return ""


def detect_parquet_file_columns(parquet_file: Any) -> dict[str, EmbeddedColumn]:
    """Map column name → ``EmbeddedColumn`` for columns whose cells hold files.

    Returns ``{}`` when pyarrow is unavailable or no such column exists.
    """
    try:
        pa = _require_file_processing("pyarrow")
    except Exception as exc:  # pragma: no cover - dependency missing
        logger.warning("Cannot inspect parquet file columns: %s", exc)
        return {}

    candidates: list[tuple[str, str]] = []
    for field in parquet_file.schema_arrow:
        field_type = field.type
        if pa.types.is_struct(field_type):  # type: ignore[attr-defined]
            child_names = {
                field_type.field(i).name
                for i in range(field_type.num_fields)  # type: ignore[attr-defined]
            }
            if "bytes" in child_names:
                candidates.append((field.name, "struct"))
        elif pa.types.is_binary(field_type) or pa.types.is_large_binary(  # type: ignore[attr-defined]
            field_type
        ):
            candidates.append((field.name, "binary"))

    if not candidates:
        return {}

    try:
        sample = next(iter(parquet_file.iter_batches(batch_size=_COLUMN_SAMPLE_ROWS)), None)
    except Exception as exc:
        logger.warning("Cannot sample parquet columns: %s", exc)
        return {}

    columns: dict[str, EmbeddedColumn] = {}
    for name, kind in candidates:
        mime = _sample_column_mime(sample, name, kind)
        # A struct<bytes, …> column is a *declared* file feature (HuggingFace Image,
        # Audio, Video), so it stays a file column even when the sample is empty or
        # unrecognized. A plain binary column has to prove itself — see
        # ``is_embeddable_file_mime``.
        if kind == "struct" or is_embeddable_file_mime(mime):
            columns[name] = EmbeddedColumn(kind=kind, mime_hint=mime)
    return columns


def _sample_column_mime(batch: Any, column_name: str, kind: str) -> str:
    """MIME of the first non-empty cell in the sample batch, or ""."""
    if batch is None:
        return ""
    try:
        column = batch.column(column_name)
    except Exception:
        return ""
    for index in range(len(column)):
        cell = column[index].as_py()
        raw = extract_embedded_bytes(cell, kind)
        if raw:
            return resolve_mime_type(raw, file_name=embedded_cell_name(cell, kind))
    return ""


def _iter_parquet_files(
    file_bytes: bytes,
    *,
    start_row: int,
    max_rows: int | None,
    max_files: int,
) -> Iterator[EmbeddedFile]:
    if len(file_bytes) < 8 or file_bytes[-4:] != _PARQUET_MAGIC:
        logger.warning(
            "Parquet bytes appear truncated (footer magic missing, %d bytes); "
            "skipping embedded-file extraction",
            len(file_bytes),
        )
        return

    try:
        pq = _require_file_processing("pyarrow.parquet")
        parquet_file = pq.ParquetFile(io.BytesIO(file_bytes))  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("Cannot open parquet for embedded-file extraction: %s", exc)
        return

    columns = detect_parquet_file_columns(parquet_file)
    if not columns:
        return

    begin = max(0, start_row)
    first_group, drop_in_group = _parquet_row_group_start(parquet_file, begin)
    try:
        total_groups = int(parquet_file.metadata.num_row_groups)
    except Exception:
        total_groups = 0
    if total_groups and first_group >= total_groups:
        return

    # Resuming deep into a large file skips whole row groups without decoding them,
    # the same pushdown ``_iter_parquet_pages`` uses for the row text.
    batches = (
        parquet_file.iter_batches(batch_size=_ROW_BATCH_SIZE)
        if first_group == 0 and drop_in_group == 0
        else parquet_file.iter_batches(
            batch_size=_ROW_BATCH_SIZE,
            row_groups=list(range(first_group, total_groups)),
        )
    )

    files = 0
    abs_row = begin
    skipped = 0
    rows_read = 0
    try:
        for batch in batches:
            for local_idx in range(batch.num_rows):
                if skipped < drop_in_group:
                    skipped += 1
                    continue
                if max_rows is not None and rows_read >= max_rows:
                    return
                for column_name, column in columns.items():
                    cell = batch.column(column_name)[local_idx].as_py()
                    raw = extract_embedded_bytes(cell, column.kind)
                    if not raw:
                        continue
                    mime = resolve_mime_type(raw, file_name=embedded_cell_name(cell, column.kind))
                    if not is_embeddable_file_mime(mime):
                        continue
                    yield EmbeddedFile(
                        location=f"row={abs_row + 1};col={column_name}",
                        file_bytes=raw,
                        mime_type=mime,
                    )
                    files += 1
                    if files >= max_files:
                        logger.info(
                            "Reached max embedded files (%d); stopping extraction", max_files
                        )
                        return
                abs_row += 1
                rows_read += 1
    except Exception as exc:
        logger.warning("Parquet embedded-file iteration failed: %s", exc)


# ---------------------------------------------------------------------------
# OOXML (xlsx / docx / pptx)
# ---------------------------------------------------------------------------


def _iter_ooxml_files(file_bytes: bytes, max_files: int) -> Iterator[EmbeddedFile]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        logger.warning("Cannot open OOXML archive for embedded-file extraction: %s", exc)
        return

    count = 0
    with archive:
        for name in archive.namelist():
            if not name.startswith(_OOXML_MEDIA_PREFIXES):
                continue
            try:
                data = archive.read(name)
            except Exception as exc:
                logger.warning("Failed to read embedded media %s: %s", name, exc)
                continue
            if not data:
                continue
            mime = resolve_mime_type(data, file_name=name)
            if not is_embeddable_file_mime(mime):
                continue
            yield EmbeddedFile(location=name, file_bytes=data, mime_type=mime)
            count += 1
            if count >= max_files:
                logger.info("Reached max embedded files (%d); stopping extraction", max_files)
                return
