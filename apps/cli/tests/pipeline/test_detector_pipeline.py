from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from types import SimpleNamespace
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

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
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


class PagedSource(NoFetchSource):
    def __init__(self, recipe: dict[str, Any], pages: list[str]) -> None:
        super().__init__(recipe, content="")
        self.pages = pages

    async def fetch_content_pages(self, asset_id: str):
        for index, page in enumerate(self.pages, start=1):
            yield (f"<p>raw-{index}</p>", page)


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
        self.seen: list[str | bytes] = []
        self.seen_content_types: list[str] = []

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        self.seen.append(content)
        self.seen_content_types.append(content_type)
        matched = content if isinstance(content, str) else content.decode("utf-8", errors="replace")
        return [
            DetectionResult(
                detector_type=DetectorType.SECRETS,
                finding_type="recording",
                category="SECRETS",
                severity=Severity.info,
                confidence=0.99,
                matched_content=matched,
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
        self, content: str | bytes, content_type: str = "application/x.asset-links"
    ) -> list[DetectionResult]:
        self.seen.append((content_type, content))
        return []

    def get_supported_content_types(self) -> list[str]:
        return ["application/x.asset-links"]


class NamedDetectorConfig(DetectorConfig):
    name: str | None = None


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


def make_table_asset(
    asset_id: str = "table-1",
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
async def test_pipeline_logs_configured_detector_name(caplog: pytest.LogCaptureFixture) -> None:
    source = DummySource({"type": "DUMMY"}, content="hello world")
    detector = RecordingDetector(
        ["text/plain"], config=NamedDetectorConfig(name="Invoice Classifier")
    )

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-log-name",
    )

    with caplog.at_level("INFO", logger="src.pipeline.detector_pipeline"):
        await pipeline.process([make_asset("log-name")])

    assert "Scanning asset-log-name [Invoice Classifier]" in caplog.text


@pytest.mark.asyncio
async def test_pipeline_passes_full_content_and_sets_scan_stats() -> None:
    content = "x" * 25
    source = DummySource({"type": "DUMMY"}, content=content)
    detector = RecordingDetector(["text/plain"])

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-2",
    )

    [asset] = await pipeline.process([make_asset("2")])
    assert asset.findings is not None
    assert len(asset.findings) == 1

    # Full content should be passed to detectors
    assert asset.findings[0].matched_content == content

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
async def test_pipeline_processes_text_content_page_by_page_and_links_once() -> None:
    source = PagedSource({"type": "DUMMY"}, pages=["page one", "page two"])
    text_detector = RecordingDetector(["text/plain"])
    link_detector = LinkRecordingDetector()
    pipeline = DetectorPipeline(
        detectors=[text_detector, link_detector],
        source=source,
        runner_id="runner-paged",
    )

    [asset] = await pipeline.process(
        [make_table_asset(links=["https://example.com/a", "https://example.com/b"])]
    )

    assert text_detector.seen == ["page one", "page two"]
    assert text_detector.seen_content_types == ["text/plain", "text/plain"]
    assert link_detector.seen == [
        (
            "application/x.asset-links",
            "https://example.com/a\nhttps://example.com/b",
        )
    ]
    assert asset.findings is not None
    assert len(asset.findings) == 2
    assert asset.scan_stats is not None
    assert asset.scan_stats.content_size_bytes == len("page one") + len("page two")
    assert DetectorType.SECRETS in asset.scan_stats.detectors_run
    assert DetectorType.BROKEN_LINKS in asset.scan_stats.detectors_run


@pytest.mark.asyncio
async def test_pipeline_fails_scan_when_content_fetch_raises() -> None:
    """A connection error during content fetch must propagate and fail the scan."""

    class FailingSource(NoFetchSource):
        async def fetch_content_pages(self, asset_id: str):
            raise ConnectionError("Can't connect to MySQL server (timed out)")
            yield  # make it an async generator

    source = FailingSource({"type": "DUMMY"}, content="")
    detector = RecordingDetector(["text/plain"])
    pipeline = DetectorPipeline(detectors=[detector], source=source, runner_id="runner-fail")

    with pytest.raises(ConnectionError, match="timed out"):
        await pipeline.process([make_asset()])

    assert detector.seen == []


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


