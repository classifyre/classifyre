"""SandboxRunner: run detectors on a local file."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..models.generated_single_asset_scan_results import DetectionResult
from ..utils.file_parser import ParsedFile, parse_file

logger = logging.getLogger(__name__)


class SandboxRunner:
    """Run a set of detectors against a single local file."""

    def __init__(self, detectors_config: list[dict[str, Any]]) -> None:
        self._config = detectors_config

    def _build_detectors(self) -> list[Any]:
        from ..detectors import get_detector
        from ..detectors.config import parse_detector_config

        detectors = []
        for item in self._config:
            if not item.get("enabled", True):
                continue

            detector_type = item.get("type", "").upper()
            raw_config = item.get("config", {})

            try:
                detector_name, typed_config = parse_detector_config(
                    detector_type=detector_type,
                    raw_config=raw_config,
                )

                detector = get_detector(detector_name, typed_config)
                detectors.append(detector)
                logger.info(f"Initialized sandbox detector: {detector_name}")
            except Exception as e:
                logger.error(f"Failed to initialize detector {detector_type}: {e}")

        return detectors

    @staticmethod
    def _is_binary_detector(detector: Any) -> bool:
        for ct in detector.get_supported_content_types():
            if ct.startswith(("image/", "audio/", "video/")) or ct == "application/octet-stream":
                return True
        return False

    @staticmethod
    def _is_file_mime(mime_type: str) -> bool:
        """MIME types that should be delivered to a detector as raw bytes.

        Includes images/audio/video, generic binary, and PDFs. PDFs are *not*
        ``is_binary`` (they have a text layer) but a file-capable detector — e.g.
        a vision LLM detector — needs the original bytes to render page images,
        so route them through the byte path too.
        """
        return mime_type.startswith(("image/", "audio/", "video/")) or mime_type in (
            "application/pdf",
            "application/octet-stream",
        )

    @staticmethod
    def _supports_mime(supported: list[str], mime_type: str) -> bool:
        if mime_type in supported:
            return True
        for s in supported:
            if s.endswith("/*") and mime_type.startswith(s[:-1]):
                return True
        return False

    async def run_async(self, file_path: Path) -> tuple[ParsedFile, list[DetectionResult]]:
        """Parse the file and run all enabled detectors."""
        parsed = parse_file(file_path)

        detectors = self._build_detectors()
        if not detectors:
            return parsed, []

        tasks = []
        active_detectors = []

        mime_type = parsed.mime_type
        file_mime = self._is_file_mime(mime_type)

        # Content is delivered whole — never truncated. Truncation corrupts
        # binary files (images/PDFs) and drops potentially-important text, and
        # capacity is an instance concern: if a file is too large the worker is
        # OOM-killed and the failure is surfaced to the user, rather than silently
        # scanning partial content.
        raw_bytes: bytes | None = None

        def _get_raw_bytes() -> bytes:
            nonlocal raw_bytes
            if raw_bytes is None:
                raw_bytes = file_path.read_bytes()
            return raw_bytes

        if parsed.parse_error:
            logger.warning("Text extraction failed (%s): %s", mime_type, parsed.parse_error)

        text = parsed.text_content

        for detector in detectors:
            supported = detector.get_supported_content_types()
            # File/binary delivery: a file-capable detector (e.g. vision LLM,
            # image classifier) that supports this file's MIME gets raw bytes —
            # even for PDFs, which are not ``is_binary`` but still need the
            # original file to render page images.
            if (
                file_mime
                and self._is_binary_detector(detector)
                and self._supports_mime(supported, mime_type)
            ):
                tasks.append(detector.detect(_get_raw_bytes(), mime_type))
                active_detectors.append(detector)
            # Text delivery: text detectors get the extracted text layer.
            elif "text/plain" in supported and text.strip():
                tasks.append(detector.detect(text, "text/plain"))
                active_detectors.append(detector)

        if not tasks:
            if not text.strip() and not file_mime:
                logger.warning(
                    "No text content extracted from %s file; skipping text detectors.",
                    mime_type,
                )
            return parsed, []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_findings: list[DetectionResult] = []
        detected_at = datetime.now(UTC)

        for detector, result in zip(active_detectors, results, strict=False):
            if isinstance(result, Exception):
                logger.error(f"Detector {detector.__class__.__name__} failed: {result}")
                continue
            if isinstance(result, list):
                for finding in result:
                    if isinstance(finding, DetectionResult):
                        all_findings.append(
                            finding.model_copy(
                                update={
                                    "runner_id": "sandbox",
                                    "detected_at": detected_at,
                                }
                            )
                        )

        return parsed, all_findings

    def run(self, file_path: Path) -> tuple[ParsedFile, list[DetectionResult]]:
        """Synchronous wrapper around run_async."""
        return asyncio.run(self.run_async(file_path))
