"""Base detector interface for all detector implementations."""

from abc import ABC, abstractmethod
from typing import Any

from ..models.generated_detectors import DetectorConfig
from ..models.generated_single_asset_scan_results import DetectionResult


class BaseDetector(ABC):
    """
    Base interface for all detector implementations.

    All detectors must implement the detect() method and get_supported_content_types().
    The base class provides common functionality like redaction and metadata retrieval.
    """

    detector_type: str = "base"
    detector_name: str = "base"

    def __init__(self, config: DetectorConfig | None = None):
        """
        Initialize detector with optional configuration.

        Args:
            config: Detector configuration (confidence threshold, max findings, etc.)
        """
        self.config = config or DetectorConfig()
        self._initialized = False

    @abstractmethod
    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        """
        Scan content and return findings.

        Args:
            content: The content to scan (text, bytes, etc.)
            content_type: MIME type of content (e.g., 'text/plain', 'image/jpeg')

        Returns:
            List of detection results
        """
        pass

    @abstractmethod
    def get_supported_content_types(self) -> list[str]:
        """
        Return list of supported MIME types.

        Returns:
            List of MIME type strings (e.g., ['text/plain', 'application/json'])
        """
        pass

    def get_metadata(self) -> dict[str, Any]:
        """
        Return detector metadata.

        Returns:
            Dictionary with detector type, name, supported content types, etc.
        """
        return {
            "detector_type": self.detector_type,
            "detector_name": self.detector_name,
            "content_types": self.get_supported_content_types(),
            "requires_gpu": self.requires_gpu(),
        }

    def requires_gpu(self) -> bool:
        """
        Return True if GPU is required for this detector.

        Returns:
            Boolean indicating GPU requirement
        """
        return False

    def redact(self, content: str, findings: list[DetectionResult]) -> str:
        """
        Redact sensitive content based on findings.

        Replaces each finding's matched_content with asterisks (*).

        Args:
            content: Original content
            findings: List of detection results

        Returns:
            Redacted content string
        """
        redacted = content
        for finding in findings:
            if finding.location is None:
                continue
            if finding.matched_content:
                mask = "*" * len(finding.matched_content)
                redacted = redacted.replace(finding.matched_content, mask)
        return redacted
