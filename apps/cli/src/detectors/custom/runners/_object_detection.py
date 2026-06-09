"""Object detection pipeline runner."""

from __future__ import annotations

import logging
from typing import Any

from ....models.generated_detectors import ObjectDetectionPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult, Location
from ...dependencies import MissingDependencyError, ensure_torch, require_module
from ._base import (
    _IMAGE_INPUT_CONTENT_TYPES,
    BaseRunner,
    _load_input_images,
    _resolve_pipeline_severity,
)

logger = logging.getLogger(__name__)


class ObjectDetectionRunner(BaseRunner):
    """Object detection via a single HuggingFace object-detection pipeline."""

    def __init__(
        self,
        schema: ObjectDetectionPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        ensure_torch("object_detection", ["custom", "detectors"])
        transformers = require_module("transformers", "object_detection", ["custom", "detectors"])
        self._pil = require_module("PIL.Image", "object_detection", ["custom", "detectors"])
        pipeline_kwargs: dict[str, Any] = {
            "model": schema.model,
            "device": schema.device or "cpu",
        }
        if schema.model_revision:
            pipeline_kwargs["revision"] = schema.model_revision
        nms = getattr(schema.nms_threshold, "root", schema.nms_threshold)
        if nms is not None:
            pipeline_kwargs["threshold"] = nms
        try:
            self._pipe: Any = transformers.pipeline("object-detection", **pipeline_kwargs)
        except ImportError as exc:
            raise MissingDependencyError(
                "object_detection",
                ["custom", "detectors"],
                ["custom", "detectors"],
                f"ObjectDetectionRunner requires additional dependencies: {exc}",
            ) from exc

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("ObjectDetectionRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, str):
            logger.warning("object_detection: received string content, expected bytes")
            return []

        # image/* opens directly; PDFs are rasterised to one image per page.
        images = _load_input_images(content, content_type, self._pil)
        if not images:
            return []

        schema = self._schema
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.5
        multi_page = len(images) > 1
        results: list[DetectionResult] = []
        for page_index, image in images:
            try:
                detections: list[dict[str, Any]] = self._pipe(image) or []
                for det in detections:
                    label: str = det.get("label", "unknown")
                    score: float = float(det.get("score", 0.0))
                    box: dict[str, int] = det.get("box", {})
                    if score < threshold:
                        continue
                    if schema.min_box_area is not None:
                        w = max(0, box.get("xmax", 0) - box.get("xmin", 0))
                        h = max(0, box.get("ymax", 0) - box.get("ymin", 0))
                        if w * h < schema.min_box_area:
                            continue
                    severity = _resolve_pipeline_severity(label, schema.severity_map)
                    page_prefix = f"page {page_index + 1} " if multi_page else ""
                    metadata: dict[str, Any] = {
                        "box": box,
                        "score": score,
                        "image_size": f"{image.size[0]}x{image.size[1]}",
                        "model": schema.model,
                    }
                    if multi_page:
                        metadata["page"] = page_index + 1
                    results.append(
                        self._make_result(
                            finding_type=label,
                            category="CONTENT",
                            severity=severity,
                            confidence=score,
                            matched_content=label,
                            location=Location(
                                description=(
                                    f"{page_prefix}box xmin={box.get('xmin')} ymin={box.get('ymin')}"
                                    f" xmax={box.get('xmax')} ymax={box.get('ymax')}"
                                ),
                            ),
                            metadata=metadata,
                        )
                    )
            except Exception as exc:
                logger.error(
                    "object_detection error (model=%s): %s", schema.model, exc, exc_info=True
                )
        results.sort(key=lambda r: r.confidence, reverse=True)
        if schema.top_k is not None:
            results = results[: schema.top_k]
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_IMAGE_INPUT_CONTENT_TYPES)
