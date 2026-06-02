"""Extract embedded images from tabular (parquet) and OOXML (xlsx/docx/pptx) files.

Some files carry images *inside* their rows or archive structure rather than as
standalone assets — e.g. HuggingFace image datasets store an ``image`` column as a
``struct<bytes, path>``, and Office documents embed pictures under their ``media/``
folders. This module surfaces those images as raw bytes so the scan pipeline can
treat each one as its own child IMAGE asset (or run image detectors on it directly
in the sandbox), instead of dumping undecodable bytes into text detectors.

On any missing optional dependency or parse failure the iterators log a warning and
yield nothing, so callers degrade gracefully.
"""

from __future__ import annotations

import io
import logging
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass

from .file_parser import _normalize_mime_type, _require_file_processing, detect_mime_type

logger = logging.getLogger(__name__)

_PARQUET_MIME_TYPES = frozenset({"application/parquet", "application/vnd.apache.parquet"})
_OOXML_MIME_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
    }
)
# Archive paths Office formats store embedded pictures under.
_OOXML_MEDIA_PREFIXES = ("xl/media/", "word/media/", "ppt/media/")

_PARQUET_MAGIC = b"PAR1"

# Cap embedded images extracted per file to bound child-asset fan-out / memory.
DEFAULT_MAX_EMBEDDED_IMAGES = 200


@dataclass
class EmbeddedImage:
    """A single image extracted from inside a container file."""

    location: str  # e.g. "row=12;col=image" or "ppt/media/image3.png"
    image_bytes: bytes
    mime_type: str  # sniffed image/* MIME


def has_embedded_images(mime_type: str) -> bool:
    """Return True if this MIME type is a container we can pull images out of."""
    normalized = _normalize_mime_type(mime_type)
    return normalized in _PARQUET_MIME_TYPES or normalized in _OOXML_MIME_TYPES


def iter_embedded_images(
    file_bytes: bytes,
    mime_type: str,
    *,
    max_images: int = DEFAULT_MAX_EMBEDDED_IMAGES,
) -> Iterator[EmbeddedImage]:
    """Yield embedded images from a parquet or OOXML file (bounded by max_images)."""
    if not file_bytes:
        return
    normalized = _normalize_mime_type(mime_type)
    if normalized in _PARQUET_MIME_TYPES:
        yield from _iter_parquet_images(file_bytes, max_images)
    elif normalized in _OOXML_MIME_TYPES:
        yield from _iter_ooxml_images(file_bytes, max_images)


# ---------------------------------------------------------------------------
# Parquet
# ---------------------------------------------------------------------------


def detect_parquet_image_columns(parquet_file: object) -> dict[str, str]:
    """Map column name → kind ('struct' | 'binary') for columns holding images.

    ``struct`` columns are HuggingFace ``Image`` features (``struct<bytes, path>``);
    ``binary`` columns are raw byte columns whose first non-null value sniffs to an
    image. Returns ``{}`` when pyarrow is unavailable or no image columns are found.
    """
    try:
        pa = _require_file_processing("pyarrow")
    except Exception as exc:  # pragma: no cover - dependency missing
        logger.warning("Cannot inspect parquet image columns: %s", exc)
        return {}

    schema = parquet_file.schema_arrow  # type: ignore[attr-defined]
    image_columns: dict[str, str] = {}
    sampled_batch: object | None = None
    sampled = False

    for field in schema:
        field_type = field.type
        if pa.types.is_struct(field_type):  # type: ignore[attr-defined]
            child_names = {
                field_type.field(i).name
                for i in range(field_type.num_fields)  # type: ignore[attr-defined]
            }
            if "bytes" in child_names:
                image_columns[field.name] = "struct"
        elif pa.types.is_binary(field_type) or pa.types.is_large_binary(  # type: ignore[attr-defined]
            field_type
        ):
            if not sampled:
                sampled_batch = next(
                    iter(parquet_file.iter_batches(batch_size=32)),
                    None,  # type: ignore[attr-defined]
                )
                sampled = True
            if sampled_batch is not None and _binary_column_is_image(sampled_batch, field.name):
                image_columns[field.name] = "binary"

    return image_columns


def _binary_column_is_image(batch: object, column_name: str) -> bool:
    column = batch.column(column_name)  # type: ignore[attr-defined]
    for i in range(len(column)):
        value = column[i].as_py()
        if value:
            return detect_mime_type(bytes(value)).startswith("image/")
    return False


def extract_image_bytes(cell: object, kind: str) -> bytes | None:
    """Pull raw image bytes from a parquet cell value given its column kind."""
    if kind == "struct" and isinstance(cell, dict):
        value = cell.get("bytes")
        if isinstance(value, bytes | bytearray):
            return bytes(value)
        return None
    if kind == "binary" and isinstance(cell, bytes | bytearray):
        return bytes(cell)
    return None


def _iter_parquet_images(file_bytes: bytes, max_images: int) -> Iterator[EmbeddedImage]:
    if len(file_bytes) < 8 or file_bytes[-4:] != _PARQUET_MAGIC:
        logger.warning(
            "Parquet bytes appear truncated (footer magic missing, %d bytes); "
            "skipping embedded-image extraction",
            len(file_bytes),
        )
        return

    try:
        pq = _require_file_processing("pyarrow.parquet")
        parquet_file = pq.ParquetFile(io.BytesIO(file_bytes))  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("Cannot open parquet for embedded-image extraction: %s", exc)
        return

    image_columns = detect_parquet_image_columns(parquet_file)
    if not image_columns:
        return

    count = 0
    abs_row = 0
    try:
        for batch in parquet_file.iter_batches(batch_size=64):
            for local_idx in range(batch.num_rows):
                for col_name, kind in image_columns.items():
                    cell = batch.column(col_name)[local_idx].as_py()
                    raw = extract_image_bytes(cell, kind)
                    if not raw:
                        continue
                    mime = detect_mime_type(raw)
                    if not mime.startswith("image/"):
                        continue
                    yield EmbeddedImage(
                        location=f"row={abs_row + 1};col={col_name}",
                        image_bytes=raw,
                        mime_type=mime,
                    )
                    count += 1
                    if count >= max_images:
                        logger.info(
                            "Reached max embedded images (%d); stopping extraction", max_images
                        )
                        return
                abs_row += 1
    except Exception as exc:
        logger.warning("Parquet embedded-image iteration failed: %s", exc)


# ---------------------------------------------------------------------------
# OOXML (xlsx / docx / pptx)
# ---------------------------------------------------------------------------


def _iter_ooxml_images(file_bytes: bytes, max_images: int) -> Iterator[EmbeddedImage]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        logger.warning("Cannot open OOXML archive for embedded-image extraction: %s", exc)
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
            mime = detect_mime_type(data)
            if not mime.startswith("image/"):
                continue
            yield EmbeddedImage(location=name, image_bytes=data, mime_type=mime)
            count += 1
            if count >= max_images:
                logger.info("Reached max embedded images (%d); stopping extraction", max_images)
                return
