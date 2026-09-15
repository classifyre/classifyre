"""Run-scoped detector breaker.

Measured origin: an LLM detector whose free-tier provider refused its key failed
on 451 of 451 assets per run, 120-157 minutes each, holding the only runner slot
the whole time. The first refusal was already the answer for every asset.

The breaker's contract has two halves and both are asserted here: a disabled
detector is not dispatched again this run, and every asset it skips still
reports an ERROR outcome — which is what keeps that asset's findings and keeps
it out of the scan cache.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from src.detectors.base import BaseDetector
from src.detectors.errors import ProviderRefusedError
from src.models.generated_detectors import DetectorConfig, Severity
from src.models.generated_single_asset_scan_results import (
    AssetType,
    DetectionResult,
    DetectorType,
    Location,
    SingleAssetScanResults,
    Status,
)
from src.pipeline.detector_breaker import BREAKER_OUTCOME_PREFIX
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.base import BaseSource


class _Source(BaseSource):
    def __init__(self, pages: list[str] | None = None) -> None:
        super().__init__({"type": "DUMMY"})
        self.pages = pages or ["hello world"]

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self):
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        return ("<p>raw</p>", self.pages[0])

    async def fetch_content_pages(self, asset_id: str):
        for index, page in enumerate(self.pages, start=1):
            yield (f"<p>raw-{index}</p>", page)


class _CustomDetector(BaseDetector):
    """Shaped like CustomDetector where the breaker looks: key and budget."""

    detector_type = "custom"
    detector_name = "custom"

    def __init__(self, key: str, budget: Any = None) -> None:
        super().__init__(None)
        self.custom_config = SimpleNamespace(
            custom_detector_key=key,
            pipeline_schema=SimpleNamespace(budget=budget),
        )
        self.calls = 0

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


class _RefusingDetector(_CustomDetector):
    async def detect(self, content, content_type="text/plain") -> list[DetectionResult]:
        self.calls += 1
        raise ProviderRefusedError(
            "LLM provider refused detector 'fb_solvency_outlook' (quota exhausted): "
            "Rate limit exceeded: free-models-per-day"
        )


class _CrashingDetector(_CustomDetector):
    async def detect(self, content, content_type="text/plain") -> list[DetectionResult]:
        self.calls += 1
        raise RuntimeError("model output could not be parsed")


class _AlternatingDetector(_CustomDetector):
    async def detect(self, content, content_type="text/plain") -> list[DetectionResult]:
        self.calls += 1
        if self.calls % 2:
            raise RuntimeError("flaky")
        return []


class _SlowDetector(_CustomDetector):
    async def detect(self, content, content_type="text/plain") -> list[DetectionResult]:
        self.calls += 1
        await asyncio.sleep(1.05)
        return []


class _OkDetector(BaseDetector):
    detector_type = "pii"
    detector_name = "ok_detector"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.calls = 0

    async def detect(self, content, content_type="text/plain") -> list[DetectionResult]:
        self.calls += 1
        return [
            DetectionResult(
                detector_type=DetectorType.PII,
                finding_type="EMAIL_ADDRESS",
                category="pii",
                severity=Severity.medium,
                confidence=0.9,
                matched_content="a@b.com",
                location=Location(start=0, end=7).model_dump(exclude_none=True),
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


def _asset(index: int) -> SingleAssetScanResults:
    now = datetime.now(UTC)
    return SingleAssetScanResults(
        hash=f"asset-{index}",
        checksum="checksum",
        name=f"asset-{index}",
        external_url=f"urn:test/{index}",
        links=[],
        asset_type=AssetType.TXT,
        created_at=now,
        updated_at=now,
    )


async def _scan(pipeline: DetectorPipeline, count: int) -> list[SingleAssetScanResults]:
    # One at a time: a run dispatches assets concurrently, but whether the
    # breaker stops *later* assets is only observable in order.
    return [await pipeline.process_single_asset(_asset(i)) for i in range(count)]


def _outcome(asset: SingleAssetScanResults, detector_type: DetectorType) -> Any:
    assert asset.scan_stats is not None and asset.scan_stats.detector_outcomes
    [outcome] = [o for o in asset.scan_stats.detector_outcomes if o.detector_type == detector_type]
    return outcome


@pytest.mark.asyncio
async def test_provider_refusal_disables_the_detector_for_the_rest_of_the_run() -> None:
    detector = _RefusingDetector("fb_solvency_outlook")
    pipeline = DetectorPipeline(detectors=[detector], source=_Source(), runner_id="r")

    assets = await _scan(pipeline, 5)

    assert detector.calls == 1
    first = _outcome(assets[0], DetectorType.CUSTOM)
    assert first.status == Status.ERROR
    assert "free-models-per-day" in (first.error or "")
    for asset in assets[1:]:
        skipped = _outcome(asset, DetectorType.CUSTOM)
        # ERROR, not absent: absent would let the API resolve this asset's
        # findings and let the scan cache bank the asset as done.
        assert skipped.status == Status.ERROR
        assert (skipped.error or "").startswith(f"{BREAKER_OUTCOME_PREFIX}[provider_refused]")
        assert skipped.custom_detector_key == "fb_solvency_outlook"

    [summary] = pipeline.breaker_summary()
    assert summary["cause"] == "provider_refused"
    assert summary["skipped_payloads"] == 4


@pytest.mark.asyncio
async def test_other_detectors_keep_running_when_one_is_disabled() -> None:
    refusing = _RefusingDetector("fb_solvency_outlook")
    ok = _OkDetector()
    pipeline = DetectorPipeline(detectors=[refusing, ok], source=_Source(), runner_id="r")

    assets = await _scan(pipeline, 4)

    assert ok.calls == 4
    for asset in assets:
        assert _outcome(asset, DetectorType.PII).status == Status.OK
        assert any(f.finding_type == "EMAIL_ADDRESS" for f in asset.findings)


@pytest.mark.asyncio
async def test_two_custom_detectors_do_not_share_a_breaker() -> None:
    refusing = _RefusingDetector("llm_a")
    crashing_once = _AlternatingDetector("regex_b")
    pipeline = DetectorPipeline(
        detectors=[refusing, crashing_once], source=_Source(), runner_id="r"
    )

    await _scan(pipeline, 4)

    assert refusing.calls == 1
    assert crashing_once.calls == 4


@pytest.mark.asyncio
async def test_consecutive_failures_trip_after_the_default_ten() -> None:
    detector = _CrashingDetector("brittle")
    pipeline = DetectorPipeline(detectors=[detector], source=_Source(), runner_id="r")

    assets = await _scan(pipeline, 12)

    assert detector.calls == 10
    for asset in assets[10:]:
        assert (_outcome(asset, DetectorType.CUSTOM).error or "").startswith(
            f"{BREAKER_OUTCOME_PREFIX}[consecutive_failures]"
        )


@pytest.mark.asyncio
async def test_budget_tightens_the_consecutive_failure_limit() -> None:
    budget = SimpleNamespace(max_consecutive_failures=2, max_wall_clock_seconds=None)
    detector = _CrashingDetector("brittle", budget=budget)
    pipeline = DetectorPipeline(detectors=[detector], source=_Source(), runner_id="r")

    await _scan(pipeline, 5)

    assert detector.calls == 2


@pytest.mark.asyncio
async def test_a_success_resets_the_consecutive_count() -> None:
    budget = SimpleNamespace(max_consecutive_failures=2, max_wall_clock_seconds=None)
    detector = _AlternatingDetector("flaky", budget=budget)
    pipeline = DetectorPipeline(detectors=[detector], source=_Source(), runner_id="r")

    await _scan(pipeline, 6)

    assert detector.calls == 6
    assert pipeline.breaker_summary() == []


@pytest.mark.asyncio
async def test_wall_clock_budget_disables_a_slow_detector() -> None:
    budget = SimpleNamespace(max_consecutive_failures=None, max_wall_clock_seconds=1)
    detector = _SlowDetector("slow", budget=budget)
    pipeline = DetectorPipeline(detectors=[detector], source=_Source(), runner_id="r")

    assets = await _scan(pipeline, 3)

    assert detector.calls == 1
    assert (_outcome(assets[2], DetectorType.CUSTOM).error or "").startswith(
        f"{BREAKER_OUTCOME_PREFIX}[wall_clock_budget]"
    )


@pytest.mark.asyncio
async def test_a_skipped_asset_carries_one_error_line_however_many_pages() -> None:
    detector = _RefusingDetector("fb_solvency_outlook")
    pipeline = DetectorPipeline(
        detectors=[detector],
        source=_Source(pages=["page one", "page two", "page three"]),
        runner_id="r",
    )

    _, skipped = await _scan(pipeline, 2)

    assert skipped.scan_stats is not None
    breaker_lines = [
        line for line in (skipped.scan_stats.errors or []) if BREAKER_OUTCOME_PREFIX in line
    ]
    assert len(breaker_lines) == 1
