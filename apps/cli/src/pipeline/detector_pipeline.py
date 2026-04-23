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
            asset_with_findings = await self._process_single_asset(asset)
            results.append(asset_with_findings)

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

        text_detectors = [
            detector
            for detector in self.detectors
            if self._supports_content_type(
                detector.get_supported_content_types(),
                primary_content_type,
            )
        ]
        link_detectors = [
            detector
            for detector in self.detectors
            if link_content
            and self._supports_content_type(
                detector.get_supported_content_types(),
                "application/x.asset-links",
            )
        ]

        detector_names = [d.__class__.__name__ for d in text_detectors + link_detectors]
        logger.info("Scanning %s [%s]", asset.name, ", ".join(detector_names))

        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []

        if text_detectors:
            (
                text_findings,
                text_detector_types_run,
                content_size,
            ) = await self._run_text_detectors_for_asset(
                asset=asset,
                text_content_type=primary_content_type,
                detectors=text_detectors,
            )
            findings.extend(text_findings)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                text_detector_types_run,
            )
            if content_size == 0:
                logger.warning("No content available for asset %s", asset.name)
        else:
            content_size = 0

        if link_detectors:
            link_findings, link_detector_types_run = await self._run_detectors(
                detectors=link_detectors,
                content=link_content,
                content_type="application/x.asset-links",
            )
            findings.extend(link_findings)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                link_detector_types_run,
            )

            for finding in link_findings:
                self.source.enrich_finding_location(finding, asset, "")

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

        if findings:
            logger.info(
                "Scanned %s: %d finding(s) in %dms",
                asset.name,
                len(findings),
                scan_duration,
            )
        else:
            logger.info("Scanned %s: no findings (%dms)", asset.name, scan_duration)

        return asset

    async def _run_text_detectors_for_asset(
        self,
        *,
        asset: SingleAssetScanResults,
        text_content_type: str,
        detectors: list[BaseDetector],
    ) -> tuple[list[DetectionResult], list[DetectorType], int]:
        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []
        content_size = 0

        async for text_content in self._iter_text_content_pages(asset):
            content_size += len(text_content)

            detector_content = text_content
            if len(detector_content) > self.content_size_limit:
                logger.warning(
                    f"Content size ({len(detector_content)} bytes) exceeds limit "
                    f"({self.content_size_limit} bytes) for {asset.name}"
                )
                detector_content = detector_content[: self.content_size_limit]

            if not detector_content:
                continue

            page_findings, page_detector_types_run = await self._run_detectors(
                detectors=detectors,
                content=detector_content,
                content_type=text_content_type,
            )
            findings.extend(page_findings)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                page_detector_types_run,
            )

            for finding in page_findings:
                self.source.enrich_finding_location(finding, asset, detector_content)

        return findings, detector_types_run, content_size

    async def _iter_text_content_pages(self, asset: SingleAssetScanResults):
        candidate_ids: list[str] = []

        for candidate in (asset.external_url, asset.hash):
            value = str(candidate or "").strip()
            if not value or value in candidate_ids:
                continue
            candidate_ids.append(value)

        for candidate_id in candidate_ids:
            saw_candidate_content = False
            async for _raw_content, text_content in self.source.fetch_content_pages(candidate_id):
                if not text_content:
                    continue
                saw_candidate_content = True
                yield text_content

            if saw_candidate_content:
                return

    @staticmethod
    def _merge_detector_types(
        existing: list[DetectorType],
        incoming: list[DetectorType],
    ) -> list[DetectorType]:
        merged = list(existing)
        seen = set(existing)
        for detector_type in incoming:
            if detector_type in seen:
                continue
            seen.add(detector_type)
            merged.append(detector_type)
        return merged

    async def _fetch_content(self, asset: SingleAssetScanResults) -> tuple[str, str]:
        """Fetch content for an asset."""
        content_type = self._asset_type_to_content_type(asset.asset_type)

        async for text_content in self._iter_text_content_pages(asset):
            return text_content, content_type

        return "", content_type

    async def _run_detectors(
        self,
        *,
        detectors: list[BaseDetector],
        content: str,
        content_type: str,
    ) -> tuple[list[DetectionResult], list[DetectorType]]:
        """Run all compatible detectors in parallel for a single payload."""
        if not content:
            return [], []

        tasks = []
        runnable_detectors: list[BaseDetector] = []

        for detector in detectors:
            supported = detector.get_supported_content_types()
            if self._supports_content_type(supported, content_type):
                tasks.append(self._run_single_detector(detector, content, content_type))
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
            detector_name = detector.__class__.__name__
            if isinstance(result, Exception):
                logger.error("Detector %s failed: %s", detector_name, result)
                continue

            detector_findings: list[DetectionResult] = []
            if isinstance(result, list):
                for finding in result:
                    if isinstance(finding, DetectionResult):
                        finding_with_meta = finding.model_copy(
                            update={
                                "runner_id": self.runner_id,
                                "detected_at": detected_at,
                            }
                        )
                        detector_findings.append(finding_with_meta)

            if detector_findings:
                logger.info(
                    "  %s: %d finding(s)",
                    detector_name,
                    len(detector_findings),
                )
            else:
                logger.info("  %s: no findings", detector_name)

            all_findings.extend(detector_findings)

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
