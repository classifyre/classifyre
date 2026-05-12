"""Object detection pipeline runner."""

from __future__ import annotations

import io
import logging
from typing import Any

from ....models.generated_detectors import ObjectDetectionPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult, Location
from ...dependencies import MissingDependencyError, ensure_torch, require_module
from ._base import _IMAGE_CONTENT_TYPES, BaseRunner, _resolve_pipeline_severity

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
                detector_name="object_detection",
                dependencies=["transformers"],
                uv_groups=["custom", "detectors"],
                detail=f"ObjectDetectionRunner requires additional dependencies: {exc}",
            ) from exc

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("ObjectDetectionRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if not content_type.startswith("image/"):
            return []
        if isinstance(content, str):
            logger.warning("object_detection: received string content, expected bytes")
            return []

        schema = self._schema
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.5
        results: list[DetectionResult] = []
        try:
            image = self._pil.open(io.BytesIO(content))
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
                results.append(
                    self._make_result(
                        finding_type=f"entity:{label}",
                        category="CONTENT",
                        severity=severity,
                        confidence=score,
                        matched_content=f"Detected: {label} ({score:.3f})",
                        location=Location(
                            description=(
                                f"box xmin={box.get('xmin')} ymin={box.get('ymin')}"
                                f" xmax={box.get('xmax')} ymax={box.get('ymax')}"
                            ),
                        ),
                        metadata={
                            "box": box,
                            "score": score,
                            "image_size": f"{image.size[0]}x{image.size[1]}",
                            "model": schema.model,
                        },
                    )
                )
            results.sort(key=lambda r: r.confidence, reverse=True)
            if schema.top_k is not None:
                results = results[: schema.top_k]
        except Exception as exc:
            logger.error("object_detection error (model=%s): %s", schema.model, exc, exc_info=True)
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_IMAGE_CONTENT_TYPES)
