"""Pipeline for running detectors on extracted assets."""

import asyncio
import logging
from collections.abc import AsyncGenerator
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
from ..utils.file_parser import resolve_mime_type
from .content_provider import ContentProvider

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
        max_concurrent_assets: int = 10,
        content_provider: ContentProvider | None = None,
    ):
        """
        Initialize detector pipeline.

        Args:
            detectors: List of detector instances to run
            source: Source instance for fetching content
            runner_id: ID of the runner executing this pipeline
            content_size_limit: Maximum content size in bytes
            max_concurrent_assets: Max assets to process in parallel within a batch
            content_provider: Optional provider — if None, source is used directly
        """
        self.detectors = detectors
        self.source = source
        self.runner_id = runner_id
        self.content_size_limit = content_size_limit
        self.max_concurrent_assets = max_concurrent_assets
        if content_provider is not None:
            self.content_provider: ContentProvider = content_provider
        else:
            from .parsed_content_provider import ParsedContentProvider

            self.content_provider = ParsedContentProvider(source)
        self.init_warnings: list[str] = []

    async def process(self, assets: list[SingleAssetScanResults]) -> list[SingleAssetScanResults]:
        """Process assets through detector pipeline, returning all results at once."""
        results: list[SingleAssetScanResults] = []
        async for asset in self.process_stream(assets):
            results.append(asset)
        return results

    async def process_stream(
        self, assets: list[SingleAssetScanResults]
    ) -> AsyncGenerator[SingleAssetScanResults, None]:
        """Process assets concurrently (bounded), yielding in completion order."""
        semaphore = asyncio.Semaphore(self.max_concurrent_assets)

        async def _bounded(asset: SingleAssetScanResults) -> SingleAssetScanResults:
            async with semaphore:
                return await self._process_single_asset(asset)

        tasks = {asyncio.create_task(_bounded(a)) for a in assets}
        for coro in asyncio.as_completed(tasks):
            yield await coro

    async def _process_single_asset(self, asset: SingleAssetScanResults) -> SingleAssetScanResults:
        """Process a single asset through detectors."""
        # 1. If no detectors, return asset as-is with empty findings
        if not self.detectors:
            asset.findings = []
            return asset

        # Record scan start time
        scan_started = datetime.now(UTC)
        ocr_enabled = self.source.ocr_enabled()
        text_content_type = self._text_content_type_for_asset(asset.asset_type, ocr_enabled)
        link_content = self._build_links_payload(asset.links)

        text_detectors = []
        if text_content_type:
            text_detectors = [
                detector
                for detector in self.detectors
                if self._supports_content_type(
                    detector.get_supported_content_types(),
                    text_content_type,
                )
            ]
        asset_has_binary_primary = self._asset_has_binary_primary_payload(asset.asset_type)
        binary_detectors = [
            detector
            for detector in self.detectors
            if self._is_binary_detector(detector)
            and (
                asset_has_binary_primary
                or not text_content_type
                or not self._supports_content_type(
                    detector.get_supported_content_types(),
                    text_content_type,
                )
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
        should_warn_on_empty_text = asset.asset_type in {
            OutputAssetType.TXT,
            OutputAssetType.TABLE,
            OutputAssetType.URL,
        }

        all_active = text_detectors + binary_detectors + link_detectors
        detector_names = [self._detector_log_label(d) for d in all_active]
        logger.info("Scanning %s [%s]", asset.name, ", ".join(detector_names))

        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []
        scan_warnings: list[str] = list(self.init_warnings)
        scan_errors: list[str] = []

        if text_detectors:
            (
                text_findings,
                text_detector_types_run,
                content_size,
                text_warnings,
                text_errors,
            ) = await self._run_text_detectors_for_asset(
                asset=asset,
                text_content_type=text_content_type,
                detectors=text_detectors,
                warn_on_empty_content=should_warn_on_empty_text,
            )
            findings.extend(text_findings)
            scan_warnings.extend(text_warnings)
            scan_errors.extend(text_errors)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                text_detector_types_run,
            )
        else:
            content_size = 0

        if binary_detectors:
            (
                binary_findings,
                binary_detector_types_run,
                bin_warnings,
                bin_errors,
            ) = await self._run_binary_detectors_for_asset(
                asset=asset,
                detectors=binary_detectors,
            )
            findings.extend(binary_findings)
            scan_warnings.extend(bin_warnings)
            scan_errors.extend(bin_errors)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                binary_detector_types_run,
            )

        if link_detectors:
            link_findings, link_detector_types_run, link_errors = await self._run_detectors(
                detectors=link_detectors,
                content=link_content,
                content_type="application/x.asset-links",
                asset_name=asset.name,
            )
            findings.extend(link_findings)
            scan_errors.extend(link_errors)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                link_detector_types_run,
            )

            for finding in link_findings:
                self.content_provider.enrich_finding_location(finding, asset, "")

        scan_duration = int((datetime.now(UTC) - scan_started).total_seconds() * 1000)

        asset.findings = findings
        asset.scan_stats = ScanStats(
            scanned_at=scan_started,
            duration_ms=scan_duration,
            detectors_run=detector_types_run,
            content_size_bytes=content_size,
            findings_count=len(findings),
            warnings=scan_warnings or None,
            errors=scan_errors or None,
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
        warn_on_empty_content: bool = True,
    ) -> tuple[list[DetectionResult], list[DetectorType], int, list[str], list[str]]:
        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []
        warnings: list[str] = []
        errors: list[str] = []
        content_size = 0

        async for text_content in self._iter_text_content_pages(asset):
            content_size += len(text_content)

            detector_content = text_content
            if len(detector_content) > self.content_size_limit:
                msg = (
                    f"Content truncated from {len(detector_content)} to "
                    f"{self.content_size_limit} bytes for {asset.name}"
                )
                logger.warning(msg)
                warnings.append(msg)
                detector_content = detector_content[: self.content_size_limit]

            if not detector_content:
                continue

            page_findings, page_detector_types_run, page_errors = await self._run_detectors(
                detectors=detectors,
                content=detector_content,
                content_type=text_content_type,
                asset_name=asset.name,
            )
            findings.extend(page_findings)
            errors.extend(page_errors)
            detector_types_run = self._merge_detector_types(
                detector_types_run,
                page_detector_types_run,
            )

            for finding in page_findings:
                self.content_provider.enrich_finding_location(finding, asset, detector_content)

        if content_size == 0 and warn_on_empty_content:
            msg = f"No content available for asset {asset.name}"
            logger.warning(msg)
            warnings.append(msg)

        return findings, detector_types_run, content_size, warnings, errors

    async def _iter_text_content_pages(self, asset: SingleAssetScanResults):
        candidate_ids: list[str] = []

        for candidate in (asset.external_url, asset.hash):
            value = str(candidate or "").strip()
            if not value or value in candidate_ids:
                continue
            candidate_ids.append(value)

        for candidate_id in candidate_ids:
            saw_candidate_content = False
            async for text_content in self.content_provider.fetch_text_pages(candidate_id):
                if not text_content:
                    continue
                saw_candidate_content = True
                yield text_content

            if saw_candidate_content:
                return

    async def _run_binary_detectors_for_asset(
        self,
        *,
        asset: SingleAssetScanResults,
        detectors: list[BaseDetector],
    ) -> tuple[list[DetectionResult], list[DetectorType], list[str], list[str]]:
        """Fetch raw bytes for an asset and run binary/image detectors."""
        warnings: list[str] = []
        candidate_ids: list[str] = []
        for candidate in (asset.external_url, asset.hash):
            value = str(candidate or "").strip()
            if not value or value in candidate_ids:
                continue
            candidate_ids.append(value)

        for candidate_id in candidate_ids:
            result = await self.content_provider.fetch_bytes(candidate_id)
            if result is None:
                continue

            raw_bytes, mime_type = result
            if len(raw_bytes) > self.content_size_limit:
                msg = (
                    f"Binary content truncated from {len(raw_bytes)} to "
                    f"{self.content_size_limit} bytes for {asset.name}"
                )
                logger.warning(msg)
                warnings.append(msg)
                raw_bytes = raw_bytes[: self.content_size_limit]

            if not raw_bytes:
                continue

            effective_mime_type = self._resolve_binary_mime_type(
                raw_bytes=raw_bytes,
                declared_mime_type=mime_type,
                asset=asset,
            )

            compatible = [
                d
                for d in detectors
                if self._supports_content_type(d.get_supported_content_types(), effective_mime_type)
            ]
            if not compatible:
                continue

            findings, detector_types_run, errors = await self._run_detectors(
                detectors=compatible,
                content=raw_bytes,
                content_type=effective_mime_type,
                asset_name=asset.name,
            )
            for finding in findings:
                self.content_provider.enrich_finding_location(finding, asset, "")
            return findings, detector_types_run, warnings, errors

        return [], [], [], []

    @staticmethod
    def _resolve_binary_mime_type(
        *,
        raw_bytes: bytes,
        declared_mime_type: str,
        asset: SingleAssetScanResults,
    ) -> str:
        file_name = str(asset.name or "").strip() or str(asset.external_url or "").strip()
        return resolve_mime_type(
            raw_bytes,
            declared_mime_type=declared_mime_type,
            file_name=file_name,
        )

    @staticmethod
    def _is_binary_detector(detector: BaseDetector) -> bool:
        """Return True if the detector handles binary content types (images, etc.)."""
        for ct in detector.get_supported_content_types():
            if ct.startswith(("image/", "audio/", "video/")) or ct == "application/octet-stream":
                return True
        return False

    @staticmethod
    def _detector_log_label(detector: BaseDetector) -> str:
        """Return a human-readable detector label for logs."""
        config_name = getattr(getattr(detector, "config", None), "name", None)
        if isinstance(config_name, str) and config_name.strip():
            return config_name.strip()

        detector_name = getattr(detector, "detector_name", "")
        if isinstance(detector_name, str) and detector_name.strip() and detector_name != "base":
            return detector_name.strip()

        return detector.__class__.__name__

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
        content: str | bytes,
        content_type: str,
        asset_name: str = "",
    ) -> tuple[list[DetectionResult], list[DetectorType], list[str]]:
        """Run all compatible detectors in parallel for a single payload."""
        if not content:
            return [], [], []

        tasks = []
        runnable_detectors: list[BaseDetector] = []

        for detector in detectors:
            supported = detector.get_supported_content_types()
            if self._supports_content_type(supported, content_type):
                tasks.append(self._run_single_detector(detector, content, content_type))
                runnable_detectors.append(detector)

        if not tasks:
            return [], [], []

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

        all_findings: list[DetectionResult] = []
        errors: list[str] = []
        detected_at = datetime.now(UTC)

        for detector, result in zip(runnable_detectors, results, strict=False):
            detector_name = detector.__class__.__name__
            if isinstance(result, Exception):
                logger.error("Detector %s failed for %s: %s", detector_name, asset_name, result)
                errors.append(f"{detector_name}: {result}")
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
                    "  %s on %s: %d finding(s)",
                    detector_name,
                    asset_name,
                    len(detector_findings),
                )
            else:
                logger.info("  %s on %s: no findings", detector_name, asset_name)

            all_findings.extend(detector_findings)

        return all_findings, detector_types_run, errors

    def _build_links_payload(self, links: list[str] | None) -> str:
        if not links:
            return ""

        unique_links: list[str] = []
        seen_links: set[str] = set()
        for link in links:
            value = str(link).strip()
            if not value:
                continue

            resolved = self.content_provider.resolve_link_for_detection(value)
            if not resolved or resolved in seen_links:
                continue

            seen_links.add(resolved)
            unique_links.append(resolved)

        return "\n".join(unique_links)

    async def _run_single_detector(
        self, detector: BaseDetector, content: str | bytes, content_type: str
    ) -> list[DetectionResult]:
        """Run a single detector."""
        return await detector.detect(content, content_type)

    def _text_content_type_for_asset(
        self,
        asset_type: OutputAssetType,
        ocr_enabled: bool,
    ) -> str | None:
        """Map an asset type to the text payload MIME used for text-capable detectors."""
        mapping = {
            OutputAssetType.TXT: "text/plain",
            OutputAssetType.TABLE: "text/plain",
            # URL assets usually resolve to HTML pages and are scanned as extracted text.
            OutputAssetType.URL: "text/html",
        }
        if asset_type in mapping:
            return mapping[asset_type]
        if ocr_enabled and asset_type in {OutputAssetType.IMAGE, OutputAssetType.BINARY}:
            return "text/plain"
        return None

    @staticmethod
    def _asset_has_binary_primary_payload(asset_type: OutputAssetType) -> bool:
        return asset_type in {
            OutputAssetType.IMAGE,
            OutputAssetType.VIDEO,
            OutputAssetType.AUDIO,
            OutputAssetType.BINARY,
            OutputAssetType.OTHER,
        }

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
        cls,
        recipe: dict[str, Any],
        source: BaseSource,
        runner_id: str,
        max_concurrent_assets: int = 10,
    ) -> "DetectorPipeline":
        """Create pipeline from recipe configuration."""
        from ..detectors import get_detector
        from ..detectors.config import parse_detector_config

        # New schema: detectors is an array of {type, enabled, config}
        detector_configs = recipe.get("detectors", [])

        if not detector_configs:
            # Return empty pipeline (no detectors)
            return cls(detectors=[], source=source, runner_id=runner_id)

        detectors = []
        init_warnings: list[str] = []

        for detector_item in detector_configs:
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
                msg = f"Failed to initialize detector {detector_type}: {e}"
                logger.error(msg)
                init_warnings.append(msg)

        from .parsed_content_provider import ParsedContentProvider

        content_size_limit = 1_048_576  # 1MB

        pipeline = cls(
            detectors=detectors,
            source=source,
            runner_id=runner_id,
            content_size_limit=content_size_limit,
            max_concurrent_assets=max_concurrent_assets,
            content_provider=ParsedContentProvider(source),
        )
        pipeline.init_warnings = init_warnings
        return pipeline
