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

                detector = get_detector(detector_name, typed_config)  # type: ignore[arg-type]
                detectors.append(detector)
                logger.info(f"Initialized sandbox detector: {detector_name}")
            except Exception as e:
                logger.error(f"Failed to initialize detector {detector_type}: {e}")

        return detectors

    async def run_async(self, file_path: Path) -> tuple[ParsedFile, list[DetectionResult]]:
        """Parse the file and run all enabled detectors."""
        parsed = parse_file(file_path)

        if parsed.is_binary or not parsed.text_content.strip():
            return parsed, []

        text = parsed.text_content
        if len(text) > _CONTENT_SIZE_LIMIT:
            logger.warning(
                f"Content size ({len(text)} bytes) exceeds limit "
                f"({_CONTENT_SIZE_LIMIT} bytes); truncating."
            )
            text = text[:_CONTENT_SIZE_LIMIT]

        detectors = self._build_detectors()
        if not detectors:
            return parsed, []

        tasks = []
        active_detectors = []
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
