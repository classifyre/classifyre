"""Language detector using fast-langdetect."""

import logging
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)


class LanguageDetector(BaseDetector):
    """Detect dominant text language with `fast-langdetect`."""

    detector_type = "language"
    detector_name = "language"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        self._detector_module: Any | None = None

        try:
            self._detector_module = require_module(
                "fast_langdetect",
                "language",
                ["quality", "detectors"],
            )
        except MissingDependencyError:
            raise

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content.strip():
            return []

        if self._detector_module is None:
            return []

        try:
            raw = self._detector_module.detect(content)
        except Exception as exc:
            logger.error(f"Language detection failed: {exc}")
            return []

        if not isinstance(raw, dict):
            return []

        language = str(raw.get("lang", "unknown"))
        score = float(raw.get("score", 0.0))
        threshold = self.config.confidence_threshold or 0.7
        if score < threshold:
            return []

        result = DetectionResult(
            detector_type=DetectorType.LANGUAGE,
            finding_type=f"language:{language}",
            category="QUALITY",
            severity=Severity.info,
            confidence=score,
            matched_content=content[:256],
            location=None,
            metadata={
                "model": "fast-langdetect",
                "language": language,
                "raw": raw,
            },
        )

        return [result]

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]
