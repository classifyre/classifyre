from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.notion.source import NotionSource

PAGE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
PARENT_ID = "pppppppp-pppp-pppp-pppp-pppppppppppp"
RELATION_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr"
FILE_BLOCK_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"


def _notion_recipe(
    *,
    strategy: str = "ALL",
    optional: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "type": "NOTION",
        "required": {},
        "masked": {"notion_token": "ntn_test"},
        "optional": optional or {},
        "sampling": {"strategy": strategy},
    }


def _sample_page() -> dict[str, Any]:
    return {
        "id": PAGE_ID,
        "object": "page",
        "url": "https://www.notion.so/My-Page-aaaaaaaa",
        "created_time": "2025-01-01T00:00:00.000Z",
        "last_edited_time": "2025-02-01T00:00:00.000Z",
        "parent": {"type": "page_id", "page_id": PARENT_ID},
        "icon": None,
        "cover": None,
        "properties": {
            "Name": {
                "type": "title",
                "title": [{"type": "text", "plain_text": "My Page"}],
            },
            "Related": {
                "type": "relation",
                "id": "rel1",
                "relation": [{"id": RELATION_ID}],
                "has_more": False,
            },
        },
    }


def _block_children() -> dict[str, list[dict[str, Any]]]:
    return {
        PAGE_ID: [
            {
                "id": "b1",
                "type": "paragraph",
                "has_children": False,
                "paragraph": {"rich_text": [{"type": "text", "plain_text": "Hello world"}]},
            },
            {
                "id": "b2",
                "type": "toggle",
                "has_children": True,
                "toggle": {"rich_text": [{"type": "text", "plain_text": "Toggle"}]},
            },
            {
                "id": FILE_BLOCK_ID,
                "type": "file",
                "has_children": False,
                "file": {
                    "type": "file",
                    "file": {"url": "https://s3.notion.so/signed/doc.pdf?stale=1"},
                    "name": "doc.pdf",
                },
            },
        ],
        "b2": [
            {
                "id": "b3",
                "type": "paragraph",
                "has_children": False,
                "paragraph": {"rich_text": [{"type": "text", "plain_text": "Nested text"}]},
            }
        ],
    }


def _install_page_workspace(source: NotionSource, monkeypatch: pytest.MonkeyPatch) -> None:
    children = _block_children()

    def _iter_search(object_type: str, *, query: str | None = None) -> list[dict[str, Any]]:
        _ = query
        return [_sample_page()] if object_type == "page" else []

    monkeypatch.setattr(source.client, "iter_search", _iter_search)
    monkeypatch.setattr(
        source.client, "iter_block_children", lambda block_id: children.get(block_id, [])
    )
    monkeypatch.setattr(
        source.client,
        "iter_comments",
        lambda _block_id: [{"rich_text": [{"plain_text": "A sensitive comment"}]}],
    )


async def _collect_assets(source: NotionSource) -> list[Any]:
    assets: list[Any] = []
    async for batch in source.extract():
        assets.extend(batch)
    return assets


def test_notion_test_connection_success(monkeypatch: pytest.MonkeyPatch):
    source = NotionSource(_notion_recipe())
    monkeypatch.setattr(source.client, "post_json", lambda *_a, **_k: {"results": []})

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Successfully connected" in result["message"]


def test_notion_test_connection_failure(monkeypatch: pytest.MonkeyPatch):
    source = NotionSource(_notion_recipe())

    def _raise(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(source.client, "post_json", _raise)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Failed to connect" in result["message"]


@pytest.mark.asyncio
async def test_notion_page_extracts_recursive_text_and_comments(
    monkeypatch: pytest.MonkeyPatch,
):
    source = NotionSource(_notion_recipe())
    _install_page_workspace(source, monkeypatch)

    assets = await _collect_assets(source)

    page_assets = [a for a in assets if a.asset_type == OutputAssetType.URL]
    assert len(page_assets) == 1
    page = page_assets[0]

    # Recursive block text is cached for detector scanning.
    _raw, text = source._page_content_cache[page.hash]
    assert "Hello world" in text
    assert "Toggle" in text
    assert "Nested text" in text

    # Per-page comments aggregate asset exists and is linked from the page.
    comment_assets = [a for a in assets if a.asset_type == OutputAssetType.TXT]
    assert len(comment_assets) == 1
    assert comment_assets[0].hash in page.links
    _, comment_text = await source.fetch_content(comment_assets[0].hash)
    assert "sensitive comment" in comment_text


@pytest.mark.asyncio
async def test_notion_relationships_become_links(monkeypatch: pytest.MonkeyPatch):
    source = NotionSource(_notion_recipe())
    _install_page_workspace(source, monkeypatch)

    assets = await _collect_assets(source)
    page = next(a for a in assets if a.asset_type == OutputAssetType.URL)

    parent_hash = source.generate_hash_id(source._canonical_url(PARENT_ID))
    relation_hash = source.generate_hash_id(source._canonical_url(RELATION_ID))

    # Parent and relation references are wired into the asset links graph.
    assert parent_hash in page.links
    assert relation_hash in page.links


@pytest.mark.asyncio
async def test_notion_file_asset_refetches_fresh_signed_url(
    monkeypatch: pytest.MonkeyPatch,
):
    source = NotionSource(_notion_recipe())
    _install_page_workspace(source, monkeypatch)

    assets = await _collect_assets(source)

    file_assets = [a for a in assets if a.asset_type == OutputAssetType.BINARY]
    assert len(file_assets) == 1
    file_asset = file_assets[0]
    assert file_asset.hash in next(a for a in assets if a.asset_type == OutputAssetType.URL).links

    fetched: dict[str, Any] = {}

    def _get_block(block_id: str) -> dict[str, Any]:
        fetched["block_id"] = block_id
        return {
            "id": block_id,
            "type": "file",
            "file": {
                "type": "file",
                "file": {"url": "https://s3.notion.so/signed/doc.pdf?fresh=1"},
            },
        }

    def _get_bytes(url: str, *, authed: bool = False) -> tuple[bytes, str]:
        fetched["download_url"] = url
        fetched["authed"] = authed
        return b"%PDF-1.4 data", "application/pdf"

    monkeypatch.setattr(source.client, "get_block", _get_block)
    monkeypatch.setattr(source.client, "get_bytes", _get_bytes)

    result = await source.fetch_content_bytes(file_asset.hash)

    assert result is not None
    file_bytes, _mime = result
    assert file_bytes == b"%PDF-1.4 data"
    # A fresh signed URL was obtained by re-fetching the block (not the stale one).
    assert fetched["block_id"] == FILE_BLOCK_ID
    assert fetched["download_url"].endswith("fresh=1")
    assert fetched["authed"] is False
