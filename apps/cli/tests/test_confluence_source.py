from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.confluence.source import ConfluenceSource
from src.utils.file_parser import ParsedBytes


def _confluence_recipe(
    *,
    strategy: str = "ALL",
    optional: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "type": "CONFLUENCE",
        "required": {
            "base_url": "https://your-domain.atlassian.net",
            "account_email": "user@example.com",
        },
        "masked": {"api_token": "token"},
        "optional": optional or {},
        "sampling": {"strategy": strategy, "limit": 100},
    }


async def _collect_assets(source: ConfluenceSource):
    assets = []
    async for batch in source.extract():
        assets.extend(batch)
    return assets


def test_confluence_test_connection_success(monkeypatch: pytest.MonkeyPatch):
    source = ConfluenceSource(_confluence_recipe())
    monkeypatch.setattr(source.client, "get_json", lambda *_args, **_kwargs: {"results": []})

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Successfully connected" in result["message"]


def test_confluence_test_connection_failure(monkeypatch: pytest.MonkeyPatch):
    source = ConfluenceSource(_confluence_recipe())

    def _raise(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(source.client, "get_json", _raise)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Failed to connect" in result["message"]


def test_confluence_space_filters_are_sent_as_expected(monkeypatch: pytest.MonkeyPatch):
    source = ConfluenceSource(
        _confluence_recipe(
            optional={
                "scope": {
                    "spaces": {
                        "ids": [1001, 1002],
                        "keys": ["ENG", "PLAT"],
                        "type": "knowledge_base",
                        "status": "current",
                        "labels": ["public", "runbook"],
                    }
                }
            }
        )
    )
    captured: dict[str, Any] = {}

    def _iter(path: str, *, params: dict[str, Any] | None = None):
        captured["path"] = path
        captured["params"] = params
        return [{"id": "1001"}]

    monkeypatch.setattr(source.client, "iter_confluence_results", _iter)

    spaces = source._fetch_spaces()

    assert spaces == [{"id": "1001"}]
    assert captured["path"] == "/wiki/api/v2/spaces"
    assert captured["params"] == {
        "limit": 250,
        "ids": "1001,1002",
        "keys": "ENG,PLAT",
        "type": "knowledge_base",
        "status": "current",
        "labels": "public,runbook",
    }


@pytest.mark.asyncio
async def test_confluence_extract_page_comments_attachments_and_links(
    monkeypatch: pytest.MonkeyPatch,
):
    source = ConfluenceSource(
        _confluence_recipe(
            optional={
                "content": {
                    "include_footer_comments": True,
                    "include_inline_comments": True,
                    "include_attachments": True,
                    "include_linked_file_assets": True,
                }
            }
        ),
        source_id="source-1",
        runner_id="runner-1",
    )

    monkeypatch.setattr(
        source,
        "_discover_page_refs",
        lambda: [{"page_id": "111", "space_id": "42"}],
    )

    page_calls: list[str] = []
    page_payload = {
        "id": "111",
        "title": "Root Page",
        "spaceId": "42",
        "status": "current",
        "createdAt": "2025-01-01T00:00:00Z",
        "version": {"createdAt": "2025-02-01T00:00:00Z"},
        "_links": {"webui": "/wiki/spaces/ENG/pages/111/Root+Page"},
        "body": {
            "storage": {
                "value": (
                    '<a href="/wiki/spaces/ENG/pages/222/Linked+Page">linked-page</a>'
                    '<a href="https://your-domain.atlassian.net/browse/PLAT-9">jira</a>'
                    '<a href="https://cdn.example.com/files/guide.pdf">guide</a>'
                )
            }
        },
    }

    def _get_json(path: str, *, params: dict[str, Any] | None = None):
        page_calls.append(path)
        assert params == {"body-format": "storage"}
        assert path == "/wiki/api/v2/pages/111"
        return page_payload

    monkeypatch.setattr(source.client, "get_json", _get_json)

    def _iter(path: str, *, params: dict[str, Any] | None = None):
        if path == "/wiki/api/v2/pages/111/attachments":
            assert params == {"limit": 250}
            return [
                {
                    "id": "att-1",
                    "title": "spec.pdf",
                    "mediaType": "application/pdf",
                    "downloadLink": "/wiki/download/attachments/111/spec.pdf",
                },
                {
                    "id": "att-2",
                    "title": "diagram.png",
                    "mediaType": "image/png",
                    "downloadLink": "/wiki/download/attachments/111/diagram.png",
                },
            ]
        if path == "/wiki/api/v2/pages/111/footer-comments":
            assert params == {"limit": 250, "body-format": "storage"}
            return [
                {"body": {"storage": {"value": "<p>Footer comment https://status.example.com</p>"}}}
            ]
        if path == "/wiki/api/v2/pages/111/inline-comments":
            assert params == {"limit": 250, "body-format": "storage"}
            return [
                {
                    "body": {
                        "storage": {"value": "<p>Inline comment https://docs.example.com/page</p>"}
                    }
                }
            ]
        raise AssertionError(f"Unexpected path: {path}")

    monkeypatch.setattr(source.client, "iter_confluence_results", _iter)

    assets = await _collect_assets(source)

    page_assets = [
        a for a in assets if a.name == "Root Page" and a.asset_type == OutputAssetType.URL
    ]
    assert len(page_assets) == 1
    page_asset = page_assets[0]

    comment_assets = [a for a in assets if a.name.startswith("Comments for page")]
    assert len(comment_assets) == 1

    attachment_assets = [a for a in assets if a.name in {"spec.pdf", "diagram.png"}]
    assert len(attachment_assets) == 2
    assert {a.asset_type for a in attachment_assets} == {
        OutputAssetType.BINARY,
        OutputAssetType.IMAGE,
    }

    linked_page_hash = source.generate_hash_id(
        "https://your-domain.atlassian.net/wiki/spaces/ENG/pages/222/Linked+Page"
    )
    jira_hash = source.generate_hash_id("https://your-domain.atlassian.net/browse/PLAT-9")
    linked_file_hash = source.generate_hash_id("https://cdn.example.com/files/guide.pdf")
    assert linked_page_hash in page_asset.links
    assert jira_hash in page_asset.links
    assert linked_file_hash in page_asset.links
    assert comment_assets[0].hash in page_asset.links
    assert all(attachment.hash in page_asset.links for attachment in attachment_assets)

    # Linked pages/issues are represented as links and are not fetched as full assets.
    assert page_calls == ["/wiki/api/v2/pages/111"]


def test_confluence_resolve_link_for_detection_maps_hash_to_url():
    source = ConfluenceSource(_confluence_recipe())
    url = "https://your-domain.atlassian.net/wiki/spaces/ENG/pages/123/Architecture"
    hashed = source.generate_hash_id(url)

    assert source.resolve_link_for_detection(hashed) == url


@pytest.mark.asyncio
async def test_confluence_fetch_content_for_attachment(monkeypatch: pytest.MonkeyPatch):
    source = ConfluenceSource(_confluence_recipe())
    attachment_url = "https://your-domain.atlassian.net/wiki/download/attachments/111/readme.txt"
    attachment_hash = source.generate_hash_id(attachment_url)
    source._attachment_download_url_by_hash[attachment_hash] = attachment_url
    now = datetime.now(UTC)
    source._asset_content_cache["unused"] = ("", str(now))

    monkeypatch.setattr(
        source.client,
        "get_bytes",
        lambda _url: (b"hello from confluence attachment", "text/plain"),
    )
    monkeypatch.setattr(
        "src.sources.confluence.source.parse_bytes",
        lambda _file_bytes, **_kwargs: ParsedBytes(
            mime_type="text/plain",
            raw_content="hello from confluence attachment",
            text_content="hello from confluence attachment",
            is_binary=False,
            file_size_bytes=31,
            parse_error=None,
        ),
    )

    content = await source.fetch_content(attachment_hash)

    assert content is not None
    raw, text = content
    assert "hello from confluence attachment" in raw
    assert "hello from confluence attachment" in text


@pytest.mark.parametrize(
    ("mime_type", "url", "expected"),
    [
        ("text/csv", "https://cdn.example.com/report.csv", OutputAssetType.TABLE),
        ("text/tab-separated-values", "https://cdn.example.com/report.tsv", OutputAssetType.TABLE),
        (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "https://cdn.example.com/report.xlsx",
            OutputAssetType.TABLE,
        ),
        (
            "application/vnd.apache.parquet",
            "https://cdn.example.com/report.parquet",
            OutputAssetType.TABLE,
        ),
        (
            "application/octet-stream",
            "https://cdn.example.com/report.parquet",
            OutputAssetType.TABLE,
        ),
    ],
)
def test_confluence_classifies_tabular_assets(
    mime_type: str,
    url: str,
    expected: OutputAssetType,
):
    source = ConfluenceSource(_confluence_recipe())
    assert source._asset_type_from_mime_or_url(mime_type, url) == expected
