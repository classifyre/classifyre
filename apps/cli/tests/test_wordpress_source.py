from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.wordpress.source import WordPressSource


def _make_response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    return response


@patch("src.sources.wordpress.source.requests.Session")
def test_wordpress_test_connection_success(mock_session_cls):
    mock_session = MagicMock()
    mock_session.get.return_value = _make_response(200)
    mock_session_cls.return_value = mock_session

    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "masked": {},
        }
    )

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Successfully connected" in result["message"]


@patch("src.sources.wordpress.source.requests.Session")
def test_wordpress_test_connection_auth_required(mock_session_cls):
    mock_session = MagicMock()
    mock_session.get.return_value = _make_response(401)
    mock_session_cls.return_value = mock_session

    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "masked": {},
        }
    )

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "authentication is required" in result["message"]


@patch("src.sources.wordpress.source.requests.Session")
def test_wordpress_test_connection_failure_status(mock_session_cls):
    mock_session = MagicMock()
    mock_session.get.return_value = _make_response(500)
    mock_session_cls.return_value = mock_session

    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "masked": {},
        }
    )

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Unexpected status" in result["message"]


@patch("src.sources.wordpress.source.requests.Session")
def test_wordpress_test_connection_exception(mock_session_cls):
    mock_session = MagicMock()
    mock_session.get.side_effect = requests.exceptions.RequestException("boom")
    mock_session_cls.return_value = mock_session

    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "masked": {},
        }
    )

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Failed to connect" in result["message"]


def test_wordpress_location_fallback_uses_id_when_link_missing():
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://example.com"},
        "masked": {},
        "optional": {"content": {"fetch_posts": True, "fetch_pages": False}},
    }
    source = WordPressSource(recipe)

    item = {
        "id": 123,
        "slug": "",
        "title": {"rendered": "Hello"},
        "excerpt": {"rendered": "World"},
        "status": "publish",
        "date_gmt": datetime.now(UTC).isoformat(),
        "modified_gmt": datetime.now(UTC).isoformat(),
    }

    asset = source._transform_item(item, "posts")

    assert asset.external_url == "https://example.com/?p=123"
    assert asset.hash == source.generate_hash_id("https://example.com/?p=123")
    assert asset.asset_type == OutputAssetType.URL


def test_wordpress_extracts_links_and_images_to_page_links_and_image_assets():
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://example.com"},
        "masked": {},
    }
    source = WordPressSource(recipe)

    item = {
        "id": 42,
        "slug": "hello-world",
        "link": "https://example.com/hello-world/",
        "title": {"rendered": "Hello"},
        "excerpt": {"rendered": "World"},
        "content": {
            "rendered": (
                '<p><img src="/images/one.png"></p>'
                '<p><img src="https://cdn.example.com/two.jpg"></p>'
                '<a href="/relative-link">Relative</a>'
                '<a href="https://docs.example.com/page">Docs</a>'
                '<a href="https://another.example.com/path">Another</a>'
                '<a href="#anchor">Anchor</a>'
            )
        },
        "status": "publish",
        "date_gmt": datetime.now(UTC).isoformat(),
        "modified_gmt": datetime.now(UTC).isoformat(),
    }

    page_asset, image_assets = source._transform_item_to_assets(item, "posts")

    assert page_asset.hash == source.generate_hash_id("https://example.com/hello-world/")
    assert page_asset.external_url == "https://example.com/hello-world/"
    assert page_asset.asset_type == OutputAssetType.URL
    assert page_asset.links == [
        source.generate_hash_id("https://example.com/images/one.png"),
        source.generate_hash_id("https://cdn.example.com/two.jpg"),
        source.generate_hash_id("https://example.com/relative-link"),
        source.generate_hash_id("https://docs.example.com/page"),
        source.generate_hash_id("https://another.example.com/path"),
    ]

    assert len(image_assets) == 2
    assert image_assets[0].hash == source.generate_hash_id("https://example.com/images/one.png")
    assert image_assets[0].external_url == "https://example.com/images/one.png"
    assert image_assets[0].asset_type == OutputAssetType.IMAGE
    assert image_assets[1].hash == source.generate_hash_id("https://cdn.example.com/two.jpg")
    assert image_assets[1].external_url == "https://cdn.example.com/two.jpg"
    assert image_assets[1].asset_type == OutputAssetType.IMAGE


@pytest.mark.asyncio
async def test_wordpress_fetch_content_resolves_url_hash_to_post_id():
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://example.com"},
        "masked": {},
    }
    source = WordPressSource(recipe)
    page_url = "https://example.com/page/1/"
    source._url_to_wp_id = {
        page_url: "100",
        source.generate_hash_id(page_url): "100",
    }

    response = MagicMock()
    response.ok = True
    response.raise_for_status.return_value = None
    response.json.return_value = {"content": {"rendered": "<p>Hello world</p>"}}
    source.session.get = MagicMock(return_value=response)

    content = await source.fetch_content(page_url)

    assert content is not None
    html_content, text_content = content
    assert "<p>Hello world</p>" == html_content
    assert "Hello world" in text_content


@pytest.mark.asyncio
async def test_wordpress_extract_streams_early_batches(monkeypatch: pytest.MonkeyPatch):
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://example.com"},
        "masked": {},
        "optional": {"content": {"fetch_posts": True, "fetch_pages": False}},
        "detectors": [{"type": "BROKEN_LINKS", "enabled": True}],
    }
    source = WordPressSource(recipe, source_id="source-1", runner_id="runner-1")

    def _asset(hash_value: str) -> SingleAssetScanResults:
        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=hash_value,
            checksum=f"checksum-{hash_value}",
            name=f"Asset {hash_value}",
            external_url=f"https://example.com/{hash_value}",
            links=[],
            asset_type=OutputAssetType.URL,
            source_id="source-1",
            created_at=now,
            updated_at=now,
            runner_id="runner-1",
        )

    asset_1 = _asset("asset-1")
    asset_2 = _asset("asset-2")
    asset_3 = _asset("asset-3")
    events: list[str] = []

    def stream_content_type(
        content_type: str,
        _limit: int | None,
        _strategy: Any = None,
    ):
        if content_type != "posts":
            return
        events.append("chunk-1")
        yield [asset_1, asset_2], 1
        events.append("chunk-2")
        yield [asset_3], 1

    class FakePipeline:
        async def process(self, batch):
            events.append(f"pipeline-{len(batch)}")
            return batch

    monkeypatch.setattr(source, "_stream_content_type", stream_content_type)
    monkeypatch.setattr(
        "src.pipeline.detector_pipeline.DetectorPipeline.from_recipe",
        lambda *_args, **_kwargs: FakePipeline(),
    )

    original_batch_size = WordPressSource.BATCH_SIZE
    WordPressSource.BATCH_SIZE = 2
    try:
        async for batch in source.extract():
            events.append(f"yield-{len(batch)}")
    finally:
        WordPressSource.BATCH_SIZE = original_batch_size

    assert events == [
        "chunk-1",
        "pipeline-2",
        "yield-2",
        "chunk-2",
        "pipeline-1",
        "yield-1",
    ]


def test_wordpress_resolve_link_for_detection_maps_hash_to_url():
    recipe = {
        "type": "WORDPRESS",
        "required": {"url": "https://example.com"},
        "masked": {},
    }
    source = WordPressSource(recipe)

    target_url = "https://example.com/docs/page"
    hashed = source.generate_hash_id(target_url)

    assert source.resolve_link_for_detection(hashed) == target_url
