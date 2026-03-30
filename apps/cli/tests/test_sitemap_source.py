from datetime import UTC, datetime
from typing import Any

import pytest

from src.models.generated_input import SamplingStrategy
from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.sitemap.source import SitemapSource, _ResourceSnapshot
from src.utils.file_parser import ParsedBytes


class _Response:
    def __init__(self, content: bytes, *, headers: dict[str, str] | None = None):
        self.content = content
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int = 8192):
        _ = chunk_size
        yield self.content


class _FakeMarkdown:
    def __init__(self, text: str):
        self.raw_markdown = text


class _FakeCrawlResult:
    def __init__(self, *, url: str):
        self.success = True
        self.url = url
        self.redirected_url = None
        self.html = "<html><head><title>Example title</title></head><body>Hello world</body></html>"
        self.cleaned_html = self.html
        self.markdown = _FakeMarkdown("# Example title\n\nHello world")
        self.media: dict[str, list[dict[str, Any]]] = {
            "images": [{"src": "https://example.com/assets/hero.png"}],
        }
        self.links: dict[str, list[dict[str, Any]]] = {
            "internal": [
                {"href": "https://example.com/docs/file.pdf"},
                {"href": "https://example.com/about"},
            ],
            "external": [{"href": "https://external.example.org/page"}],
        }
        self.metadata = {"title": "Example title"}
        self.status_code = 200
        self.error_message = None


class _FakeCrawler:
    def __init__(self, crawl_result: _FakeCrawlResult):
        self.crawl_result = crawl_result

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def crawl_url(self, url: str):
        return self.crawl_result


def _make_source() -> SitemapSource:
    return SitemapSource(
        {
            "type": "SITEMAP",
            "required": {"sitemap_url": "https://example.com/sitemap.xml"},
            "optional": {
                "crawl": {"max_nested_sitemaps": 10},
                "assets": {
                    "fetch_related_assets": True,
                    "include_external_links": False,
                },
            },
            "sampling": {"strategy": "ALL"},
        }
    )


def test_collect_sitemap_urls_handles_nested_indexes(monkeypatch):
    source = _make_source()

    sitemap_index = b"""<?xml version='1.0' encoding='UTF-8'?>
    <sitemapindex xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
      <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
    </sitemapindex>
    """

    sitemap_posts = b"""<?xml version='1.0' encoding='UTF-8'?>
    <urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
      <url><loc>https://example.com/blog/one</loc></url>
      <url><loc>https://example.com/blog/two</loc></url>
    </urlset>
    """

    sitemap_pages = b"""<?xml version='1.0' encoding='UTF-8'?>
    <urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/contact</loc></url>
    </urlset>
    """

    responses = {
        "https://example.com/sitemap.xml": sitemap_index,
        "https://example.com/sitemap-posts.xml": sitemap_posts,
        "https://example.com/sitemap-pages.xml": sitemap_pages,
    }

    def fake_get(url: str, timeout: float = 0) -> _Response:  # noqa: ARG001
        return _Response(responses[url])

    monkeypatch.setattr(source.session, "get", fake_get)

    urls = source._collect_sitemap_urls(SamplingStrategy.ALL, limit=10)

    assert urls == [
        "https://example.com/blog/one",
        "https://example.com/blog/two",
        "https://example.com/about",
        "https://example.com/contact",
    ]


def test_download_resource_snapshot_uses_shared_parser(monkeypatch: pytest.MonkeyPatch):
    source = _make_source()

    monkeypatch.setattr(
        source.session,
        "get",
        lambda _url, timeout=0, stream=False: _Response(  # noqa: ARG005
            b"name,age\nAlice,30\n",
            headers={"Content-Type": "text/plain; charset=utf-8"},
        ),
    )
    monkeypatch.setattr(
        "src.sources.sitemap.source.parse_bytes",
        lambda _file_bytes, **_kwargs: ParsedBytes(
            mime_type="text/csv",
            raw_content="name,age\nAlice,30\n",
            text_content="name,age\nAlice,30\n",
            is_binary=False,
            file_size_bytes=18,
            parse_error=None,
        ),
    )

    snapshot = source._download_resource_snapshot("https://example.com/files/data.csv")

    assert snapshot.mime_type == "text/csv"
    assert "Alice" in snapshot.raw_content
    assert "Alice" in snapshot.text_content


