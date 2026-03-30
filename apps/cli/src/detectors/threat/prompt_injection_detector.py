"""Prompt injection detector using ProtectAI DeBERTa model."""

import logging
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class PromptInjectionDetector(BaseDetector):
    """Detect prompt injection with `protectai/deberta-v3-base-prompt-injection-v2`."""

    detector_type = "prompt_injection"
    detector_name = "prompt_injection"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        self.classifier: Any | None = None
        self._transformers: Any | None = None
        self._model_id = "protectai/deberta-v3-base-prompt-injection-v2"
        self._max_length = 512

        try:
            ensure_torch("prompt_injection", ["security", "detectors"])
            self._transformers = require_module(
                "transformers",
                "prompt_injection",
                ["security", "detectors"],
            )
        except MissingDependencyError:
            raise

    def _ensure_classifier(self) -> None:
        """Lazy-load model to avoid heavyweight startup and test downloads."""
        if self.classifier is not None:
            return
        if self._transformers is None:
            raise RuntimeError("Transformers module is not initialized")

        self.classifier = self._transformers.pipeline(
            "text-classification",
            model=self._model_id,
            device=-1,
            truncation=True,
            max_length=self._max_length,
        )

    def _predict(self, content: str) -> list[dict[str, Any]]:
        self._ensure_classifier()

        try:
            raw = self.classifier(
                content,
                top_k=None,
                truncation=True,
                max_length=self._max_length,
            )
        except TypeError:
            raw = self.classifier(
                content,
                return_all_scores=True,
                truncation=True,
                max_length=self._max_length,
            )

        if isinstance(raw, list) and raw and isinstance(raw[0], list):
            return raw[0]
        if isinstance(raw, list) and raw and isinstance(raw[0], dict):
            return raw
        if isinstance(raw, dict):
            return [raw]
        return []

    @staticmethod
    def _is_injection_label(label: str) -> bool:
        normalized = label.upper()
        return "INJECTION" in normalized

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        if not content:
            return []

        try:
            predictions = self._predict(content)
            if not predictions:
                return []
        except Exception as exc:
            logger.error(f"Prompt injection model inference failed: {exc}")
            return []

        threshold = self.config.confidence_threshold or 0.7
        ranked = sorted(predictions, key=lambda item: float(item.get("score", 0.0)), reverse=True)

        for candidate in ranked:
            label = str(candidate.get("label", "UNKNOWN"))
            score = float(candidate.get("score", 0.0))
            if not self._is_injection_label(label) or score < threshold:
                continue

            return [
                DetectionResult(
                    detector_type=DetectorType.PROMPT_INJECTION,
                    finding_type="prompt_injection",
                    category="SECURITY",
                    severity=Severity.critical,
                    confidence=score,
                    matched_content=content,
                    location=None,
                    metadata={
                        "model": self._model_id,
                        "predicted_label": label,
                        "scores": ranked[:3],
                    },
                )
            ]

        return []

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]
