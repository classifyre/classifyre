"""Unit tests for the file→images rendering utility."""

from __future__ import annotations

import io

import pytest

from src.utils.file_to_images import render_to_images, supported_mime_type


def _png_bytes(width: int = 4000, height: int = 100, color: str = "red") -> bytes:
    pytest.importorskip("PIL")
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _read_png(data: bytes):
    from PIL import Image

    return Image.open(io.BytesIO(data))


def test_supported_mime_type() -> None:
    assert supported_mime_type("image/png")
    assert supported_mime_type("application/pdf")
    assert supported_mime_type("image/jpeg; charset=binary")
    assert not supported_mime_type("audio/mpeg")
    assert not supported_mime_type("text/plain")


def test_empty_bytes_returns_empty() -> None:
    assert render_to_images(b"", "image/png") == []


def test_unsupported_mime_returns_empty() -> None:
    assert render_to_images(b"data", "application/octet-stream") == []


def test_image_passthrough_and_downscale() -> None:
    pytest.importorskip("PIL")
    images = render_to_images(_png_bytes(width=4000, height=100), "image/png", max_dim=2000)
    assert len(images) == 1
    img = _read_png(images[0])
    assert img.mode == "RGB"
    # Largest dimension was 4000, capped to 2000.
    assert max(img.size) == 2000


def test_image_below_max_dim_not_upscaled() -> None:
    pytest.importorskip("PIL")
    images = render_to_images(_png_bytes(width=300, height=200), "image/png", max_dim=2000)
    assert len(images) == 1
    assert _read_png(images[0]).size == (300, 200)


def test_pdf_renders_one_png_per_page() -> None:
    pdfium = pytest.importorskip("pypdfium2")

    pdf = pdfium.PdfDocument.new()
    try:
        # pypdfium2 page dimensions are in points (1/72 inch).
        pdf.new_page(200, 200)
        pdf.new_page(200, 200)
        pdf.new_page(200, 200)
        buffer = io.BytesIO()
        pdf.save(buffer)
        pdf_bytes = buffer.getvalue()
    finally:
        pdf.close()

    images = render_to_images(pdf_bytes, "application/pdf")
    assert len(images) == 3
    assert all(_read_png(png).mode == "RGB" for png in images)


def test_pdf_page_cap_respected() -> None:
    pdfium = pytest.importorskip("pypdfium2")

    pdf = pdfium.PdfDocument.new()
    try:
        for _ in range(5):
            pdf.new_page(100, 100)
        buffer = io.BytesIO()
        pdf.save(buffer)
        pdf_bytes = buffer.getvalue()
    finally:
        pdf.close()

    images = render_to_images(pdf_bytes, "application/pdf", max_pages=2)
    assert len(images) == 2


def test_corrupt_pdf_returns_empty() -> None:
    pytest.importorskip("pypdfium2")
    assert render_to_images(b"%PDF-1.4 not really a pdf", "application/pdf") == []
