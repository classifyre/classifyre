"""Generic text-classification detector via HuggingFace transformers pipeline."""

import logging
import re
from types import ModuleType
from typing import Any

from ...models.generated_detectors import (
    DetectorConfig,
    Severity,
    TextClassificationDetectorConfig,
    TextClassificationSeverityRule,
)
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)

_DEFAULT_SEVERITY = Severity.info


def _resolve_severity(
    label: str,
    severity_map: list[TextClassificationSeverityRule] | None,
) -> Severity:
    if not severity_map:
        return _DEFAULT_SEVERITY
    label_lower = label.lower()
    for rule in severity_map:
        try:
            if re.search(rule.pattern, label_lower, re.IGNORECASE):
                return rule.severity
        except re.error:
            if rule.pattern.lower() in label_lower:
                return rule.severity
    return _DEFAULT_SEVERITY


class TextClassificationDetector(BaseDetector):
    """
    Generic text-classification detector built on the HuggingFace transformers
    ``text-classification`` pipeline.

    Accepts any fine-tuned text classification model — a HuggingFace hub ID or an
    absolute local path. Use ``severity_map`` to map predicted labels to severity
    levels. Supports single-label (softmax) and multi-label (sigmoid) models.
    """

    detector_type = "text_classification"
    detector_name = "text_classification"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.pipeline: Any | None = None
        self._transformers: ModuleType | None = None

        self._cfg: TextClassificationDetectorConfig = (
            config
            if isinstance(config, TextClassificationDetectorConfig)
            else TextClassificationDetectorConfig()
        )
        self._model_id: str | None = self._cfg.model
        self._model_revision: str | None = self._cfg.model_revision
        self._device: str = self._cfg.device or "cpu"
        self._top_k: int | None = self._cfg.top_k
        self._function_to_apply: str | None = self._cfg.function_to_apply
        self._severity_map: list[TextClassificationSeverityRule] | None = self._cfg.severity_map

        if self._model_id is None:
            raise MissingDependencyError(
                "text_classification",
                ["content", "detectors"],
                "TextClassificationDetector requires 'model' to be set in config",
            )

        ensure_torch("text_classification", ["content", "detectors"])
        self._transformers = require_module(
            "transformers", "text_classification", ["content", "detectors"]
        )

        pipeline_kwargs: dict[str, Any] = {
            "model": self._model_id,
            "device": self._device,
        }
        if self._model_revision:
            pipeline_kwargs["revision"] = self._model_revision
        if self._top_k is not None:
            pipeline_kwargs["top_k"] = self._top_k
        if self._function_to_apply is not None:
            pipeline_kwargs["function_to_apply"] = self._function_to_apply

        self.pipeline = self._transformers.pipeline("text-classification", **pipeline_kwargs)
        logger.debug(
            "Initialized text-classification pipeline: model=%s device=%s",
            self._model_id,
            self._device,
        )

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return []
        if content_type not in self.get_supported_content_types():
            return []
        if not content.strip():
            return []

        results: list[DetectionResult] = []
        try:
            raw: list[dict[str, Any]] | list[list[dict[str, Any]]] = (
                self.pipeline(content, truncation=True) or []
            )

            # Normalise: single-label returns [{'label': ..., 'score': ...}],
            # multi-label / top_k returns [[{'label': ..., 'score': ...}, ...]]
            predictions: list[dict[str, Any]]
            if raw and isinstance(raw[0], list):
                predictions = raw[0]  # type: ignore[index]
            else:
                predictions = raw  # type: ignore[assignment]

            threshold = self._cfg.confidence_threshold or 0.7
            for pred in predictions:
                label: str = pred.get("label", "unknown")
                score: float = float(pred.get("score", 0.0))
                if score < threshold:
                    continue

                severity = _resolve_severity(label, self._severity_map)
                results.append(
                    DetectionResult(
                        detector_type=DetectorType.TEXT_CLASSIFICATION,
                        finding_type=label,
                        category="CONTENT",
                        severity=severity,
                        confidence=score,
                        matched_content=content[:512],
                        location=None,
                        metadata={
                            "model": self._model_id,
                            "predicted_label": label,
                            "score": score,
                        },
                    )
                )
        except Exception as exc:
            logger.error("text_classification error: %s", exc, exc_info=True)

        results.sort(key=lambda r: r.confidence, reverse=True)

        if self._cfg.max_findings and len(results) > self._cfg.max_findings:
            results = results[: self._cfg.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]

    def requires_gpu(self) -> bool:
        return False
