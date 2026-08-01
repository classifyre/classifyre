"""Unit tests for embedded-file extraction from parquet and OOXML containers."""

from __future__ import annotations

import io
import zipfile

import pytest

from src.utils.embedded_files import (
    CONTENT_FILE,
    CONTENT_OPAQUE,
    CONTENT_TEXT,
    EmbeddedFile,
    classify_embedded_mime,
    embedded_cell_name,
    extract_embedded_bytes,
    has_embedded_files,
    is_embeddable_file_mime,
    iter_embedded_files,
)

_PARQUET_MIME = "application/parquet"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

_PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n"


def _png_bytes(color: str = "red") -> bytes:
    pytest.importorskip("PIL")
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _write_parquet(table: object, row_group_size: int | None = None) -> bytes:
    pq = pytest.importorskip("pyarrow.parquet")

    buffer = io.BytesIO()
    if row_group_size is None:
        pq.write_table(table, buffer)
    else:
        pq.write_table(table, buffer, row_group_size=row_group_size)
    return buffer.getvalue()


def _hf_parquet_bytes(rows: int = 2, row_group_size: int | None = None) -> bytes:
    """Build a parquet mimicking a HuggingFace image dataset: image struct + label."""
    pa = pytest.importorskip("pyarrow")

    colors = ["red", "blue", "green", "yellow"]
    images = [{"bytes": _png_bytes(colors[i % len(colors)]), "path": None} for i in range(rows)]
    table = pa.table(
        {
            "image": pa.array(images),
            "label": pa.array(list(range(rows)), type=pa.int64()),
        }
    )
    return _write_parquet(table, row_group_size=row_group_size)


def _mixed_binary_parquet_bytes() -> bytes:
    """A parquet with a raw-binary PDF column, a raw-binary junk column, and text."""
    pa = pytest.importorskip("pyarrow")

    table = pa.table(
        {
            "doc": pa.array([_PDF_BYTES, _PDF_BYTES], type=pa.binary()),
            "vector": pa.array([b"\x01\x02\x03\x04", b"\x05\x06\x07\x08"], type=pa.binary()),
            "note": pa.array(["alpha", "beta"]),
        }
    )
    return _write_parquet(table)


