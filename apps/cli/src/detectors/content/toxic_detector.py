"""Toxic content detector using Detoxify."""

import logging
from typing import Any

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class ToxicDetector(BaseDetector):
    """
    Detector for toxic text content using Detoxify.

    Detects various types of toxic content including:
    - General toxicity
    - Severe toxicity
    - Obscenity/profanity
    - Threats
    - Insults
    - Identity-based attacks
    """

    detector_type = "toxic"
    detector_name = "toxic"

    def __init__(self, config: DetectorConfig | None = None):
        """Initialize toxic content detector with Detoxify."""
        super().__init__(config)
        self.model: Any | None = None

        try:
            ensure_torch("toxic", ["content", "detectors"])
            detoxify_module = require_module("detoxify", "toxic", ["content", "detectors"])

            # Initialize Detoxify model
            # Using 'original' model which detects 6 toxicity types
            self.model = detoxify_module.Detoxify("original")
            logger.debug("Initialized Detoxify model: original")

        except MissingDependencyError:
            raise
        except Exception as e:
            logger.error(f"Failed to initialize Detoxify model: {e}")
            raise

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        """
        Detect toxic content using Detoxify.

        Args:
            content: Text content to scan
            content_type: MIME type (must be text-based)

        Returns:
            List of detection results for found toxic content
        """
        results: list[DetectionResult] = []

        try:
            # Get predictions from Detoxify
            predictions = self.model.predict(content)

            # Detoxify returns a dict with scores for each toxicity type
            toxicity_types = {
                "toxicity": "Toxicity",
                "severe_toxicity": "Severe Toxicity",
                "obscene": "Obscenity",
                "threat": "Threat",
                "insult": "Insult",
                "identity_attack": "Identity Attack",
            }

            # Process each toxicity type
            for key, label in toxicity_types.items():
                score = predictions.get(key, 0.0)

                # Only report if score meets confidence threshold
                if score >= (self.config.confidence_threshold or 0.7):
                    # Determine severity based on type and score
                    severity = self._get_severity_for_type(key, score)

                    # Create detection result
                    result = DetectionResult(
                        detector_type=DetectorType.TOXIC,
                        finding_type=label,
                        category="CONTENT",
                        severity=severity,
                        confidence=float(score),
                        matched_content=content,
                        location=None,
                        metadata={
                            "toxicity_type": key,
                            "model": "detoxify-original",
                        },
                    )

                    results.append(result)

        except Exception as e:
            logger.error(f"Error detecting toxic content: {e}")
            logger.exception(e)

        # Sort by confidence (highest first)
        results.sort(key=lambda r: r.confidence, reverse=True)

        # Apply max_findings limit if configured
        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        """Return supported content types for toxic content detection."""
        return [
            "text/plain",
            "text/html",
            "application/json",
        ]

    def requires_gpu(self) -> bool:
        """
        Detoxify can run on CPU but benefits from GPU.

        Returns False as GPU is not required.
        """
        return False

    def _get_severity_for_type(self, toxicity_type: str, score: float) -> Severity:
        """
        Determine severity level based on toxicity type and score.

        Args:
            toxicity_type: Type of toxicity detected
            score: Confidence score (0-1)

        Returns:
            Severity level
        """
        # Critical severity - severe toxicity and threats
        if toxicity_type in ["severe_toxicity", "threat"]:
            return Severity.critical

        # High severity - general toxicity, insults, identity attacks
        if toxicity_type in ["toxicity", "insult", "identity_attack"]:
            # If very high confidence, elevate to critical
            if score >= 0.9:
                return Severity.critical
            return Severity.high

        # Medium severity - obscenity
        if toxicity_type == "obscene":
            if score >= 0.9:
                return Severity.high
            return Severity.medium

        # Default to high
        return Severity.high
