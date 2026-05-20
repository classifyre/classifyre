"""Pipeline for running detectors on extracted assets."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
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
from .worker_pool import DetectorWorkerPool, is_io_bound_detector

logger = logging.getLogger(__name__)


class _DetectorInfo:
    """Serialisable metadata for routing a detector through the process pool."""

    __slots__ = ("config_json", "detector_name", "detector_type")

    def __init__(self, detector_name: str, detector_type: str, config_json: str) -> None:
        self.detector_name = detector_name
        self.detector_type = detector_type
        self.config_json = config_json


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
        worker_pool: DetectorWorkerPool | None = None,
    ):
        self.detectors = detectors
        self.source = source
        self.runner_id = runner_id
        self.content_size_limit = content_size_limit
        self.max_concurrent_assets = max_concurrent_assets
        self._detector_semaphore = asyncio.Semaphore(max_concurrent_assets)
        self._worker_pool = worker_pool
        self._detector_info: dict[int, _DetectorInfo] = {}
        if content_provider is not None:
            self.content_provider: ContentProvider = content_provider
        else:
            from .parsed_content_provider import ParsedContentProvider

            self.content_provider = ParsedContentProvider(source)
        self.init_warnings: list[str] = []

    def _register_detector_info(
        self, detector: BaseDetector, info: _DetectorInfo
    ) -> None:
        self._detector_info[id(detector)] = info

    def _get_detector_info(self, detector: BaseDetector) -> _DetectorInfo | None:
        return self._detector_info.get(id(detector))

    def _can_use_pool(self, detector: BaseDetector) -> bool:
        if self._worker_pool is None:
            return False
        info = self._get_detector_info(detector)
        if info is None:
            return False
        return not is_io_bound_detector(info.detector_name)

    async def process(self, assets: list[SingleAssetScanResults]) -> list[SingleAssetScanResults]:
        """Process assets through detector pipeline, returning all results at once."""
        results: list[SingleAssetScanResults] = []
        async for asset in self.process_stream(assets):
            results.append(asset)
        return results

    async def process_stream(
        self, assets: list[SingleAssetScanResults]
    ) -> AsyncGenerator[SingleAssetScanResults, None]:
        """Process assets concurrently, yielding in completion order."""
        tasks = {asyncio.create_task(self.process_single_asset(a)) for a in assets}
        for coro in asyncio.as_completed(tasks):
            yield await coro

    async def process_single_asset(
        self,
        asset: SingleAssetScanResults,
        *,
        on_findings_flushed: Callable[[list[DetectionResult]], Awaitable[None]] | None = None,
        findings_flush_size: int = 50,
    ) -> SingleAssetScanResults:
        """Process a single asset through detectors."""
        if not self.detectors:
            asset.findings = []
            return asset

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
        pool_tag = "[pool]" if self._worker_pool else "[in-process]"
        logger.info(
            "%s Scanning %s [%s]", pool_tag, asset.name, ", ".join(detector_names)
        )

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
                on_findings_flushed=on_findings_flushed,
                findings_flush_size=findings_flush_size,
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
                "%s Scanned %s: %d finding(s) in %dms",
                pool_tag, asset.name, len(findings), scan_duration,
            )
        else:
            logger.info(
                "%s Scanned %s: no findings (%dms)", pool_tag, asset.name, scan_duration
            )

        return asset

    # ------------------------------------------------------------------
    # Text detector execution
    # ------------------------------------------------------------------

    async def _run_text_detectors_for_asset(
        self,
        *,
        asset: SingleAssetScanResults,
        text_content_type: str,
        detectors: list[BaseDetector],
        warn_on_empty_content: bool = True,
        on_findings_flushed: Callable[[list[DetectionResult]], Awaitable[None]] | None = None,
        findings_flush_size: int = 50,
    ) -> tuple[list[DetectionResult], list[DetectorType], int, list[str], list[str]]:
        if on_findings_flushed is not None:
            return await self._run_text_detectors_streaming(
                asset=asset,
                text_content_type=text_content_type,
                detectors=detectors,
                warn_on_empty_content=warn_on_empty_content,
                on_findings_flushed=on_findings_flushed,
                findings_flush_size=findings_flush_size,
            )
        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []
        warnings: list[str] = []
        errors: list[str] = []
        content_size = 0
        page_index = 0

        pending_tasks: set[
            asyncio.Task[tuple[list[DetectionResult], list[DetectorType], list[str], str, int]]
        ] = set()

        async def _detect_page(
            page_content: str,
            page_num: int,
        ) -> tuple[list[DetectionResult], list[DetectorType], list[str], str, int]:
            async with self._detector_semaphore:
                t0 = time.monotonic()
                page_findings, page_types, page_errors = await self._run_detectors(
                    detectors=detectors,
                    content=page_content,
                    content_type=text_content_type,
                    asset_name=asset.name,
                    page_num=page_num,
                )
                elapsed = int((time.monotonic() - t0) * 1000)
                logger.info(
                    "  %s page %d done: %d findings (%dms)",
                    asset.name, page_num, len(page_findings), elapsed,
                )
                return page_findings, page_types, page_errors, page_content, page_num

        def _collect_done() -> None:
            done = {t for t in pending_tasks if t.done()}
            for task in done:
                pending_tasks.discard(task)
                page_findings, page_types, page_errors, page_content, _pn = task.result()
                findings.extend(page_findings)
                errors.extend(page_errors)
                nonlocal detector_types_run
                detector_types_run = self._merge_detector_types(
                    detector_types_run,
                    page_types,
                )
                for finding in page_findings:
                    self.content_provider.enrich_finding_location(
                        finding,
                        asset,
                        page_content,
                    )

        async for text_content in self._iter_text_content_pages(asset):
            page_index += 1
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

            task = asyncio.create_task(_detect_page(detector_content, page_index))
            pending_tasks.add(task)
            _collect_done()

        if pending_tasks:
            await asyncio.gather(*pending_tasks)
            _collect_done()

        if content_size == 0 and warn_on_empty_content:
            msg = f"No content available for asset {asset.name}"
            logger.warning(msg)
            warnings.append(msg)

        return findings, detector_types_run, content_size, warnings, errors

    async def _run_text_detectors_streaming(
        self,
        *,
        asset: SingleAssetScanResults,
        text_content_type: str,
        detectors: list[BaseDetector],
        warn_on_empty_content: bool = True,
        on_findings_flushed: Callable[[list[DetectionResult]], Awaitable[None]],
        findings_flush_size: int = 50,
    ) -> tuple[list[DetectionResult], list[DetectorType], int, list[str], list[str]]:
        """Concurrent page processing with periodic flush of accumulated findings."""
        findings: list[DetectionResult] = []
        detector_types_run: list[DetectorType] = []
        warnings: list[str] = []
        errors: list[str] = []
        content_size = 0
        unflushed_count = 0
        page_index = 0

        pending_tasks: set[
            asyncio.Task[tuple[list[DetectionResult], list[DetectorType], list[str], str, int]]
        ] = set()

        async def _detect_page(
            page_content: str,
            page_num: int,
        ) -> tuple[list[DetectionResult], list[DetectorType], list[str], str, int]:
            async with self._detector_semaphore:
                t0 = time.monotonic()
                page_findings, page_types, page_errors = await self._run_detectors(
                    detectors=detectors,
                    content=page_content,
                    content_type=text_content_type,
                    asset_name=asset.name,
                    page_num=page_num,
                )
                elapsed = int((time.monotonic() - t0) * 1000)
                logger.info(
                    "  %s page %d done: %d findings (%dms)",
                    asset.name, page_num, len(page_findings), elapsed,
                )
                return page_findings, page_types, page_errors, page_content, page_num

        async def _collect_done_and_flush() -> None:
            nonlocal detector_types_run, unflushed_count
            done = {t for t in pending_tasks if t.done()}
            for task in done:
                pending_tasks.discard(task)
                page_findings, page_types, page_errors, page_content, _pn = task.result()
                for finding in page_findings:
                    self.content_provider.enrich_finding_location(
                        finding, asset, page_content,
                    )
                findings.extend(page_findings)
                errors.extend(page_errors)
                detector_types_run = self._merge_detector_types(
                    detector_types_run, page_types,
                )
                unflushed_count += len(page_findings)

            if unflushed_count >= findings_flush_size and unflushed_count > 0:
                logger.debug(
                    "  %s flushing %d findings (%d total)",
                    asset.name, unflushed_count, len(findings),
                )
                await on_findings_flushed(list(findings))
                unflushed_count = 0

        async for text_content in self._iter_text_content_pages(asset):
            page_index += 1
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

            task = asyncio.create_task(_detect_page(detector_content, page_index))
            pending_tasks.add(task)
            await _collect_done_and_flush()

        if pending_tasks:
            await asyncio.gather(*pending_tasks)
            await _collect_done_and_flush()

        if content_size == 0 and warn_on_empty_content:
            msg = f"No content available for asset {asset.name}"
            logger.warning(msg)
            warnings.append(msg)

        return findings, detector_types_run, content_size, warnings, errors

    # ------------------------------------------------------------------
    # Content iteration & binary detectors
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Core detector execution
    # ------------------------------------------------------------------

    async def _run_detectors(
        self,
        *,
        detectors: list[BaseDetector],
        content: str | bytes,
        content_type: str,
        asset_name: str = "",
        page_num: int | None = None,
    ) -> tuple[list[DetectionResult], list[DetectorType], list[str]]:
        """Run all compatible detectors for a single payload.

        CPU-bound detectors are routed through the process pool when
        available; I/O-bound detectors (e.g. broken_links) always run
        in the current event loop.
        """
        if not content:
            return [], [], []

        page_tag = f"p{page_num}" if page_num is not None else ""
        tasks: list[asyncio.Task[Any] | asyncio.Future[Any]] = []
        task_start_times: list[float] = []
        task_via: list[str] = []
        runnable_detectors: list[BaseDetector] = []

        for detector in detectors:
            supported = detector.get_supported_content_types()
            if not self._supports_content_type(supported, content_type):
                continue

            runnable_detectors.append(detector)
            task_start_times.append(time.monotonic())
            if self._can_use_pool(detector):
                info = self._get_detector_info(detector)
                assert info is not None
                task_via.append("pool")
                tasks.append(
                    asyncio.ensure_future(
                        self._worker_pool.run_detector(  # type: ignore[union-attr]
                            detector_name=info.detector_name,
                            detector_type=info.detector_type,
                            config_json=info.config_json,
                            content=content,
                            content_type=content_type,
                        )
                    )
                )
            else:
                task_via.append("local")
                tasks.append(
                    asyncio.ensure_future(
                        self._run_single_detector(detector, content, content_type)
                    )
                )

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

        for i, (detector, result) in enumerate(
            zip(runnable_detectors, results, strict=False)
        ):
            detector_name = detector.__class__.__name__
            via = task_via[i]
            loc = f"{asset_name}:{page_tag}" if page_tag else asset_name

            if isinstance(result, Exception):
                wall_ms = int((time.monotonic() - task_start_times[i]) * 1000)
                logger.error(
                    "  [%s] %s on %s: FAILED in %dms — %s",
                    via, detector_name, loc, wall_ms, result,
                )
                errors.append(f"{detector_name}: {result}")
                continue

            # Pool returns (findings, worker_pid, elapsed_ms); in-process returns list
            worker_pid: int | None = None
            if isinstance(result, tuple):
                finding_list, worker_pid, worker_elapsed = result
            else:
                finding_list = result
                worker_elapsed = int((time.monotonic() - task_start_times[i]) * 1000)

            detector_findings: list[DetectionResult] = []
            if isinstance(finding_list, list):
                for finding in finding_list:
                    if isinstance(finding, DetectionResult):
                        finding_with_meta = finding.model_copy(
                            update={
                                "runner_id": self.runner_id,
                                "detected_at": detected_at,
                            }
                        )
                        detector_findings.append(finding_with_meta)

            pid_tag = f"w{worker_pid}" if worker_pid else via
            if detector_findings:
                logger.info(
                    "  [%s] %s on %s: %d finding(s) in %dms",
                    pid_tag, detector_name, loc, len(detector_findings), worker_elapsed,
                )
            else:
                logger.info(
                    "  [%s] %s on %s: clean (%dms)",
                    pid_tag, detector_name, loc, worker_elapsed,
                )

            all_findings.extend(detector_findings)

        return all_findings, detector_types_run, errors

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

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
        """Run a single detector in-process."""
        return await detector.detect(content, content_type)

    def _text_content_type_for_asset(
        self,
        asset_type: OutputAssetType,
        ocr_enabled: bool,
    ) -> str | None:
        mapping = {
            OutputAssetType.TXT: "text/plain",
            OutputAssetType.TABLE: "text/plain",
            OutputAssetType.URL: "text/html",
        }
        if asset_type in mapping:
            return mapping[asset_type]
        if ocr_enabled and asset_type in {OutputAssetType.IMAGE, OutputAssetType.BINARY}:
            return "text/plain"
        return None

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
        for ct in detector.get_supported_content_types():
            if ct.startswith(("image/", "audio/", "video/")) or ct == "application/octet-stream":
                return True
        return False

    @staticmethod
    def _detector_log_label(detector: BaseDetector) -> str:
        config_name = getattr(getattr(detector, "config", None), "name", None)
        if isinstance(config_name, str) and config_name.strip():
            return config_name.strip()

        detector_name = getattr(detector, "detector_name", "")
        if isinstance(detector_name, str) and detector_name.strip() and detector_name != "base":
            return detector_name.strip()

        return detector.__class__.__name__

    @staticmethod
    def _asset_has_binary_primary_payload(asset_type: OutputAssetType) -> bool:
        return asset_type in {
            OutputAssetType.IMAGE,
            OutputAssetType.VIDEO,
            OutputAssetType.AUDIO,
            OutputAssetType.BINARY,
            OutputAssetType.OTHER,
        }

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

    def _supports_content_type(self, supported: list[str], content_type: str) -> bool:
        if content_type in supported:
            return True

        for supported_type in supported:
            if supported_type.endswith("/*"):
                prefix = supported_type[:-1]
                if content_type.startswith(prefix):
                    return True

        if content_type == "text/html" and "text/plain" in supported:
            return True

        return False

    async def _fetch_content(self, asset: SingleAssetScanResults) -> tuple[str, str]:
        content_type = self._asset_type_to_content_type(asset.asset_type)

        async for text_content in self._iter_text_content_pages(asset):
            return text_content, content_type

        return "", content_type

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_recipe(
        cls,
        recipe: dict[str, Any],
        source: BaseSource,
        runner_id: str,
        max_concurrent_assets: int = 10,
        worker_pool: DetectorWorkerPool | None = None,
    ) -> DetectorPipeline:
        """Create pipeline from recipe configuration."""
        from ..detectors import get_detector
        from ..detectors.config import parse_detector_config

        detector_configs = recipe.get("detectors", [])

        if not detector_configs:
            return cls(
                detectors=[], source=source, runner_id=runner_id,
                worker_pool=worker_pool,
            )

        detectors: list[BaseDetector] = []
        detector_infos: list[tuple[BaseDetector, _DetectorInfo]] = []
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

                config_json = typed_config.model_dump_json()
                info = _DetectorInfo(
                    detector_name=detector_name,
                    detector_type=detector_type,
                    config_json=config_json,
                )
                detector_infos.append((detector, info))

                logger.info("Initialized detector: %s", detector_name)
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
            worker_pool=worker_pool,
        )
        for detector, info in detector_infos:
            pipeline._register_detector_info(detector, info)
        pipeline.init_warnings = init_warnings
        return pipeline
