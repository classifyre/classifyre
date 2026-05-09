"""Language detector using fast-langdetect."""

import logging
from typing import Any

from ...models.generated_detectors import DetectorConfig, LanguageDetectorConfig, Model, Severity
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
        self._cfg: LanguageDetectorConfig = (
            config if isinstance(config, LanguageDetectorConfig) else LanguageDetectorConfig()
        )
        self._detector_module: Any | None = None

        try:
            self._detector_module = require_module(
                "fast_langdetect",
                "language",
                ["quality", "detectors"],
            )
        except MissingDependencyError:
            raise

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return []
        if not content.strip():
            return []

        if self._detector_module is None:
            return []

        model_val = self._cfg.model or Model.auto
        model = model_val.value if isinstance(model_val, Model) else str(model_val)
        k = self._cfg.k or 1
        threshold = self._cfg.confidence_threshold or 0.7

        try:
            candidates: list[dict[str, Any]] = self._detector_module.detect(
                content, model=model, k=k
            )
        except Exception as exc:
            logger.error(f"Language detection failed: {exc}")
            return []

        if not isinstance(candidates, list):
            return []

        results: list[DetectionResult] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            language = str(candidate.get("lang", "unknown"))
            score = float(candidate.get("score", 0.0))
            if score < threshold:
                continue
            results.append(
                DetectionResult(
                    detector_type=DetectorType.LANGUAGE,
                    finding_type=f"language:{language}",
                    category="QUALITY",
                    severity=Severity.info,
                    confidence=score,
                    matched_content=content[:256],
                    location=None,
                    metadata={
                        "model": model,
                        "language": language,
                        "raw": candidate,
                    },
                )
            )

        return results

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]
