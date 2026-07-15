"""Per-detector outcome reporting (G-021 / G-014).

`detectors_run` is built from the list of detectors that were *attempted*,
before any result is inspected, so a detector that crashed on every page is
still reported as having run. The API had no way to tell "ran clean, found
nothing" from "crashed, result unknown" — so it resolved the crashed detector's
prior findings as "no longer present in scan", and still reported the run
COMPLETED with zero errors.

`scan_stats.detector_outcomes` carries that distinction.
"""

from __future__ import annotations

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
    Status,
)
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.base import BaseSource


class _Source(BaseSource):
    def __init__(self, recipe: dict[str, Any], content: str) -> None:
        super().__init__(recipe)
        self._content = content

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self):
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        return ("<p>raw</p>", self._content)


class _PagedSource(_Source):
    def __init__(self, recipe: dict[str, Any], pages: list[str]) -> None:
        super().__init__(recipe, content="")
        self.pages = pages

    async def fetch_content_pages(self, asset_id: str):
        for index, page in enumerate(self.pages, start=1):
            yield (f"<p>raw-{index}</p>", page)


class _OkDetector(BaseDetector):
    detector_type = "pii"
    detector_name = "ok_detector"

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
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


class _SilentButCleanDetector(BaseDetector):
    """Completes successfully and finds nothing — its silence is trustworthy."""

    detector_type = "secrets"
    detector_name = "silent_detector"

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        return []

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


class _CrashingDetector(BaseDetector):
    """Raises the way PII did on every page of the corpus run (G-011)."""

    detector_type = "secrets"
    detector_name = "crashing_detector"

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        raise TypeError("unsupported operand type(s) for -: 'ChunkSize' and 'ChunkOverlap'")

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


class _FlakyDetector(BaseDetector):
    """Succeeds on the first page, then raises. Its overall result is unknown."""

    detector_type = "secrets"
    detector_name = "flaky_detector"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.calls = 0

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        self.calls += 1
        if self.calls == 1:
            return []
        raise RuntimeError("model died on page 2")

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


def _asset(asset_id: str = "1") -> SingleAssetScanResults:
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


def _outcomes_by_type(asset: SingleAssetScanResults) -> dict[DetectorType, Status]:
    assert asset.scan_stats is not None
    assert asset.scan_stats.detector_outcomes is not None
    return {o.detector_type: o.status for o in asset.scan_stats.detector_outcomes}


@pytest.mark.asyncio
async def test_successful_detector_reports_ok() -> None:
    source = _Source({"type": "DUMMY"}, content="hello world")
    pipeline = DetectorPipeline(detectors=[_OkDetector()], source=source, runner_id="runner-1")

    [asset] = await pipeline.process([_asset()])

    assert _outcomes_by_type(asset) == {DetectorType.PII: Status.OK}


@pytest.mark.asyncio
async def test_clean_detector_with_no_findings_still_reports_ok() -> None:
    # The crucial distinction: finding nothing is a valid result, and callers
    # may safely resolve this detector's prior findings.
    source = _Source({"type": "DUMMY"}, content="hello world")
    pipeline = DetectorPipeline(
        detectors=[_SilentButCleanDetector()], source=source, runner_id="runner-1"
    )

    [asset] = await pipeline.process([_asset()])

    assert _outcomes_by_type(asset) == {DetectorType.SECRETS: Status.OK}


@pytest.mark.asyncio
async def test_crashing_detector_reports_error_not_silence() -> None:
    source = _Source({"type": "DUMMY"}, content="hello world")
    pipeline = DetectorPipeline(
        detectors=[_CrashingDetector()], source=source, runner_id="runner-1"
    )

    [asset] = await pipeline.process([_asset()])

    outcomes = asset.scan_stats.detector_outcomes
    assert outcomes is not None
    assert len(outcomes) == 1
    assert outcomes[0].status == Status.ERROR
    assert "ChunkSize" in (outcomes[0].error or "")


@pytest.mark.asyncio
async def test_crashing_detector_is_still_listed_in_detectors_run() -> None:
    # detectors_run keeps its "attempted" meaning; the outcome carries the
    # truth. This is why the old code was fooled.
    source = _Source({"type": "DUMMY"}, content="hello world")
    pipeline = DetectorPipeline(
        detectors=[_CrashingDetector()], source=source, runner_id="runner-1"
    )

    [asset] = await pipeline.process([_asset()])

    assert DetectorType.SECRETS in asset.scan_stats.detectors_run
    assert _outcomes_by_type(asset) == {DetectorType.SECRETS: Status.ERROR}


@pytest.mark.asyncio
async def test_one_detector_crashing_does_not_taint_another() -> None:
    # The exact G-021 shape: one detector works, another dies. The working
    # one's findings must not be collateral damage.
    source = _Source({"type": "DUMMY"}, content="hello world")
    pipeline = DetectorPipeline(
        detectors=[_OkDetector(), _CrashingDetector()],
        source=source,
        runner_id="runner-1",
    )

    [asset] = await pipeline.process([_asset()])

    assert _outcomes_by_type(asset) == {
        DetectorType.PII: Status.OK,
        DetectorType.SECRETS: Status.ERROR,
    }


@pytest.mark.asyncio
async def test_detector_failing_on_any_page_is_error_overall() -> None:
    # Succeeding on page 1 and dying on page 2 means we do not know what page 2
    # held. Reporting OK would let a caller resolve findings that may still be
    # there.
    source = _PagedSource({"type": "DUMMY"}, pages=["page one", "page two"])
    pipeline = DetectorPipeline(detectors=[_FlakyDetector()], source=source, runner_id="runner-1")

    [asset] = await pipeline.process([_asset()])

    assert _outcomes_by_type(asset) == {DetectorType.SECRETS: Status.ERROR}


@pytest.mark.asyncio
async def test_detector_succeeding_on_all_pages_is_ok() -> None:
    source = _PagedSource({"type": "DUMMY"}, pages=["page one", "page two"])
    pipeline = DetectorPipeline(
        detectors=[_SilentButCleanDetector()], source=source, runner_id="runner-1"
    )

    [asset] = await pipeline.process([_asset()])

    assert _outcomes_by_type(asset) == {DetectorType.SECRETS: Status.OK}