class BinarySource(DummySource):
    """Source that provides raw bytes via fetch_content_bytes."""

    def __init__(
        self, recipe: dict[str, Any], content: str, binary_data: bytes, binary_mime: str
    ) -> None:
        super().__init__(recipe, content)
        self._binary_data = binary_data
        self._binary_mime = binary_mime

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        return self._binary_data, self._binary_mime


class OcrBinarySource(BinarySource):
    def __init__(
        self,
        recipe: dict[str, Any],
        content: str,
        binary_data: bytes,
        binary_mime: str,
        ocr_pages: list[str],
    ) -> None:
        super().__init__(recipe, content, binary_data, binary_mime)
        self._ocr_pages = ocr_pages
        self.config = SimpleNamespace(sampling=SimpleNamespace(enable_ocr=True))

    def iter_asset_pages(
        self,
        file_bytes: bytes,
        mime_type: str,
        batch_size: int = 100,
        include_column_names: bool = True,
        *,
        file_name: str = "",
    ):
        _ = (file_bytes, mime_type, batch_size, include_column_names, file_name)
        yield from self._ocr_pages


def make_image_asset(asset_id: str = "img-1") -> SingleAssetScanResults:
    now = datetime.now(UTC)
    return SingleAssetScanResults(
        hash=asset_id,
        checksum="checksum",
        name=f"asset-{asset_id}",
        external_url=f"urn:test/{asset_id}",
        links=[],
        asset_type=AssetType.IMAGE,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_pipeline_routes_binary_content_to_image_detectors() -> None:
    image_bytes = b"\x89PNG\r\n\x1a\nfake-image-data"
    source = BinarySource(
        {"type": "DUMMY"}, content="", binary_data=image_bytes, binary_mime="image/png"
    )
    text_detector = RecordingDetector(["text/plain"])
    image_detector = RecordingDetector(["image/png", "image/jpeg"])

    pipeline = DetectorPipeline(
        detectors=[text_detector, image_detector],
        source=source,
        runner_id="runner-binary",
    )

    [asset] = await pipeline.process([make_image_asset()])

    # Text detector should NOT receive the image content
    assert text_detector.seen == []
    # Image detector should receive the raw bytes
    assert len(image_detector.seen) == 1
    assert image_detector.seen[0] == image_bytes
    assert image_detector.seen_content_types == ["image/png"]
    assert asset.findings is not None
    assert len(asset.findings) == 1


@pytest.mark.asyncio
async def test_pipeline_routes_ocr_text_to_text_detectors_for_image_assets() -> None:
    image_bytes = b"\x89PNG\r\n\x1a\nfake-image-data"
    source = OcrBinarySource(
        {"type": "DUMMY"},
        content="",
        binary_data=image_bytes,
        binary_mime="image/png",
        ocr_pages=["detected words"],
    )
    text_detector = RecordingDetector(["text/plain"])
    image_detector = RecordingDetector(["image/png"])

    pipeline = DetectorPipeline(
        detectors=[text_detector, image_detector],
        source=source,
        runner_id="runner-ocr-image",
    )

    [_asset] = await pipeline.process([make_image_asset("ocr-image")])

    assert text_detector.seen == ["detected words"]
    assert text_detector.seen_content_types == ["text/plain"]
    assert image_detector.seen == [image_bytes]
    assert image_detector.seen_content_types == ["image/png"]


@pytest.mark.asyncio
async def test_pipeline_runs_mixed_detector_on_ocr_text_and_binary_payloads() -> None:
    image_bytes = b"\x89PNG\r\n\x1a\nfake-image-data"
    source = OcrBinarySource(
        {"type": "DUMMY"},
        content="",
        binary_data=image_bytes,
        binary_mime="image/png",
        ocr_pages=["detected words"],
    )
    mixed_detector = RecordingDetector(["text/plain", "image/png"])

    pipeline = DetectorPipeline(
        detectors=[mixed_detector],
        source=source,
        runner_id="runner-ocr-mixed",
    )

    [_asset] = await pipeline.process([make_image_asset("ocr-mixed")])

    assert mixed_detector.seen == ["detected words", image_bytes]
    assert mixed_detector.seen_content_types == ["text/plain", "image/png"]


@pytest.mark.asyncio
async def test_pipeline_resolves_effective_binary_mime_from_bytes_and_filename() -> None:
    image_bytes = b"\xff\xd8\xffjpeg-data"
    source = BinarySource(
        {"type": "DUMMY"},
        content="",
        binary_data=image_bytes,
        binary_mime="application/octet-stream",
    )
    image_detector = RecordingDetector(["image/jpeg"])

    pipeline = DetectorPipeline(
        detectors=[image_detector],
        source=source,
        runner_id="runner-binary-mime-fallback",
    )

    [asset] = await pipeline.process([make_image_asset("photo.jpg")])

    assert image_detector.seen == [image_bytes]
    assert image_detector.seen_content_types == ["image/jpeg"]
    assert asset.findings is not None
    assert len(asset.findings) == 1


@pytest.mark.asyncio
async def test_pipeline_skips_binary_detectors_when_no_bytes_available() -> None:
    source = DummySource({"type": "DUMMY"}, content="text content")
    image_detector = RecordingDetector(["image/png"])

    pipeline = DetectorPipeline(
        detectors=[image_detector],
        source=source,
        runner_id="runner-no-binary",
    )

    [_asset] = await pipeline.process([make_image_asset()])

    # No bytes from source → image detector should not be called
    assert image_detector.seen == []


@pytest.mark.asyncio
async def test_pipeline_runs_text_and_binary_detectors_together() -> None:
    image_bytes = b"\xff\xd8\xffjpeg-data"
    source = BinarySource(
        {"type": "DUMMY"}, content="some text", binary_data=image_bytes, binary_mime="image/jpeg"
    )
    text_detector = RecordingDetector(["text/plain"])
    image_detector = RecordingDetector(["image/jpeg"])

    pipeline = DetectorPipeline(
        detectors=[text_detector, image_detector],
        source=source,
        runner_id="runner-mixed-binary",
    )

    # TXT asset → text detector gets text, image detector gets binary
    [_asset] = await pipeline.process([make_asset()])
    assert text_detector.seen == ["some text"]
    assert image_detector.seen == [image_bytes]


@pytest.mark.asyncio
async def test_pipeline_no_truncation_warning_in_scan_stats() -> None:
    content = "x" * 50
    source = DummySource({"type": "DUMMY"}, content=content)
    detector = RecordingDetector(["text/plain"])

    pipeline = DetectorPipeline(
        detectors=[detector],
        source=source,
        runner_id="runner-trunc",
    )

    [asset] = await pipeline.process([make_asset("trunc")])
    assert asset.scan_stats is not None
    assert not any(
        "truncated" in w.lower()
        for w in (asset.scan_stats.warnings or [])
    )


class FailingDetector(BaseDetector):
    detector_type = "secrets"
    detector_name = "failing"

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        raise RuntimeError("detector crashed")

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain"]


@pytest.mark.asyncio
async def test_pipeline_detector_error_in_scan_stats() -> None:
    source = DummySource({"type": "DUMMY"}, content="test content")
    failing = FailingDetector()

    pipeline = DetectorPipeline(
        detectors=[failing],
        source=source,
        runner_id="runner-err",
    )

    [asset] = await pipeline.process([make_asset("err")])
    assert asset.scan_stats is not None
    assert asset.scan_stats.errors is not None
    assert any("detector crashed" in e for e in asset.scan_stats.errors)
    assert asset.findings == []
