from __future__ import annotations

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
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.base import BaseSource


class DummySource(BaseSource):
    def __init__(self, recipe: dict[str, Any], content: str) -> None:
        super().__init__(recipe)
        self._content = content

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        return ("<p>raw</p>", self._content)


class NoFetchSource(DummySource):
    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        raise AssertionError(f"fetch_content must not be called for asset {asset_id}")


class HashResolvingSource(NoFetchSource):
    def __init__(
        self,
        recipe: dict[str, Any],
        content: str,
        mapping: dict[str, str],
    ) -> None:
        super().__init__(recipe, content)
        self.mapping = mapping

    def resolve_link_for_detection(self, link: str) -> str | None:
        return self.mapping.get(link)


class RecordingDetector(BaseDetector):
    detector_type = "secrets"
    detector_name = "recording"

    def __init__(self, supported: list[str], config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.supported = supported
        self.seen: list[str] = []
        self.seen_content_types: list[str] = []

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        self.seen.append(content)
        self.seen_content_types.append(content_type)
        return [
            DetectionResult(
                detector_type=DetectorType.SECRETS,
                finding_type="recording",
                category="SECRETS",
                severity=Severity.info,
                confidence=0.99,
                matched_content=content,
                location=Location(start=0, end=len(content)).model_dump(exclude_none=True),
            )
        ]

    def get_supported_content_types(self) -> list[str]:
        return self.supported


class LinkRecordingDetector(BaseDetector):
    detector_type = "broken_links"
    detector_name = "link_recording"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.seen: list[tuple[str, str]] = []

    async def detect(
        self, content: str, content_type: str = "application/x.asset-links"
    ) -> list[DetectionResult]:
        self.seen.append((content_type, content))
        return []

    def get_supported_content_types(self) -> list[str]:
        return ["application/x.asset-links"]


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


def make_url_asset(
    asset_id: str = "url-1",
    *,
    links: list[str] | None = None,
) -> SingleAssetScanResults:
    now = datetime.now(UTC)
    return SingleAssetScanResults(
        hash=asset_id,
        checksum="checksum",
        name=f"asset-{asset_id}",
        external_url=f"urn:test/{asset_id}",
        links=links or [],
        asset_type=AssetType.URL,
        created_at=now,
        updated_at=now,
    )


def make_table_asset(asset_id: str = "table-1") -> SingleAssetScanResults:
    now = datetime.now(UTC)
    return SingleAssetScanResults(
        hash=asset_id,
        checksum="checksum",
        name=f"asset-{asset_id}",
        external_url=f"urn:test/{asset_id}",
        links=[],
        asset_type=AssetType.TABLE,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_pipeline_runs_text_detectors_only() -> None:
    source = DummySource({"type": "DUMMY"}, content="hello world")
    text_detector = RecordingDetector(["text/plain"])
    image_detector = RecordingDetector(["image/png"])

    pipeline = DetectorPipeline(
        detectors=[text_detector, image_detector],
        source=source,
        runner_id="runner-1",
    )

    results = await pipeline.process([make_asset()])
    assert len(results) == 1

    # Only text detector should run
    assert text_detector.seen == ["hello world"]
    assert image_detector.seen == []
    assert text_detector.seen_content_types == ["text/plain"]


@pytest.mark.asyncio
async def test_pipeline_truncates_content_and_sets_scan_stats() -> None:
    content = "x" * 25
    source = DummySource({"type": "DUMMY"}, content=content)
    detector = RecordingDetector(["text/plain"])

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-2",
        content_size_limit=10,
    )

    [asset] = await pipeline.process([make_asset("2")])
    assert asset.findings is not None
    assert len(asset.findings) == 1

    # Content should be truncated before detection
    assert asset.findings[0].matched_content == "x" * 10

    # Scan stats should reflect original content size and detectors run
    assert asset.scan_stats is not None
    assert asset.scan_stats.content_size_bytes == len(content)
    assert asset.scan_stats.findings_count == 1
    assert DetectorType.SECRETS in asset.scan_stats.detectors_run


@pytest.mark.asyncio
async def test_pipeline_allows_text_plain_detectors_for_url_assets() -> None:
    source = DummySource({"type": "DUMMY"}, content="hello from html")
    detector = RecordingDetector(["text/plain"])

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-3",
    )

    [asset] = await pipeline.process([make_url_asset()])
    assert asset.findings is not None
    assert len(asset.findings) == 1
    assert detector.seen == ["hello from html"]
    assert detector.seen_content_types == ["text/html"]


@pytest.mark.asyncio
async def test_pipeline_allows_text_plain_detectors_for_table_assets() -> None:
    source = DummySource({"type": "DUMMY"}, content="table payload")
    detector = RecordingDetector(["text/plain"])

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-3a",
    )

    [asset] = await pipeline.process([make_table_asset()])
    assert asset.findings is not None
    assert len(asset.findings) == 1
    assert detector.seen == ["table payload"]
    assert detector.seen_content_types == ["text/plain"]


@pytest.mark.asyncio
async def test_pipeline_runs_broken_links_detector_on_asset_links() -> None:
    source = NoFetchSource({"type": "DUMMY"}, content="")
    link_detector = LinkRecordingDetector()
    pipeline = DetectorPipeline(
        detectors=[link_detector],
        source=source,
        runner_id="runner-link-only",
    )

    [asset] = await pipeline.process(
        [
            make_url_asset(
                links=[
                    "https://example.com/a",
                    "https://example.com/b",
                    "https://example.com/a",
                ]
            )
        ]
    )

    assert link_detector.seen == [
        ("application/x.asset-links", "https://example.com/a\nhttps://example.com/b")
    ]
    assert asset.scan_stats is not None
    assert asset.scan_stats.content_size_bytes == 0
    assert DetectorType.BROKEN_LINKS in asset.scan_stats.detectors_run


@pytest.mark.asyncio
async def test_pipeline_runs_text_and_link_detectors_together() -> None:
    source = DummySource({"type": "DUMMY"}, content="hello from html")
    text_detector = RecordingDetector(["text/plain"])
    link_detector = LinkRecordingDetector()
    pipeline = DetectorPipeline(
        detectors=[text_detector, link_detector],
        source=source,
        runner_id="runner-mixed",
    )

    [asset] = await pipeline.process(
        [make_url_asset(links=["https://example.com/ok", "https://example.com/broken"])]
    )

    assert text_detector.seen == ["hello from html"]
    assert text_detector.seen_content_types == ["text/html"]
    assert link_detector.seen == [
        (
            "application/x.asset-links",
            "https://example.com/ok\nhttps://example.com/broken",
        )
    ]
    assert asset.scan_stats is not None
    assert DetectorType.SECRETS in asset.scan_stats.detectors_run
    assert DetectorType.BROKEN_LINKS in asset.scan_stats.detectors_run


@pytest.mark.asyncio
async def test_pipeline_resolves_hashed_links_before_link_detection() -> None:
    source = HashResolvingSource(
        {"type": "DUMMY"},
        content="",
        mapping={
            "hash-a": "https://example.com/a",
            "hash-b": "https://example.com/b",
        },
    )
    link_detector = LinkRecordingDetector()
    pipeline = DetectorPipeline(
        detectors=[link_detector],
        source=source,
        runner_id="runner-hash-links",
    )

    await pipeline.process([make_url_asset(links=["hash-a", "hash-b", "hash-a"])])

    assert link_detector.seen == [
        (
            "application/x.asset-links",
            "https://example.com/a\nhttps://example.com/b",
        )
    ]
