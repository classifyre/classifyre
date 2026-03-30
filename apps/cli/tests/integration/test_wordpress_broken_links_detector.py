"""Integration-style test for WordPress extraction with BROKEN_LINKS detector."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from src.detectors.broken_links.detector import BrokenLinksDetector, LinkScanResult
from src.models.generated_single_asset_scan_results import AssetType
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
async def test_wordpress_broken_links_findings_attached_to_page_asset(
    mock_session_cls: MagicMock,
) -> None:
    now = datetime.now(UTC).isoformat()
    post_item = {
        "id": 555,
        "slug": "detector-post",
        "link": "https://example.com/detector-post/",
        "title": {"rendered": "Detector post"},
        "excerpt": {"rendered": "Summary"},
        "content": {
            "rendered": (
                '<img src="/media/good-image.png" />'
                '<a href="https://example.com/bad-link">Bad link</a>'
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
            return _mock_json_response(
                [post_item] if params and params.get("page") == 1 else [],
                headers={"X-WP-Total": "1", "X-WP-TotalPages": "1"},
            )
        if url.endswith("/wp-json/wp/v2/pages"):
            return _mock_json_response([])
        if url.endswith("/wp-json/wp/v2/posts/555"):
            return _mock_json_response({"content": {"rendered": post_item["content"]["rendered"]}})
        if url == "https://example.com/media/good-image.png":
            image_response = _mock_json_response({})
            image_response.headers = {"Content-Type": "image/png"}
            return image_response
        # For page URL fallback paths
        html_response = _mock_json_response({})
        html_response.headers = {"Content-Type": "text/html"}
        html_response.text = "<html><body>ok</body></html>"
        return html_response

    mock_session.get.side_effect = mock_get
    mock_session_cls.return_value = mock_session

    def fake_scan_link(
        self: BrokenLinksDetector,
        url: str,
        line: int,
        start: int,
        end: int,
    ) -> LinkScanResult | None:
        del self
        if "bad-link" in url:
            return LinkScanResult(
                url=url,
                line=line,
                start=start,
                end=end,
                finding_type="unreachable",
                confidence=0.95,
                metadata={"reason": "test"},
            )
        return None

    with patch.object(BrokenLinksDetector, "_scan_link", fake_scan_link):
        source = WordPressSource(
            {
                "type": "WORDPRESS",
                "required": {"url": "https://example.com"},
                "masked": {},
                "optional": {"content": {"fetch_posts": True, "fetch_pages": False}},
                "detectors": [{"type": "BROKEN_LINKS", "enabled": True, "config": {}}],
            }
        )

        assets = []
        async for batch in source.extract():
            assets.extend(batch)

    page_assets = [asset for asset in assets if asset.asset_type == AssetType.URL]
    image_assets = [asset for asset in assets if asset.asset_type == AssetType.IMAGE]

    assert len(page_assets) == 1
    assert len(image_assets) == 1

    page_asset = page_assets[0]
    assert page_asset.findings is not None
    assert len(page_asset.findings) == 1
    assert page_asset.findings[0].detector_type.value == "BROKEN_LINKS"
    assert page_asset.findings[0].finding_type == "unreachable"
    assert page_asset.findings[0].matched_content == "https://example.com/bad-link"
