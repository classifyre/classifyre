"""Unit tests for embedded-image extraction from parquet and OOXML files."""

from __future__ import annotations

import io
import zipfile

import pytest

from src.utils.embedded_images import (
    EmbeddedImage,
    extract_image_bytes,
    has_embedded_images,
    iter_embedded_images,
)

_PARQUET_MIME = "application/parquet"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _png_bytes(color: str = "red") -> bytes:
    pytest.importorskip("PIL")
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _hf_parquet_bytes() -> bytes:
    """Build a parquet mimicking a HuggingFace image dataset: image struct + label."""
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")

    images = [
        {"bytes": _png_bytes("red"), "path": None},
        {"bytes": _png_bytes("blue"), "path": None},
    ]
    table = pa.table(
        {
            "image": pa.array(images),
            "label": pa.array([6, 7], type=pa.int64()),
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer)
    return buffer.getvalue()


def _ooxml_bytes(media_prefix: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr(f"{media_prefix}image1.png", _png_bytes("green"))
        archive.writestr(f"{media_prefix}image2.png", _png_bytes("blue"))
        archive.writestr(f"{media_prefix}notes.txt", b"not an image")
    return buffer.getvalue()


def test_has_embedded_images() -> None:
    assert has_embedded_images(_PARQUET_MIME)
    assert has_embedded_images(_XLSX_MIME)
    assert has_embedded_images("application/parquet; charset=binary")
    assert not has_embedded_images("text/csv")
    assert not has_embedded_images("image/png")


def test_extract_image_bytes_struct_and_binary() -> None:
    assert extract_image_bytes({"bytes": b"abc", "path": None}, "struct") == b"abc"
    assert extract_image_bytes({"path": "x"}, "struct") is None
    assert extract_image_bytes(b"raw", "binary") == b"raw"
    assert extract_image_bytes("notbytes", "binary") is None


def test_iter_parquet_images_hf_struct() -> None:
    data = _hf_parquet_bytes()
    images = list(iter_embedded_images(data, _PARQUET_MIME))
    assert len(images) == 2
    assert all(isinstance(im, EmbeddedImage) for im in images)
    assert all(im.mime_type == "image/png" for im in images)
    assert images[0].location == "row=1;col=image"
    assert images[1].location == "row=2;col=image"


def test_iter_parquet_images_respects_max() -> None:
    data = _hf_parquet_bytes()
    images = list(iter_embedded_images(data, _PARQUET_MIME, max_images=1))
    assert len(images) == 1


def test_parquet_row_text_uses_placeholder_not_bytes() -> None:
    from src.utils.file_parser import iter_file_pages

    data = _hf_parquet_bytes()
    pages = list(iter_file_pages(data, _PARQUET_MIME, batch_size=10))
    joined = "\n".join(pages)
    assert "<image:" in joined  # placeholder rendered
    assert "label: 6" in joined  # non-image columns preserved
    assert "\\x89PNG" not in joined and "bytes" not in joined  # no raw blob leak


@pytest.mark.parametrize(
    ("mime", "media_prefix"),
    [
        (_XLSX_MIME, "xl/media/"),
        (_DOCX_MIME, "word/media/"),
        (_PPTX_MIME, "ppt/media/"),
    ],
)
def test_iter_ooxml_images(mime: str, media_prefix: str) -> None:
    data = _ooxml_bytes(media_prefix)
    images = list(iter_embedded_images(data, mime))
    assert len(images) == 2  # the .txt is skipped (not image/*)
    assert {im.location for im in images} == {
        f"{media_prefix}image1.png",
        f"{media_prefix}image2.png",
    }
    assert all(im.mime_type == "image/png" for im in images)


def test_iter_embedded_images_empty_and_unsupported() -> None:
    assert list(iter_embedded_images(b"", _PARQUET_MIME)) == []
    assert list(iter_embedded_images(b"data", "text/csv")) == []


def test_iter_ooxml_images_bad_archive() -> None:
    assert list(iter_embedded_images(b"not a zip", _XLSX_MIME)) == []
