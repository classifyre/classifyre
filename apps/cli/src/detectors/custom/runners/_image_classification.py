"""Image classification pipeline runner."""

from __future__ import annotations

import io
import logging
from typing import Any

from ....models.generated_detectors import ImageClassificationPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult
from ...dependencies import ensure_torch, require_module
from ._base import (
    _DEFAULT_IMAGE_CLASSIFICATION_MODEL,
    _IMAGE_CONTENT_TYPES,
    BaseRunner,
    _resolve_pipeline_severity,
)

logger = logging.getLogger(__name__)


class ImageClassificationRunner(BaseRunner):
    """Image classification via a single HuggingFace image-classification pipeline."""

    def __init__(
        self,
        schema: ImageClassificationPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        ensure_torch("image_classification", ["custom", "detectors"])
        transformers = require_module(
            "transformers", "image_classification", ["custom", "detectors"]
        )
        self._pil = require_module("PIL.Image", "image_classification", ["custom", "detectors"])
        model_id = schema.model or _DEFAULT_IMAGE_CLASSIFICATION_MODEL
        pipeline_kwargs: dict[str, Any] = {
            "model": model_id,
            "device": schema.device or "cpu",
        }
        if schema.model_revision:
            pipeline_kwargs["revision"] = schema.model_revision
        if schema.top_k is not None:
            pipeline_kwargs["top_k"] = schema.top_k
        if schema.function_to_apply is not None:
            pipeline_kwargs["function_to_apply"] = str(schema.function_to_apply)
        self._pipe: Any = transformers.pipeline("image-classification", **pipeline_kwargs)
        self._model_id = model_id

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("ImageClassificationRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if not content_type.startswith("image/"):
            return []
        if isinstance(content, str):
            logger.warning("image_classification: received string content, expected bytes")
            return []

        schema = self._schema
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.0
        results: list[DetectionResult] = []
        try:
            image = self._pil.open(io.BytesIO(content))
            predictions: list[dict[str, Any]] = self._pipe(image) or []
            for pred in predictions:
                label: str = pred.get("label", "unknown")
                score: float = float(pred.get("score", 0.0))
                if score < threshold:
                    continue
                severity = _resolve_pipeline_severity(label, schema.severity_map)
                results.append(
                    self._make_result(
                        finding_type=f"classification:{label}",
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
            logger.error(
                "image_classification error (model=%s): %s", self._model_id, exc, exc_info=True
            )
        results.sort(key=lambda r: r.confidence, reverse=True)
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_IMAGE_CONTENT_TYPES)
