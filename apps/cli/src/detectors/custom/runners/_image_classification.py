"""Image classification pipeline runner."""

from __future__ import annotations

import logging
from typing import Any

from ....models.generated_detectors import ImageClassificationPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult
from ...dependencies import ensure_torch, require_module
from ._base import (
    _DEFAULT_IMAGE_CLASSIFICATION_MODEL,
    _IMAGE_INPUT_CONTENT_TYPES,
    BaseRunner,
    _load_input_images,
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
        self._model_id = schema.model or _DEFAULT_IMAGE_CLASSIFICATION_MODEL
        # Model loading is deferred to first detect() so the parent process
        # (which only routes when a worker pool is active) never pays the
        # torch import + model memory cost.
        self._pipe: Any | None = None
        self._pil: Any | None = None
        self._load_error: str | None = None

    def _ensure_pipeline(self) -> Any | None:
        if self._pipe is not None:
            return self._pipe
        if self._load_error is not None:
            return None
        schema = self._schema
        try:
            ensure_torch("image_classification", ["custom", "detectors"])
            transformers = require_module(
                "transformers", "image_classification", ["custom", "detectors"]
            )
            self._pil = require_module("PIL.Image", "image_classification", ["custom", "detectors"])
            pipeline_kwargs: dict[str, Any] = {
                "model": self._model_id,
                "device": schema.device or "cpu",
            }
            if schema.model_revision:
                pipeline_kwargs["revision"] = schema.model_revision
            if schema.top_k is not None:
                pipeline_kwargs["top_k"] = schema.top_k
            if schema.function_to_apply is not None:
                pipeline_kwargs["function_to_apply"] = str(schema.function_to_apply)
            self._pipe = transformers.pipeline("image-classification", **pipeline_kwargs)
            return self._pipe
        except Exception as exc:
            # Raise on the first failure so the scan records one structured
            # error; later assets skip quietly via the cached _load_error.
            self._load_error = str(exc)
            raise RuntimeError(
                f"image_classification model '{self._model_id}' failed to load for "
                f"detector '{self._detector_key}': {exc}"
            ) from exc

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("ImageClassificationRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, str):
            logger.warning("image_classification: received string content, expected bytes")
            return []

        pipe = self._ensure_pipeline()
        if pipe is None:
            return []

        # image/* opens directly; PDFs are rasterised to one image per page.
        images = _load_input_images(content, content_type, self._pil)
        if not images:
            return []

        schema = self._schema
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.0
        multi_page = len(images) > 1
        results: list[DetectionResult] = []
        for page_index, image in images:
            try:
                predictions: list[dict[str, Any]] = pipe(image) or []
                for pred in predictions:
                    label: str = pred.get("label", "unknown")
                    score: float = float(pred.get("score", 0.0))
                    if score < threshold:
                        continue
                    severity = _resolve_pipeline_severity(label, schema.severity_map)
                    page_suffix = f" (page {page_index + 1})" if multi_page else ""
                    metadata: dict[str, Any] = {
                        "image_size": f"{image.size[0]}x{image.size[1]}",
                        "image_mode": image.mode,
                        "model": self._model_id,
                    }
                    if multi_page:
                        metadata["page"] = page_index + 1
                    results.append(
                        self._make_result(
                            finding_type=f"classification:{label}",
                            category="CONTENT",
                            severity=severity,
                            confidence=score,
                            matched_content=(
                                f"Image classified as: {label} ({score:.3f}){page_suffix}"
                            ),
                            location=None,
                            metadata=metadata,
                        )
                    )
            except Exception as exc:
                logger.error(
                    "image_classification error (model=%s): %s", self._model_id, exc, exc_info=True
                )
        results.sort(key=lambda r: r.confidence, reverse=True)
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_IMAGE_INPUT_CONTENT_TYPES)
