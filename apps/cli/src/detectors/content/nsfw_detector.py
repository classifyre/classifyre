"""NSFW image detector using transformers."""

import io
import logging
from types import ModuleType
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class NSFWDetector(BaseDetector):
    """
    Detector for NSFW (Not Safe For Work) images.

    Uses a transformer-based image classification model to detect
    inappropriate visual content including:
    - NSFW content
    - Adult content
    - Explicit imagery
    - Safe/normal content (for comparison)
    """

    detector_type = "nsfw"
    detector_name = "nsfw"

    def __init__(self, config: DetectorConfig | None = None):
        """Initialize NSFW image detector."""
        super().__init__(config)
        self.classifier: Any | None = None
        self._image_module: ModuleType | None = None
        self._model_id: str = "Falconsai/nsfw_image_detection"

        try:
            ensure_torch("nsfw", ["content", "detectors"])
            transformers_module = require_module("transformers", "nsfw", ["content", "detectors"])
            self._image_module = require_module("PIL.Image", "nsfw", ["content", "detectors"])

            # Initialize image classification pipeline
            # Using a lightweight model for NSFW detection
            # Note: In production, you might want to use a more specialized model
            self.classifier = transformers_module.pipeline(
                "image-classification",
                model=self._model_id,
                device=-1,  # Use CPU (-1), or 0 for GPU
            )
            logger.debug("Initialized NSFW image classifier")

        except MissingDependencyError:
            raise
        except Exception as e:
            logger.error(f"Failed to initialize NSFW classifier: {e}")
            # Try a simpler fallback
            try:
                logger.warning("Attempting to initialize with default image classification model")
                self._model_id = "google/vit-base-patch16-224"
                self.classifier = transformers_module.pipeline(
                    "image-classification",
                    model=self._model_id,
                    device=-1,
                )
            except Exception as e2:
                logger.error(f"Failed to initialize fallback model: {e2}")
                raise

    async def detect(
        self, content: str | bytes, content_type: str = "image/jpeg"
    ) -> list[DetectionResult]:
        """
        Detect NSFW content in images.

        Args:
            content: Image content (bytes)
            content_type: MIME type (must be image/*)

        Returns:
            List of detection results for found NSFW content
        """
        results: list[DetectionResult] = []

        # Only process image content
        if not content_type.startswith("image/"):
            logger.warning(f"NSFW detector only supports images, got: {content_type}")
            return results

        try:
            # Handle string content (shouldn't happen for images, but be defensive)
            if isinstance(content, str):
                logger.warning("Received string content for image detector")
                return results

            # Load image from bytes
            if self._image_module is None:
                raise RuntimeError("PIL.Image module was not initialized")
            image = self._image_module.open(io.BytesIO(content))

            # Classify the image
            predictions = self.classifier(image)

            # Process predictions
            for prediction in predictions:
                label = prediction.get("label", "unknown")
                score = prediction.get("score", 0.0)

                # Only report if score meets confidence threshold
                if score >= (self.config.confidence_threshold or 0.7):
                    # Determine severity based on label
                    severity = self._get_severity_for_label(label, score)

                    # Create detection result
                    result = DetectionResult(
                        detector_type=DetectorType.NSFW,
                        finding_type=label,
                        category="CONTENT",
                        severity=severity,
                        confidence=float(score),
                        matched_content=f"Image classified as: {label}",
                        location=None,
                        metadata={
                            "image_size": f"{image.size[0]}x{image.size[1]}",
                            "image_mode": image.mode,
                            "model": self._model_id,
                        },
                    )

                    results.append(result)

        except Exception as e:
            logger.error(f"Error detecting NSFW content: {e}")
            logger.exception(e)

        # Sort by confidence (highest first)
        results.sort(key=lambda r: r.confidence, reverse=True)

        # Apply max_findings limit if configured
        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        """Return supported content types for NSFW detection."""
        return [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/bmp",
        ]

    def requires_gpu(self) -> bool:
        """
        Image models can run on CPU but benefit from GPU.

        Returns False as GPU is not required.
        """
        return False

    def _get_severity_for_label(self, label: str, score: float) -> Severity:
        """
        Determine severity level based on classification label.

        Args:
            label: Classification label
            score: Confidence score

        Returns:
            Severity level
        """
        label_lower = label.lower()

        # Critical severity - explicit NSFW content
        if any(
            keyword in label_lower for keyword in ["nsfw", "explicit", "porn", "adult", "sexual"]
        ):
            return Severity.critical

        # High severity - suggestive or inappropriate
        if any(keyword in label_lower for keyword in ["suggestive", "inappropriate"]):
            return Severity.high

        # Medium severity - potentially questionable
        if any(keyword in label_lower for keyword in ["questionable", "borderline"]):
            return Severity.medium

        # Low/Info severity - safe/normal content
        if any(keyword in label_lower for keyword in ["normal", "safe", "neutral"]):
            return Severity.info

        # Default based on confidence
        if score >= 0.95:
            return Severity.high
        elif score >= 0.85:
            return Severity.medium
        else:
            return Severity.low
