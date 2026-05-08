"""Generic image-classification detector via HuggingFace transformers pipeline."""

import io
import logging
import re
from types import ModuleType
from typing import Any

from ...models.generated_detectors import (
    DetectorConfig,
    ImageClassificationDetectorConfig,
    ImageClassificationSeverityRule,
    Severity,
)
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "google/vit-base-patch16-224"
_DEFAULT_SEVERITY = Severity.info


def _resolve_severity(
    label: str,
    severity_map: list[ImageClassificationSeverityRule] | None,
) -> Severity:
    """Return the first severity whose pattern matches label (case-insensitive substring)."""
    if not severity_map:
        return _DEFAULT_SEVERITY
    label_lower = label.lower()
    for rule in severity_map:
        try:
            if re.search(rule.pattern, label_lower, re.IGNORECASE):
                return rule.severity
        except re.error:
            # fall back to plain substring match on bad regex
            if rule.pattern.lower() in label_lower:
                return rule.severity
    return _DEFAULT_SEVERITY


class ImageClassificationDetector(BaseDetector):
    """
    Generic image-classification detector built on the HuggingFace transformers
    ``image-classification`` pipeline.

    Accepts any vision model — a HuggingFace hub ID *or* an absolute local path.
    Predicted labels are mapped to severity levels via ``severity_map`` rules.
    CPU is used by default; configure ``device`` for GPU inference.
    """

    detector_type = "image_classification"
    detector_name = "image_classification"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.pipeline: Any | None = None
        self._image_module: ModuleType | None = None

        self._img_cfg: ImageClassificationDetectorConfig = (
            config if isinstance(config, ImageClassificationDetectorConfig)
            else ImageClassificationDetectorConfig()
        )
        self._model_id: str = self._img_cfg.model or _DEFAULT_MODEL
        self._model_revision: str | None = self._img_cfg.model_revision
        self._device: str = self._img_cfg.device or "cpu"
        self._top_k: int | None = self._img_cfg.top_k
        self._function_to_apply: str | None = self._img_cfg.function_to_apply
        self._severity_map: list[ImageClassificationSeverityRule] | None = self._img_cfg.severity_map

        ensure_torch("image_classification", ["content", "detectors"])
        transformers = require_module("transformers", "image_classification", ["content", "detectors"])
        self._image_module = require_module("PIL.Image", "image_classification", ["content", "detectors"])

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

        self.pipeline = transformers.pipeline("image-classification", **pipeline_kwargs)
        logger.debug(
            "Initialized image-classification pipeline: model=%s device=%s",
            self._model_id,
            self._device,
        )

    async def detect(
        self, content: str | bytes, content_type: str = "image/jpeg"
    ) -> list[DetectionResult]:
        if not content_type.startswith("image/"):
            logger.debug("image_classification: skipping non-image content_type=%s", content_type)
            return []

        if isinstance(content, str):
            logger.warning("image_classification: received string content, expected bytes")
            return []

        results: list[DetectionResult] = []
        try:
            if self._image_module is None:
                raise RuntimeError("PIL.Image was not initialised")
            image = self._image_module.open(io.BytesIO(content))

            predictions: list[dict[str, Any]] = self.pipeline(image) or []

            threshold = self._img_cfg.confidence_threshold or 0.0
            for pred in predictions:
                label: str = pred.get("label", "unknown")
                score: float = float(pred.get("score", 0.0))
                if score < threshold:
                    continue

                severity = _resolve_severity(label, self._severity_map)
                results.append(
                    DetectionResult(
                        detector_type=DetectorType.IMAGE_CLASSIFICATION,
                        finding_type=label,
                        category="CONTENT",
                        severity=severity,
                        confidence=score,
                        matched_content=f"Image classified as: {label} ({score:.3f})",
                        location=None,
                        metadata={
                            "image_size": f"{image.size[0]}x{image.size[1]}",
                            "image_mode": image.mode,
                            "model": self._model_id,
                        },
                    )
                )
        except Exception as exc:
            logger.error("image_classification error: %s", exc, exc_info=True)

        results.sort(key=lambda r: r.confidence, reverse=True)

        if self._img_cfg.max_findings and len(results) > self._img_cfg.max_findings:
            results = results[: self._img_cfg.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        return [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/bmp",
            "image/tiff",
        ]

    def requires_gpu(self) -> bool:
        return False
