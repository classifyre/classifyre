"""Object-detection detector — localises objects in images via HuggingFace transformers."""

import io
import logging
import re
from types import ModuleType
from typing import Any

from ...models.generated_detectors import (
    DetectorConfig,
    ObjectDetectionDetectorConfig,
    ObjectDetectionSeverityRule,
    Severity,
)
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)

_DEFAULT_SEVERITY = Severity.info


def _resolve_severity(
    label: str,
    severity_map: list[ObjectDetectionSeverityRule] | None,
) -> Severity:
    """Return the first severity whose pattern matches label (case-insensitive regex)."""
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


def _box_area(box: dict[str, int]) -> int:
    w = max(0, box.get("xmax", 0) - box.get("xmin", 0))
    h = max(0, box.get("ymax", 0) - box.get("ymin", 0))
    return w * h


class ObjectDetectionDetector(BaseDetector):
    """
    Detects and localises objects in images using the HuggingFace transformers
    ``object-detection`` pipeline.

    Accepts any compatible detection model — DETR, RT-DETR, YOLOS, and others.
    Each detected object above ``confidence_threshold`` produces a finding that
    includes the object label, bounding box coordinates (``metadata["box"]``),
    and confidence score.  Use ``severity_map`` to promote specific object classes
    to higher severity levels.
    """

    detector_type = "object_detection"
    detector_name = "object_detection"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.pipeline: Any | None = None
        self._image_module: ModuleType | None = None

        self._cfg: ObjectDetectionDetectorConfig = (
            config
            if isinstance(config, ObjectDetectionDetectorConfig)
            else ObjectDetectionDetectorConfig()
        )
        self._model_id: str | None = self._cfg.model
        self._model_revision: str | None = self._cfg.model_revision
        self._device: str = self._cfg.device or "cpu"
        self._severity_map: list[ObjectDetectionSeverityRule] | None = self._cfg.severity_map

        if self._model_id is None:
            raise MissingDependencyError(
                "object_detection",
                ["content", "detectors"],
                "ObjectDetectionDetector requires 'model' to be set in config",
            )

        ensure_torch("object_detection", ["content", "detectors"])
        transformers = require_module("transformers", "object_detection", ["content", "detectors"])
        self._image_module = require_module(
            "PIL.Image", "object_detection", ["content", "detectors"]
        )

        pipeline_kwargs: dict[str, Any] = {
            "model": self._model_id,
            "device": self._device,
        }
        if self._model_revision:
            pipeline_kwargs["revision"] = self._model_revision
        if self._cfg.nms_threshold is not None:
            pipeline_kwargs["threshold"] = self._cfg.nms_threshold

        try:
            self.pipeline = transformers.pipeline("object-detection", **pipeline_kwargs)
        except ImportError as exc:
            raise MissingDependencyError(
                "object_detection",
                ["content", "detectors"],
                f"ObjectDetectionDetector requires additional dependencies: {exc}",
            ) from exc
        logger.debug(
            "Initialized object-detection pipeline: model=%s device=%s",
            self._model_id,
            self._device,
        )

    async def detect(
        self, content: str | bytes, content_type: str = "image/jpeg"
    ) -> list[DetectionResult]:
        if not content_type.startswith("image/"):
            logger.debug("object_detection: skipping non-image content_type=%s", content_type)
            return []

        if isinstance(content, str):
            logger.warning("object_detection: received string content, expected bytes")
            return []

        results: list[DetectionResult] = []
        try:
            if self._image_module is None:
                raise RuntimeError("PIL.Image was not initialised")
            image = self._image_module.open(io.BytesIO(content))

            threshold = (
                self._cfg.confidence_threshold
                if self._cfg.confidence_threshold is not None
                else 0.5
            )
            detections: list[dict[str, Any]] = self.pipeline(image) or []

            for det in detections:
                label: str = det.get("label", "unknown")
                score: float = float(det.get("score", 0.0))
                box: dict[str, int] = det.get("box", {})

                if score < threshold:
                    continue

                if self._cfg.min_box_area is not None and _box_area(box) < self._cfg.min_box_area:
                    continue

                severity = _resolve_severity(label, self._severity_map)

                results.append(
                    DetectionResult(
                        detector_type=DetectorType.OBJECT_DETECTION,
                        finding_type=label,
                        category="CONTENT",
                        severity=severity,
                        confidence=score,
                        matched_content=f"Detected: {label} ({score:.3f})",
                        location=Location(
                            path=None,
                            description=f"box xmin={box.get('xmin')} ymin={box.get('ymin')} xmax={box.get('xmax')} ymax={box.get('ymax')}",
                        ),
                        metadata={
                            "box": box,
                            "score": score,
                            "image_size": f"{image.size[0]}x{image.size[1]}",
                            "model": self._model_id,
                        },
                    )
                )

        except Exception as exc:
            logger.error("object_detection error: %s", exc, exc_info=True)

        results.sort(key=lambda r: r.confidence, reverse=True)

        if self._cfg.top_k is not None:
            results = results[: self._cfg.top_k]

        if self._cfg.max_findings is not None:
            results = results[: self._cfg.max_findings]

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
