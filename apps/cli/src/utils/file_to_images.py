"""Render supported files (images, PDFs) to PNG image bytes.

Reusable helper for any detector that needs to feed visual content to a model
that only accepts images — e.g. a vision-capable LLM detector or a HuggingFace
image classifier. Images are normalized/downscaled; PDFs are rasterised page by
page with pypdfium2 (a permissive, self-contained wheel — no system binaries).

On any missing optional dependency or conversion failure the functions log a
warning and return an empty list, so callers can fall back gracefully.
"""

from __future__ import annotations

import io
import logging

from ..detectors.dependencies import MissingDependencyError, require_module
from .file_parser import _normalize_mime_type

logger = logging.getLogger(__name__)

# Image MIME types we can rasterise. Mirrors _IMAGE_CONTENT_TYPES in the runner
# base module but kept local so this utility has no detector dependencies.
_SUPPORTED_IMAGE_MIME_TYPES = frozenset(
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
    }
)
_PDF_MIME_TYPE = "application/pdf"

# uv groups that provide the rendering dependencies (pillow + pypdfium2).
_RENDER_UV_GROUPS = ["llm", "custom", "detectors"]


def supported_mime_type(mime_type: str) -> bool:
    """Return True if render_to_images() can rasterise this MIME type."""
    normalized = _normalize_mime_type(mime_type)
    return normalized in _SUPPORTED_IMAGE_MIME_TYPES or normalized == _PDF_MIME_TYPE


def render_to_images(
    file_bytes: bytes,
    mime_type: str,
    *,
    file_name: str = "",
    max_pages: int = 20,
    max_dim: int = 2000,
) -> list[bytes]:
    """Render *file_bytes* to a list of PNG image byte blobs.

    Images yield a single normalized PNG; PDFs yield one PNG per page (capped at
    ``max_pages``). Unsupported types, missing dependencies, and conversion
    errors all return ``[]`` (logged), never raise.
    """
    if not file_bytes:
        return []

    normalized = _normalize_mime_type(mime_type)
    try:
        if normalized in _SUPPORTED_IMAGE_MIME_TYPES:
            return _render_image(file_bytes, max_dim=max_dim)
        if normalized == _PDF_MIME_TYPE:
            return _render_pdf(file_bytes, max_pages=max_pages, max_dim=max_dim)
    except MissingDependencyError as exc:
        logger.warning(
            "Cannot render %s to images — missing dependency: %s",
            file_name or normalized,
            exc,
        )
        return []
    except Exception as exc:
        logger.warning(
            "Failed to render %s (%s) to images: %s",
            file_name or normalized,
            normalized,
            exc,
        )
        return []

    return []


def _require_pil() -> object:
    return require_module("PIL.Image", "file image rendering", _RENDER_UV_GROUPS)


def _downscale_to_png(image: object, max_dim: int) -> bytes:
    """Convert a PIL image to RGB, downscale to fit max_dim, encode as PNG."""
    pil = _require_pil()
    rgb = image.convert("RGB") if image.mode != "RGB" else image  # type: ignore[attr-defined]
    width, height = rgb.size  # type: ignore[attr-defined]
    largest = max(width, height)
    if max_dim > 0 and largest > max_dim:
        scale = max_dim / largest
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        rgb = rgb.resize(new_size, pil.Resampling.LANCZOS)  # type: ignore[attr-defined]
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG")  # type: ignore[attr-defined]
    return buffer.getvalue()


def _render_image(file_bytes: bytes, *, max_dim: int) -> list[bytes]:
    pil = _require_pil()
    with pil.open(io.BytesIO(file_bytes)) as image:  # type: ignore[attr-defined]
        return [_downscale_to_png(image, max_dim)]


def _render_pdf(file_bytes: bytes, *, max_pages: int, max_dim: int) -> list[bytes]:
    pdfium = require_module("pypdfium2", "file image rendering", _RENDER_UV_GROUPS)
    images: list[bytes] = []
    pdf = pdfium.PdfDocument(file_bytes)  # type: ignore[attr-defined]
    try:
        page_count = len(pdf)
        limit = min(page_count, max_pages) if max_pages > 0 else page_count
        for page_index in range(limit):
            page = pdf[page_index]
            try:
                # scale=2.0 renders at ~144 DPI; _downscale_to_png caps the result.
                bitmap = page.render(scale=2.0)
                pil_image = bitmap.to_pil()
                images.append(_downscale_to_png(pil_image, max_dim))
            finally:
                page.close()
        if page_count > limit:
            logger.info("PDF has %d pages; rendered first %d for vision input", page_count, limit)
    finally:
        pdf.close()
    return images
