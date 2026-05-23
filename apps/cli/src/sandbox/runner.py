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

_CONTENT_SIZE_LIMIT = 1_048_576  # 1 MB


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

        if parsed.is_binary:
            raw_bytes = file_path.read_bytes()
            mime_type = parsed.mime_type
            if len(raw_bytes) > _CONTENT_SIZE_LIMIT:
                logger.warning(
                    f"Binary content ({len(raw_bytes)} bytes) exceeds limit "
                    f"({_CONTENT_SIZE_LIMIT} bytes); truncating."
                )
                raw_bytes = raw_bytes[:_CONTENT_SIZE_LIMIT]
            for detector in detectors:
                if self._is_binary_detector(detector) and self._supports_mime(
                    detector.get_supported_content_types(), mime_type
                ):
                    tasks.append(detector.detect(raw_bytes, mime_type))
                    active_detectors.append(detector)
        else:
            if parsed.parse_error:
                logger.warning(
                    "Text extraction failed (%s): %s", parsed.mime_type, parsed.parse_error
                )
            text = parsed.text_content
            if not text.strip():
                logger.warning(
                    "No text content extracted from %s file; skipping text detectors.",
                    parsed.mime_type,
                )
                return parsed, []
            if len(text) > _CONTENT_SIZE_LIMIT:
                logger.warning(
                    f"Content size ({len(text)} bytes) exceeds limit "
                    f"({_CONTENT_SIZE_LIMIT} bytes); truncating."
                )
                text = text[:_CONTENT_SIZE_LIMIT]
            for detector in detectors:
                supported = detector.get_supported_content_types()
                if "text/plain" in supported:
                    tasks.append(detector.detect(text, "text/plain"))
                    active_detectors.append(detector)

        if not tasks:
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
