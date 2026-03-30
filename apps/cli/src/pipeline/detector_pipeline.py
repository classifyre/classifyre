"""Pipeline for running detectors on extracted assets."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from ..detectors.base import BaseDetector
from ..models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ..models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    ScanStats,
    SingleAssetScanResults,
)
from ..sources.base import BaseSource

logger = logging.getLogger(__name__)


class DetectorPipeline:
    """
    Pipeline for running detectors on extracted assets.

    Adds detector findings to assets (CoreOutput schema).
    """

    def __init__(
        self,
        detectors: list[BaseDetector],
        source: BaseSource,
        runner_id: str,
        content_size_limit: int = 1_048_576,  # 1MB default
    ):
        """
        Initialize detector pipeline.

        Args:
            detectors: List of detector instances to run
            source: Source instance for fetching content
            runner_id: ID of the runner executing this pipeline
            content_size_limit: Maximum content size in bytes
        """
        self.detectors = detectors
        self.source = source
        self.runner_id = runner_id
        self.content_size_limit = content_size_limit

    async def process(self, assets: list[SingleAssetScanResults]) -> list[SingleAssetScanResults]:
        """
        Process assets through detector pipeline.

        Args:
            assets: List of extracted assets from source

        Returns:
            List of assets with detector findings added
        """
        results: list[SingleAssetScanResults] = []

        for asset in assets:
            try:
                asset_with_findings = await self._process_single_asset(asset)
                results.append(asset_with_findings)
            except Exception as e:
                logger.error(f"Failed to process asset {asset.name}: {e}")
                # Still add asset without findings
                asset.findings = []
                results.append(asset)

        return results

    async def _process_single_asset(self, asset: SingleAssetScanResults) -> SingleAssetScanResults:
        """Process a single asset through detectors."""
        # 1. If no detectors, return asset as-is with empty findings
        if not self.detectors:
            asset.findings = []
            return asset

        # Record scan start time
        scan_started = datetime.now(UTC)
        primary_content_type = self._asset_type_to_content_type(asset.asset_type)
        link_content = self._build_links_payload(asset.links)

        needs_text_content = any(
            self._supports_content_type(
                detector.get_supported_content_types(), primary_content_type
            )
            for detector in self.detectors
        )

        content = ""
        content_size = 0
        if needs_text_content:
            content, _ = await self._fetch_content(asset)
            content_size = len(content)

            if content_size > self.content_size_limit:
                logger.warning(
                    f"Content size ({content_size} bytes) exceeds limit "
                    f"({self.content_size_limit} bytes) for {asset.name}"
                )
                content = content[: self.content_size_limit]

            if not content:
                logger.warning(f"No content available for asset {asset.name}")

        # 3. Run detectors in parallel across supported payload types.
        findings, detector_types_run = await self._run_detectors(
            text_content=content,
            text_content_type=primary_content_type,
            link_content=link_content,
        )

        # 4. Enrich finding locations with source-specific human-readable references
        for finding in findings:
            self.source.enrich_finding_location(finding, asset, content)

        # 5. Calculate duration
        scan_duration = int((datetime.now(UTC) - scan_started).total_seconds() * 1000)

        # 6. Add findings to asset
        asset.findings = findings

        # 7. Add scan stats
        asset.scan_stats = ScanStats(
            scanned_at=scan_started,
            duration_ms=scan_duration,
            detectors_run=detector_types_run,
            content_size_bytes=content_size,
            findings_count=len(findings),
        )

        return asset

    async def _fetch_content(self, asset: SingleAssetScanResults) -> tuple[str, str]:
        """Fetch content for an asset."""
        content_type = self._asset_type_to_content_type(asset.asset_type)
        candidate_ids: list[str] = []

        for candidate in (asset.external_url, asset.hash):
            value = str(candidate or "").strip()
            if not value or value in candidate_ids:
                continue
            candidate_ids.append(value)

        for candidate_id in candidate_ids:
            try:
                result = await self.source.fetch_content(candidate_id)
            except Exception as e:
                logger.error(f"Failed to fetch content for candidate {candidate_id}: {e}")
                continue

            if result is None:
                continue

            _raw, text_content = result
            if text_content:
                return text_content, content_type

        return "", content_type

    async def _run_detectors(
        self,
        *,
        text_content: str,
        text_content_type: str,
        link_content: str,
    ) -> tuple[list[DetectionResult], list[DetectorType]]:
        """Run all compatible detectors in parallel."""
        tasks = []
        runnable_detectors: list[BaseDetector] = []

        for detector in self.detectors:
            supported = detector.get_supported_content_types()
            if text_content and self._supports_content_type(supported, text_content_type):
                tasks.append(self._run_single_detector(detector, text_content, text_content_type))
                runnable_detectors.append(detector)

            if link_content and self._supports_content_type(
                supported,
                "application/x.asset-links",
            ):
                tasks.append(
                    self._run_single_detector(
                        detector,
                        link_content,
                        "application/x.asset-links",
                    )
                )
                runnable_detectors.append(detector)

        if not tasks:
            return [], []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        detector_types_run: list[DetectorType] = []
        seen_detector_types: set[DetectorType] = set()
        for detector in runnable_detectors:
            detector_type = getattr(detector, "detector_type", "")
            if not detector_type:
                continue
            try:
                detector_type_enum = DetectorType(detector_type.upper())
            except ValueError:
                logger.warning(f"Unknown detector type during scan stats: {detector_type}")
                continue
            if detector_type_enum in seen_detector_types:
                continue
            seen_detector_types.add(detector_type_enum)
            detector_types_run.append(detector_type_enum)

        # Flatten and handle errors
        all_findings: list[DetectionResult] = []
        detected_at = datetime.now(UTC)

        for detector, result in zip(runnable_detectors, results, strict=False):
            if isinstance(result, Exception):
                error_msg = f"Detector {detector.__class__.__name__} failed: {result}"
                logger.error(error_msg)
                continue

            # Result is list[DetectionResult] - add runner_id and detected_at
            if isinstance(result, list):
                for finding in result:
                    # Ensure it's a DetectionResult object
                    if isinstance(finding, DetectionResult):
                        # Create new instance with runner_id and detected_at
                        finding_with_meta = finding.model_copy(
                            update={
                                "runner_id": self.runner_id,
                                "detected_at": detected_at,
                            }
                        )
                        all_findings.append(finding_with_meta)

        return all_findings, detector_types_run

    def _build_links_payload(self, links: list[str] | None) -> str:
        if not links:
            return ""

        unique_links: list[str] = []
        seen_links: set[str] = set()
        for link in links:
            value = str(link).strip()
            if not value:
                continue

            resolved = self.source.resolve_link_for_detection(value)
            if not resolved or resolved in seen_links:
                continue

            seen_links.add(resolved)
            unique_links.append(resolved)

        return "\n".join(unique_links)

    async def _run_single_detector(
        self, detector: BaseDetector, content: str, content_type: str
    ) -> list[DetectionResult]:
        """Run a single detector."""
        return await detector.detect(content, content_type)

    def _asset_type_to_content_type(self, asset_type: OutputAssetType) -> str:
        """Map canonical asset type to best-effort MIME type for detector routing."""
        mapping = {
            OutputAssetType.TXT: "text/plain",
            OutputAssetType.TABLE: "text/plain",
            # URL assets usually resolve to HTML pages and are scanned as extracted text.
            OutputAssetType.URL: "text/html",
            OutputAssetType.IMAGE: "image/*",
            OutputAssetType.VIDEO: "video/*",
            OutputAssetType.AUDIO: "audio/*",
            OutputAssetType.BINARY: "application/octet-stream",
            OutputAssetType.OTHER: "application/octet-stream",
        }
        return mapping.get(asset_type, "text/plain")

    def _supports_content_type(self, supported: list[str], content_type: str) -> bool:
        """
        Check MIME compatibility, including wildcard and text fallback behavior.
        """
        if content_type in supported:
            return True

        for supported_type in supported:
            if supported_type.endswith("/*"):
                prefix = supported_type[:-1]
                if content_type.startswith(prefix):
                    return True

        # Compatibility fallback: text detectors that declare text/plain
        # should still process extracted HTML text content.
        if content_type == "text/html" and "text/plain" in supported:
            return True

        return False

    @classmethod
    def from_recipe(
        cls, recipe: dict[str, Any], source: BaseSource, runner_id: str
    ) -> "DetectorPipeline":
        """Create pipeline from recipe configuration."""
        from ..detectors import get_detector
        from ..detectors.config import parse_detector_config

        # New schema: detectors is an array of {type, enabled, config}
        detector_configs = recipe.get("detectors", [])

        if not detector_configs:
            # Return empty pipeline (no detectors)
            return cls(detectors=[], source=source, runner_id=runner_id)

        # Initialize detectors from array
        detectors = []

        for detector_item in detector_configs:
            # Check if enabled (default True)
            if not detector_item.get("enabled", True):
                continue

            detector_type = detector_item.get("type", "").upper()
            raw_config = detector_item.get("config", {})

            try:
                detector_name, typed_config = parse_detector_config(
                    detector_type=detector_type,
                    raw_config=raw_config,
                )

                detector = get_detector(detector_name, typed_config)
                detectors.append(detector)
                logger.info(f"Initialized detector: {detector_name}")
            except Exception as e:
                logger.error(f"Failed to initialize detector {detector_type}: {e}")

        # Default content size limit
        content_size_limit = 1_048_576  # 1MB

        return cls(
            detectors=detectors,
            source=source,
            runner_id=runner_id,
            content_size_limit=content_size_limit,
        )