@pytest.mark.asyncio
async def test_extract_creates_page_and_related_assets(monkeypatch):
    source = _make_source()
    crawl_result = _FakeCrawlResult(url="https://example.com/news/first")

    monkeypatch.setattr(
        source,
        "_collect_sitemap_urls",
        lambda _strategy=SamplingStrategy.RANDOM, _limit=None: [crawl_result.url],
    )
    monkeypatch.setattr(source, "_build_crawl_client", lambda: _FakeCrawler(crawl_result))

    def fake_snapshot(url: str) -> _ResourceSnapshot:
        if url.endswith(".png"):
            return _ResourceSnapshot(
                url=url,
                mime_type="image/png",
                raw_content="",
                text_content="",
                file_size_bytes=1024,
            )
        if url.endswith(".pdf"):
            return _ResourceSnapshot(
                url=url,
                mime_type="application/pdf",
                raw_content="",
                text_content="Extracted PDF text",
                file_size_bytes=4096,
            )
        raise AssertionError(f"Unexpected URL in fake snapshot: {url}")

    monkeypatch.setattr(source, "_download_resource_snapshot", fake_snapshot)

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    page_assets = [a for a in assets if a.asset_type == OutputAssetType.URL]
    assert len(page_assets) == 1

    image_assets = [a for a in assets if a.asset_type == OutputAssetType.IMAGE]
    binary_assets = [a for a in assets if a.asset_type == OutputAssetType.BINARY]
    assert len(image_assets) == 1
    assert len(binary_assets) == 1

    page_asset = page_assets[0]
    assert image_assets[0].hash in page_asset.links
    assert binary_assets[0].hash in page_asset.links


@pytest.mark.asyncio
async def test_fetch_content_returns_cached_markdown():
    source = _make_source()
    page_hash = source.generate_hash_id("https://example.com/page")

    source._page_content_cache[page_hash] = (
        "<html><body>Example</body></html>",
        "Example",
    )

    content = await source.fetch_content("https://example.com/page")

    assert content is not None
    raw_html, text = content
    assert "<html>" in raw_html
    assert text == "Example"


def test_default_execution_mode_is_internal(monkeypatch):
    monkeypatch.delenv("SITEMAP_CRAWLER_MODE", raising=False)
    source = _make_source()
    assert source.execution_mode == "internal"


def test_execution_mode_can_be_switched_to_external(monkeypatch):
    monkeypatch.setenv("SITEMAP_CRAWLER_MODE", "external")
    monkeypatch.setenv("SITEMAP_CRAWLER_ENDPOINT", "http://crawler:11235")
    source = _make_source()
    assert source.execution_mode == "external"
    assert source.remote_crawler_url == "http://crawler:11235/"


def test_session_uses_browser_like_user_agent():
    source = _make_source()
    ua = source.session.headers.get("User-Agent", "")
    assert "Mozilla/5.0" in ua
    assert "Chrome" in ua
    assert "ClassifyreSitemapSource" not in ua


def test_session_sends_browser_like_accept_headers():
    source = _make_source()
    assert "Accept" in source.session.headers
    assert "Accept-Language" in source.session.headers
    assert "Accept-Encoding" in source.session.headers


def test_test_connection_succeeds_without_playwright(monkeypatch):
    source = _make_source()

    sitemap = b"""<?xml version='1.0' encoding='UTF-8'?>
    <urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
      <url><loc>https://example.com/page-1</loc></url>
    </urlset>
    """

    monkeypatch.setattr(source.session, "get", lambda _url, **_kwargs: _Response(sitemap))

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "https://example.com/page-1" in result["message"]


