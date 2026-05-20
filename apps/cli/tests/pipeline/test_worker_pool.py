"""Tests for the DetectorWorkerPool process-pool execution engine."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

import pytest

from src.detectors.base import BaseDetector
from src.models.generated_detectors import DetectorConfig, Severity
from src.models.generated_single_asset_scan_results import (
    AssetType,
    DetectionResult,
    DetectorType,
    Location,
    SingleAssetScanResults,
)
from src.pipeline.detector_pipeline import DetectorPipeline, _DetectorInfo
from src.pipeline.worker_pool import (
    DetectorWorkerPool,
    is_io_bound_detector,
)
from src.sources.base import BaseSource


# ---------------------------------------------------------------------------
# Helpers — sources extend BaseSource so ParsedContentProvider works
# ---------------------------------------------------------------------------


class DummySource(BaseSource):
    def __init__(self, recipe: dict[str, Any], content: str) -> None:
        super().__init__(recipe)
        self._content = content

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        return ("<p>raw</p>", self._content)


class PagedSource(DummySource):
    def __init__(self, recipe: dict[str, Any], pages: list[str]) -> None:
        super().__init__(recipe, content="")
        self.pages = pages

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        raise AssertionError("fetch_content must not be called for paged sources")

    async def fetch_content_pages(self, asset_id: str):
        for index, page in enumerate(self.pages, start=1):
            yield (f"<p>raw-{index}</p>", page)


class RecordingDetector(BaseDetector):
    """In-process test detector (not available in worker processes)."""

    detector_type = "secrets"
    detector_name = "recording"

    def __init__(self, supported: list[str] | None = None, config: DetectorConfig | None = None):
        super().__init__(config)
        self.supported = supported or ["text/plain"]
        self.seen: list[str | bytes] = []

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        self.seen.append(content)
        text = content if isinstance(content, str) else content.decode()
        return [
            DetectionResult(
                detector_type=DetectorType.SECRETS,
                finding_type="recording",
                category="SECRETS",
                severity=Severity.info,
                confidence=0.99,
                matched_content=text,
                location=Location(start=0, end=len(text)),
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return self.supported


def make_asset(asset_id: str = "1") -> SingleAssetScanResults:
    now = datetime.now(UTC)
    return SingleAssetScanResults(
        hash=asset_id,
        checksum="checksum",
        name=f"asset-{asset_id}",
        external_url=f"urn:test/{asset_id}",
        links=[],
        asset_type=AssetType.TXT,
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Unit tests: module-level helpers
# ---------------------------------------------------------------------------


def test_is_io_bound_detector_broken_links() -> None:
    assert is_io_bound_detector("broken_links") is True


def test_is_io_bound_detector_pii() -> None:
    assert is_io_bound_detector("pii") is False


def test_is_io_bound_detector_secrets() -> None:
    assert is_io_bound_detector("secrets") is False


# ---------------------------------------------------------------------------
# Pool lifecycle
# ---------------------------------------------------------------------------


def test_pool_create_and_shutdown() -> None:
    pool = DetectorWorkerPool(max_workers=2, mp_start_method="forkserver")
    assert pool.max_workers == 2
    pool.shutdown(wait=True)


def test_pool_double_shutdown_is_safe() -> None:
    pool = DetectorWorkerPool(max_workers=1, mp_start_method="forkserver")
    pool.shutdown()
    pool.shutdown()


def test_pool_context_manager() -> None:
    with DetectorWorkerPool(max_workers=1, mp_start_method="forkserver") as pool:
        assert pool.max_workers == 1


def test_pool_caps_workers_at_16() -> None:
    pool = DetectorWorkerPool(max_workers=32, mp_start_method="forkserver")
    assert pool.max_workers == 16
    pool.shutdown()


def test_pool_min_workers_is_1() -> None:
    pool = DetectorWorkerPool(max_workers=0, mp_start_method="forkserver")
    assert pool.max_workers == 1
    pool.shutdown()


# ---------------------------------------------------------------------------
# Pool detection — uses the real secrets detector from the registry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pool_run_detector_returns_findings() -> None:
    """Submit content with an AWS key pattern to the secrets detector via the pool."""
    pool = DetectorWorkerPool(max_workers=2, mp_start_method="forkserver")
    try:
        content = "AKIAIOSFODNN7EXAMPLE"
        findings, worker_pid, elapsed_ms = await pool.run_detector(
            detector_name="secrets",
            detector_type="SECRETS",
            config_json="{}",
            content=content,
            content_type="text/plain",
        )
        assert len(findings) >= 1
        assert all(isinstance(r, DetectionResult) for r in findings)
        assert isinstance(worker_pid, int) and worker_pid > 0
        assert isinstance(elapsed_ms, int) and elapsed_ms >= 0
    finally:
        pool.shutdown()


@pytest.mark.asyncio
async def test_pool_run_detector_no_findings_for_clean_content() -> None:
    """Clean content should return zero findings."""
    pool = DetectorWorkerPool(max_workers=1, mp_start_method="forkserver")
    try:
        findings, worker_pid, elapsed_ms = await pool.run_detector(
            detector_name="secrets",
            detector_type="SECRETS",
            config_json="{}",
            content="Hello, this is perfectly normal text.",
            content_type="text/plain",
        )
        assert findings == []
        assert isinstance(worker_pid, int) and worker_pid > 0
    finally:
        pool.shutdown()


@pytest.mark.asyncio
async def test_pool_concurrent_detections() -> None:
    """Submit multiple tasks concurrently and verify all return."""
    pool = DetectorWorkerPool(max_workers=4, mp_start_method="forkserver")
    try:
        content = "AKIAIOSFODNN7EXAMPLE"
        tasks = [
            pool.run_detector(
                detector_name="secrets",
                detector_type="SECRETS",
                config_json="{}",
                content=f"{content} #{i}",
                content_type="text/plain",
            )
            for i in range(8)
        ]
        results = await asyncio.gather(*tasks)
        assert len(results) == 8
        for findings, worker_pid, elapsed_ms in results:
            assert len(findings) >= 1
            assert worker_pid > 0
    finally:
        pool.shutdown()


@pytest.mark.asyncio
async def test_pool_raises_after_shutdown() -> None:
    pool = DetectorWorkerPool(max_workers=1, mp_start_method="forkserver")
    pool.shutdown()

    with pytest.raises(RuntimeError, match="shut down"):
        await pool.run_detector(
            detector_name="secrets",
            detector_type="SECRETS",
            config_json="{}",
            content="too late",
            content_type="text/plain",
        )


# ---------------------------------------------------------------------------
# Pipeline integration — in-process (pool=None)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pipeline_without_pool_falls_back_to_in_process() -> None:
    """When pool is None, detectors run in-process as before."""
    source = DummySource({"type": "DUMMY"}, content="inline data")
    detector = RecordingDetector()

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="test-no-pool",
        worker_pool=None,
    )

    [result] = await pipeline.process([make_asset()])
    assert result.findings is not None
    assert len(result.findings) == 1
    assert detector.seen == ["inline data"]


@pytest.mark.asyncio
async def test_pipeline_with_pool_processes_asset() -> None:
    """Pipeline routes detection through the pool when detector info is registered."""
    pool = DetectorWorkerPool(max_workers=2, mp_start_method="forkserver")
    try:
        content = "AKIAIOSFODNN7EXAMPLE"
        source = DummySource({"type": "DUMMY"}, content=content)

        from src.detectors import get_detector

        detector = get_detector("secrets", None)

        pipeline = DetectorPipeline(
            detectors=[detector],
            source=source,
            runner_id="test-pool",
            worker_pool=pool,
        )
        pipeline._register_detector_info(
            detector,
            _DetectorInfo(
                detector_name="secrets",
                detector_type="SECRETS",
                config_json="{}",
            ),
        )

        [result] = await pipeline.process([make_asset()])
        assert result.findings is not None
        assert len(result.findings) >= 1
        assert result.scan_stats is not None
        assert result.scan_stats.duration_ms >= 0
    finally:
        pool.shutdown()


# ---------------------------------------------------------------------------
# Streaming mode — concurrent pages with flush
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_streaming_mode_processes_pages_concurrently() -> None:
    """Streaming mode should process pages concurrently and flush results."""
    pages = [f"page content number {i}" for i in range(6)]
    source = PagedSource({"type": "DUMMY"}, pages=pages)
    detector = RecordingDetector()

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="test-streaming",
        max_concurrent_assets=3,
        worker_pool=None,
    )

    flush_calls: list[int] = []

    async def on_flush(findings: list[DetectionResult]) -> None:
        flush_calls.append(len(findings))

    asset = make_asset("stream-1")
    asset.asset_type = AssetType.TABLE

    result = await pipeline.process_single_asset(
        asset,
        on_findings_flushed=on_flush,
        findings_flush_size=3,
    )

    assert result.findings is not None
    assert len(result.findings) == 6
    assert len(flush_calls) >= 1


@pytest.mark.asyncio
async def test_streaming_flush_fires_at_threshold() -> None:
    """Flush callback fires when findings reach the threshold."""
    pages = [f"page {i}" for i in range(10)]
    source = PagedSource({"type": "DUMMY"}, pages=pages)
    detector = RecordingDetector()

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="test-flush",
        max_concurrent_assets=2,
        worker_pool=None,
    )

    flush_payloads: list[list[DetectionResult]] = []

    async def on_flush(findings: list[DetectionResult]) -> None:
        flush_payloads.append(list(findings))

    asset = make_asset("flush-1")
    asset.asset_type = AssetType.TABLE

    result = await pipeline.process_single_asset(
        asset,
        on_findings_flushed=on_flush,
        findings_flush_size=4,
    )

    assert result.findings is not None
    assert len(result.findings) == 10
    # With 10 findings and flush size 4, should flush at least once
    assert len(flush_payloads) >= 1
    # Each flush payload is a snapshot of accumulated findings so far
    for payload in flush_payloads:
        assert len(payload) >= 4


# ---------------------------------------------------------------------------
# Pipeline with pool — multiple assets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pool_pipeline_multiple_assets() -> None:
    """Multiple assets processed through the pool return correct results."""
    pool = DetectorWorkerPool(max_workers=4, mp_start_method="forkserver")
    try:
        content = "AKIAIOSFODNN7EXAMPLE"
        source = DummySource({"type": "DUMMY"}, content=content)

        from src.detectors import get_detector

        detector = get_detector("secrets", None)

        pipeline = DetectorPipeline(
            detectors=[detector],
            source=source,
            runner_id="test-multi",
            worker_pool=pool,
        )
        pipeline._register_detector_info(
            detector,
            _DetectorInfo(
                detector_name="secrets",
                detector_type="SECRETS",
                config_json="{}",
            ),
        )

        assets = [make_asset(str(i)) for i in range(4)]
        results = await pipeline.process(assets)

        assert len(results) == 4
        for r in results:
            assert r.findings is not None
            assert len(r.findings) >= 1
    finally:
        pool.shutdown()