def _ooxml_bytes(media_prefix: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr(f"{media_prefix}image1.png", _png_bytes("green"))
        archive.writestr(f"{media_prefix}image2.png", _png_bytes("blue"))
        archive.writestr(f"{media_prefix}notes.txt", b"not a file worth its own asset")
    return buffer.getvalue()


def test_has_embedded_files() -> None:
    assert has_embedded_files(_PARQUET_MIME)
    assert has_embedded_files(_XLSX_MIME)
    assert has_embedded_files("application/parquet; charset=binary")
    assert not has_embedded_files("text/csv")
    assert not has_embedded_files("image/png")


def test_is_embeddable_file_mime() -> None:
    assert is_embeddable_file_mime("image/png")
    assert is_embeddable_file_mime("application/pdf")
    assert is_embeddable_file_mime("audio/mpeg")
    # Unrecognized blobs (embedding vectors, digests) must not each become an asset.
    assert not is_embeddable_file_mime("application/octet-stream")
    assert not is_embeddable_file_mime("")
    # Text belongs to its row, so it is decoded there instead.
    assert not is_embeddable_file_mime("text/plain")
    assert not is_embeddable_file_mime("application/json")


def test_classify_embedded_mime() -> None:
    assert classify_embedded_mime("image/png") == CONTENT_FILE
    assert classify_embedded_mime("application/pdf") == CONTENT_FILE
    # A real document format the file parser can structure is worth its own asset.
    assert classify_embedded_mime("message/rfc822") == CONTENT_FILE
    assert classify_embedded_mime("text/plain") == CONTENT_TEXT
    assert classify_embedded_mime("text/html") == CONTENT_TEXT
    assert classify_embedded_mime("application/json") == CONTENT_TEXT
    assert classify_embedded_mime("application/octet-stream") == CONTENT_OPAQUE
    assert classify_embedded_mime("") == CONTENT_OPAQUE


def test_extract_embedded_bytes_struct_and_binary() -> None:
    assert extract_embedded_bytes({"bytes": b"abc", "path": None}, "struct") == b"abc"
    assert extract_embedded_bytes({"path": "x"}, "struct") is None
    assert extract_embedded_bytes(b"raw", "binary") == b"raw"
    assert extract_embedded_bytes("notbytes", "binary") is None


def test_embedded_cell_name_reads_hf_path() -> None:
    assert embedded_cell_name({"bytes": b"x", "path": "train/0001.jpg"}, "struct") == "0001.jpg"
    assert embedded_cell_name({"bytes": b"x", "path": None}, "struct") == ""
    assert embedded_cell_name(b"x", "binary") == ""


def test_iter_parquet_files_hf_struct() -> None:
    data = _hf_parquet_bytes()
    files = list(iter_embedded_files(data, _PARQUET_MIME))
    assert len(files) == 2
    assert all(isinstance(f, EmbeddedFile) for f in files)
    assert all(f.mime_type == "image/png" for f in files)
    assert files[0].location == "row=1;col=image"
    assert files[1].location == "row=2;col=image"


def test_iter_parquet_files_respects_max() -> None:
    data = _hf_parquet_bytes()
    files = list(iter_embedded_files(data, _PARQUET_MIME, max_files=1))
    assert len(files) == 1


def test_iter_parquet_files_extracts_non_image_binaries() -> None:
    """A binary column of PDFs is a file column; a column of junk blobs is not."""
    data = _mixed_binary_parquet_bytes()
    files = list(iter_embedded_files(data, _PARQUET_MIME))

    assert [f.location for f in files] == ["row=1;col=doc", "row=2;col=doc"]
    assert all(f.mime_type == "application/pdf" for f in files)


def test_parquet_row_text_uses_placeholder_not_bytes() -> None:
    from src.utils.file_parser import iter_file_pages

    data = _hf_parquet_bytes()
    pages = list(iter_file_pages(data, _PARQUET_MIME, batch_size=10))
    joined = "\n".join(pages)
    assert "<image:" in joined  # placeholder rendered
    assert "label: 0" in joined  # non-image columns preserved
    assert "\\x89PNG" not in joined and "bytes" not in joined  # no raw blob leak


def test_parquet_row_text_placeholder_names_non_image_columns() -> None:
    from src.utils.file_parser import iter_file_pages

    data = _mixed_binary_parquet_bytes()
    joined = "\n".join(iter_file_pages(data, _PARQUET_MIME, batch_size=10))
    assert "<application/pdf:" in joined
    assert "%PDF" not in joined  # the blob itself never reaches text detectors
    assert "note: alpha" in joined
    # Bytes that are neither a file nor text are summarized, never repr'd.
    assert "<binary:" in joined
    assert "\\x01" not in joined


# ── Text carried as bytes ────────────────────────────────────────────────────
#
# A cell can hold text without being a string column: a raw-binary column of JSON
# documents, or a HuggingFace struct<bytes, path> feature holding .txt files. Both
# used to reach the detectors unreadable — the first as a Python bytes repr, the
# second replaced by a placeholder and never scanned at all.

_TEXT_DOC = b"Contact Grace at grace@example.com about invoice 4471."
_JSON_DOC = b'{"name": "Ada Lovelace", "email": "ada@example.com"}'


def _single_column_parquet(name: str, value: object, arrow_type: object = None) -> bytes:
    pa = pytest.importorskip("pyarrow")

    array = pa.array([value], type=arrow_type) if arrow_type is not None else pa.array([value])
    return _write_parquet(pa.table({name: array}))


def _row_text(data: bytes) -> str:
    from src.utils.file_parser import iter_file_pages

    return "\n".join(iter_file_pages(data, _PARQUET_MIME, batch_size=10))


def test_binary_column_holding_text_is_decoded_into_the_row() -> None:
    pa = pytest.importorskip("pyarrow")

    data = _single_column_parquet("body", _TEXT_DOC, pa.binary())

    assert "body: Contact Grace at grace@example.com about invoice 4471." in _row_text(data)
    assert "b'" not in _row_text(data)  # no Python repr
    assert list(iter_embedded_files(data, _PARQUET_MIME)) == []  # stays part of its row


def test_binary_column_holding_json_is_decoded_unescaped() -> None:
    pa = pytest.importorskip("pyarrow")

    text = _row_text(_single_column_parquet("payload", _JSON_DOC, pa.binary()))

    assert '{"name": "Ada Lovelace", "email": "ada@example.com"}' in text
    assert '\\"' not in text  # quotes were escaped by the old repr rendering


def test_struct_column_holding_text_is_decoded_rather_than_hidden() -> None:
    """Regression: a struct<bytes, path> of .txt files was replaced by a placeholder,
    so its content reached no detector at all — neither as row text nor as a child."""
    data = _single_column_parquet("doc", {"bytes": _TEXT_DOC, "path": "notes/a.txt"})

    text = _row_text(data)
    assert "grace@example.com" in text
    assert "<text/plain" not in text
    assert list(iter_embedded_files(data, _PARQUET_MIME)) == []


def test_struct_column_holding_json_is_decoded() -> None:
    data = _single_column_parquet("doc", {"bytes": _JSON_DOC, "path": "notes/a.json"})

    assert "ada@example.com" in _row_text(data)


def test_multiline_text_bytes_keep_their_line_structure() -> None:
    pa = pytest.importorskip("pyarrow")

    multiline = b"Dear Grace,\n\nInvoice 4471 is overdue.\nContact ada@example.com\n"
    text = _row_text(_single_column_parquet("body", multiline, pa.binary()))

    assert "Dear Grace," in text
    assert "Invoice 4471 is overdue." in text
    assert "\\n" not in text  # newlines stayed newlines


def test_unreadable_bytes_are_not_decoded_as_text() -> None:
    """The MIME sniffer calls unplaceable bytes text/plain; decoding those would
    put a row of invisible control characters where a summary belongs."""
    pa = pytest.importorskip("pyarrow")

    text = _row_text(_single_column_parquet("vector", b"\x01\x02\x03\x04\x05\x06", pa.binary()))

    assert "<binary: 6 B>" in text


# ── Row windows ──────────────────────────────────────────────────────────────


def test_iter_parquet_files_window_bounds_rows() -> None:
    data = _hf_parquet_bytes(rows=4)

    window = list(iter_embedded_files(data, _PARQUET_MIME, start_row=1, max_rows=2))

    assert [f.location for f in window] == ["row=2;col=image", "row=3;col=image"]


def test_iter_parquet_files_window_keeps_row_numbers_absolute() -> None:
    """A child's location — and therefore its identity — must not depend on the window."""
    data = _hf_parquet_bytes(rows=4)

    whole = list(iter_embedded_files(data, _PARQUET_MIME))
    tail = list(iter_embedded_files(data, _PARQUET_MIME, start_row=2, max_rows=2))

    assert [f.location for f in tail] == [f.location for f in whole[2:]]
    assert [f.file_bytes for f in tail] == [f.file_bytes for f in whole[2:]]


def test_iter_parquet_files_window_skips_whole_row_groups() -> None:
    """Resuming mid-file must survive the row-group pushdown, not just a linear scan."""
    data = _hf_parquet_bytes(rows=4, row_group_size=1)

    window = list(iter_embedded_files(data, _PARQUET_MIME, start_row=3, max_rows=1))

    assert [f.location for f in window] == ["row=4;col=image"]


def test_iter_parquet_files_window_past_end_yields_nothing() -> None:
    data = _hf_parquet_bytes(rows=2)
    assert list(iter_embedded_files(data, _PARQUET_MIME, start_row=99, max_rows=10)) == []


def test_iter_parquet_files_consecutive_windows_cover_every_row() -> None:
    data = _hf_parquet_bytes(rows=4)

    first = list(iter_embedded_files(data, _PARQUET_MIME, start_row=0, max_rows=2))
    second = list(iter_embedded_files(data, _PARQUET_MIME, start_row=2, max_rows=2))

    locations = [f.location for f in (*first, *second)]
    assert locations == [f"row={n};col=image" for n in (1, 2, 3, 4)]
    assert len(set(locations)) == 4  # no overlap between runs


# ── OOXML ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("mime", "media_prefix"),
    [
        (_XLSX_MIME, "xl/media/"),
        (_DOCX_MIME, "word/media/"),
        (_PPTX_MIME, "ppt/media/"),
    ],
)
def test_iter_ooxml_files(mime: str, media_prefix: str) -> None:
    data = _ooxml_bytes(media_prefix)
    files = list(iter_embedded_files(data, mime))
    assert len(files) == 2  # the .txt is skipped (text belongs in the document's own text)
    assert {f.location for f in files} == {
        f"{media_prefix}image1.png",
        f"{media_prefix}image2.png",
    }
    assert all(f.mime_type == "image/png" for f in files)


def test_iter_ooxml_files_ignore_row_bounds() -> None:
    """OOXML media has no row axis, so a window must not silently drop members."""
    data = _ooxml_bytes("word/media/")
    assert len(list(iter_embedded_files(data, _DOCX_MIME, start_row=5, max_rows=1))) == 2


def test_iter_embedded_files_empty_and_unsupported() -> None:
    assert list(iter_embedded_files(b"", _PARQUET_MIME)) == []
    assert list(iter_embedded_files(b"data", "text/csv")) == []


def test_iter_ooxml_files_bad_archive() -> None:
    assert list(iter_embedded_files(b"not a zip", _XLSX_MIME)) == []