def test_test_connection_fails_on_empty_sitemap(monkeypatch):
    source = _make_source()

    empty_sitemap = b"""<?xml version='1.0' encoding='UTF-8'?>
    <urlset xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'>
    </urlset>
    """

    monkeypatch.setattr(source.session, "get", lambda _url, **_kwargs: _Response(empty_sitemap))

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "No URLs found" in result["message"]


def test_test_connection_fails_on_http_error(monkeypatch):
    import requests as _requests

    source = _make_source()

    class _ErrorResponse:
        def raise_for_status(self) -> None:
            raise _requests.HTTPError("403 Forbidden")

    monkeypatch.setattr(source.session, "get", lambda _url, **_kwargs: _ErrorResponse())

    result = source.test_connection()

    assert result["status"] == "FAILURE"


def test_sitemap_resolve_link_for_detection_maps_hash_to_url():
    source = _make_source()
    target_url = "https://example.com/docs/file.pdf"
    hashed = source.generate_hash_id(target_url)

    assert source.resolve_link_for_detection(hashed) == target_url


@pytest.mark.parametrize(
    ("mime_type", "url", "expected"),
    [
        ("text/csv", "https://example.com/files/data.csv", OutputAssetType.TABLE),
        (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "https://example.com/files/data.xlsx",
            OutputAssetType.TABLE,
        ),
        (
            "application/vnd.apache.parquet",
            "https://example.com/files/data.parquet",
            OutputAssetType.TABLE,
        ),
        ("application/octet-stream", "https://example.com/files/data.tsv", OutputAssetType.TABLE),
    ],
)
def test_sitemap_classifies_tabular_related_assets(
    mime_type: str,
    url: str,
    expected: OutputAssetType,
):
    source = _make_source()
    hinted = source._hint_from_extension(url)
    fallback = source._asset_type_from_mime(mime_type)

    assert expected in {hinted, fallback}


@pytest.mark.asyncio
async def test_sitemap_extract_streams_early_batches(monkeypatch: pytest.MonkeyPatch):
    source = _make_source()
    urls = ["https://example.com/page-1", "https://example.com/page-2"]
    events: list[str] = []
    crawl_results = {url: _FakeCrawlResult(url=url) for url in urls}

    monkeypatch.setattr(
        source,
        "_collect_sitemap_urls",
        lambda _strategy=SamplingStrategy.RANDOM, _limit=None: urls,
    )

    class TrackingCrawler:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def crawl_url(self, url: str):
            events.append(f"crawl-{url}")
            return crawl_results[url]

    monkeypatch.setattr(source, "_build_crawl_client", lambda: TrackingCrawler())

    transformed_assets = {
        urls[0]: SingleAssetScanResults(
            hash="hash-1",
            checksum="checksum-1",
            name="Page 1",
            external_url=urls[0],
            links=[],
            asset_type=OutputAssetType.URL,
            source_id="source-1",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            runner_id="runner-1",
        ),
        urls[1]: SingleAssetScanResults(
            hash="hash-2",
            checksum="checksum-2",
            name="Page 2",
            external_url=urls[1],
            links=[],
            asset_type=OutputAssetType.URL,
            source_id="source-1",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            runner_id="runner-1",
        ),
    }

    def fake_transform(crawl_result: _FakeCrawlResult, _now):
        return transformed_assets[crawl_result.url], []

    monkeypatch.setattr(source, "_transform_crawl_result_to_assets", fake_transform)

    original_batch_size = SitemapSource.BATCH_SIZE
    SitemapSource.BATCH_SIZE = 1
    try:
        async for batch in source.extract():
            events.append(f"yield-{batch[0].hash}")
    finally:
        SitemapSource.BATCH_SIZE = original_batch_size

    assert events == [
        f"crawl-{urls[0]}",
        "yield-hash-1",
        f"crawl-{urls[1]}",
        "yield-hash-2",
    ]
