from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.wordpress.source import WordPressSource


def _mock_json_response(data: object, headers: dict[str, str] | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.ok = True
    response.headers = headers or {}
    response.json.return_value = data
    response.raise_for_status.return_value = None
    response.text = ""
    return response


@pytest.mark.integration
@pytest.mark.asyncio
@patch("src.sources.wordpress.source.requests.Session")
async def test_wordpress_extract_creates_page_and_image_assets(mock_session_cls) -> None:
    now = datetime.now(UTC).isoformat()
    post_item = {
        "id": 101,
        "slug": "sample-post",
        "link": "https://example.com/sample-post/",
        "title": {"rendered": "Sample post"},
        "excerpt": {"rendered": "Short summary"},
        "content": {
            "rendered": (
                '<img src="/media/image-1.png" />'
                '<img src="https://cdn.example.com/image-2.jpg" />'
                '<a href="/local-link">Local</a>'
                '<a href="https://external.example.com/a">A</a>'
                '<a href="https://external.example.com/b">B</a>'
            )
        },
        "status": "publish",
        "date_gmt": now,
        "modified_gmt": now,
    }

    mock_session = MagicMock()

    def mock_get(url: str, params: dict[str, object] | None = None, timeout: int = 30) -> MagicMock:
        del timeout
        if url.endswith("/wp-json/wp/v2/posts"):
            if params and params.get("page") == 1:
                return _mock_json_response(
                    [post_item],
                    headers={"X-WP-Total": "1", "X-WP-TotalPages": "1"},
                )
            return _mock_json_response([])
        if url.endswith("/wp-json/wp/v2/pages"):
            return _mock_json_response([])
        raise AssertionError(f"Unexpected URL: {url}")

    mock_session.get.side_effect = mock_get
    mock_session_cls.return_value = mock_session

    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "masked": {},
            "optional": {"content": {"fetch_posts": True, "fetch_pages": False}},
        }
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    page_assets = [asset for asset in assets if asset.asset_type == OutputAssetType.URL]
    image_assets = [asset for asset in assets if asset.asset_type == OutputAssetType.IMAGE]

    assert len(page_assets) == 1
    assert len(image_assets) == 2
    assert len(assets) == 3

    page_asset = page_assets[0]
    assert page_asset.hash == source.generate_hash_id("https://example.com/sample-post/")
    assert page_asset.external_url == "https://example.com/sample-post/"
    assert page_asset.links == [
        source.generate_hash_id("https://example.com/media/image-1.png"),
        source.generate_hash_id("https://cdn.example.com/image-2.jpg"),
        source.generate_hash_id("https://example.com/local-link"),
        source.generate_hash_id("https://external.example.com/a"),
        source.generate_hash_id("https://external.example.com/b"),
    ]

    image_hashes = sorted(asset.hash for asset in image_assets)
    assert image_hashes == [
        source.generate_hash_id("https://cdn.example.com/image-2.jpg"),
        source.generate_hash_id("https://example.com/media/image-1.png"),
    ]
