"""Routing tests for SandboxRunner.

Verifies that file-capable detectors (e.g. a vision LLM detector) receive raw
bytes for images AND PDFs, while text detectors receive extracted text — without
needing any optional ML/LLM dependencies (a fake detector records what it got).
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest

from src.sandbox.runner import SandboxRunner


class _RecordingDetector:
    """Stand-in detector that records the (content, content_type) it received."""

    def __init__(self, supported: list[str]) -> None:
        self._supported = supported
        self.calls: list[tuple[Any, str]] = []

    def get_supported_content_types(self) -> list[str]:
        return list(self._supported)

    async def detect(self, content: Any, content_type: str) -> list:
        self.calls.append((content, content_type))
        return []


_VISION_TYPES = [
    "text/plain",
    "image/png",
    "image/jpeg",
    "application/pdf",
]
_TEXT_TYPES = ["text/plain", "text/html"]


def _runner_with(detector: _RecordingDetector) -> SandboxRunner:
    runner = SandboxRunner([])
    runner._build_detectors = lambda: [detector]  # type: ignore[method-assign]
    return runner


def _write_png(path: Path) -> None:
    pytest.importorskip("PIL")
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    path.write_bytes(buf.getvalue())


def _write_pdf(path: Path) -> None:
    pdfium = pytest.importorskip("pypdfium2")
    pdf = pdfium.PdfDocument.new()
    try:
        pdf.new_page(100, 100)
        buf = io.BytesIO()
        pdf.save(buf)
        path.write_bytes(buf.getvalue())
    finally:
        pdf.close()


class _FindingImageDetector:
    """Image detector that returns one finding per call, recording inputs."""

    def __init__(self) -> None:
        self.calls: list[tuple[Any, str]] = []

    def get_supported_content_types(self) -> list[str]:
        return ["image/png", "image/jpeg", "image/tiff"]

    async def detect(self, content: Any, content_type: str) -> list:
        from src.models.generated_single_asset_scan_results import (
            DetectionResult,
            DetectorType,
            Severity,
        )

        self.calls.append((content, content_type))
        return [
            DetectionResult(
                detector_type=DetectorType.CUSTOM,
                finding_type="classification:cat",
                category="CONTENT",
                severity=Severity.info,
                confidence=0.9,
                matched_content="cat",
            )
        ]


def _write_hf_parquet(path: Path) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    pytest.importorskip("PIL")
    from PIL import Image

    def _png(color: str) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), color).save(buf, format="PNG")
        return buf.getvalue()

    table = pa.table(
        {
            "image": pa.array(
                [{"bytes": _png("red"), "path": None}, {"bytes": _png("blue"), "path": None}]
            ),
            "label": pa.array([1, 2], type=pa.int64()),
        }
    )
    pq.write_table(table, path)


def test_parquet_embedded_images_go_to_image_detector(tmp_path: Path) -> None:
    parquet = tmp_path / "dataset.parquet"
    _write_hf_parquet(parquet)
    det = _FindingImageDetector()

    _parsed, findings = _runner_with(det).run(parquet)

    # One call per embedded image, each receiving decoded image bytes.
    assert len(det.calls) == 2
    for content, content_type in det.calls:
        assert isinstance(content, bytes)
        assert content_type == "image/png"
    # Findings are tagged with the embedded-image location for grouping.
    assert len(findings) == 2
    locations = {f.metadata.get("embedded_location") for f in findings}
    assert locations == {"row=1;col=image", "row=2;col=image"}
    assert all(f.location and f.location.path for f in findings)


def test_image_goes_to_vision_detector_as_bytes(tmp_path: Path) -> None:
    img = tmp_path / "invoice.png"
    _write_png(img)
    det = _RecordingDetector(_VISION_TYPES)

    _runner_with(det).run(img)

    assert len(det.calls) == 1
    content, content_type = det.calls[0]
    assert isinstance(content, bytes)
    assert content_type == "image/png"


def test_pdf_goes_to_vision_detector_as_bytes(tmp_path: Path) -> None:
    pdf = tmp_path / "invoice.pdf"
    _write_pdf(pdf)
    det = _RecordingDetector(_VISION_TYPES)

    _runner_with(det).run(pdf)

    # The key fix: a PDF (not ``is_binary``) still reaches a file-capable
    # detector as raw bytes, not as extracted text.
    assert len(det.calls) == 1
    content, content_type = det.calls[0]
    assert isinstance(content, bytes)
    assert content_type == "application/pdf"


def test_large_image_not_truncated(tmp_path: Path) -> None:
    pytest.importorskip("PIL")
    from PIL import Image

    # A noisy image that encodes to > 1 MB so it would trip the old text cap.
    img_path = tmp_path / "big.png"
    Image.effect_noise((1400, 1400), 120).convert("RGB").save(img_path, format="PNG")
    size = img_path.stat().st_size
    assert size > 1_048_576, f"fixture not large enough ({size} bytes)"

    det = _RecordingDetector(_VISION_TYPES)
    _runner_with(det).run(img_path)

    assert len(det.calls) == 1
    content, _ = det.calls[0]
    assert isinstance(content, bytes)
    # Whole file delivered — not truncated.
    assert len(content) == size
    # And it's still a decodable image.
    Image.open(io.BytesIO(content)).verify()


def test_text_detector_gets_text_not_bytes(tmp_path: Path) -> None:
    txt = tmp_path / "notes.txt"
    txt.write_text("hello world contact me at a@b.com")
    det = _RecordingDetector(_TEXT_TYPES)

    _runner_with(det).run(txt)

    assert len(det.calls) == 1
    content, content_type = det.calls[0]
    assert isinstance(content, str)
    assert content_type == "text/plain"


def test_pdf_with_text_only_detector_gets_text(tmp_path: Path) -> None:
    pytest.importorskip("pdfplumber")
    pdf = tmp_path / "invoice.pdf"
    _write_pdf(pdf)
    det = _RecordingDetector(_TEXT_TYPES)  # not a file/binary detector

    _runner_with(det).run(pdf)

    # A text-only detector should not receive PDF bytes; it only runs if a text
    # layer was extracted. The blank test PDF has no text, so no call is made.
    for content, _ in det.calls:
        assert isinstance(content, str)
