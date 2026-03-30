from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.sources.azure_blob_storage.source import AzureBlobStorageSource
from src.sources.object_storage.base import ContentSnapshot, ObjectRef


def _recipe() -> dict:
    return {
        "type": "AZURE_BLOB_STORAGE",
        "required": {
            "account_url": "https://acme.blob.core.windows.net",
            "container": "documents",
        },
        "masked": {},
        "optional": {
            "scope": {
                "prefix": "exports/",
                "include_content_preview": True,
            }
        },
        "sampling": {
            "strategy": "LATEST",
            "limit": 5,
        },
    }


def _ref(key: str, *, size: int = 128) -> ObjectRef:
    return ObjectRef(
        key=key,
        size=size,
        last_modified=datetime.now(UTC),
        etag=f"etag-{key}",
        content_type_hint="text/plain",
    )


def test_azure_blob_storage_test_connection_success(monkeypatch):
    source = AzureBlobStorageSource(_recipe())
    monkeypatch.setattr(source, "_list_objects", lambda: [_ref("exports/file-1.txt")])

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Connected to AZURE_BLOB_STORAGE." in result["message"]


@pytest.mark.asyncio
async def test_azure_blob_storage_fetch_content_uses_object_ref_cache(monkeypatch):
    source = AzureBlobStorageSource(_recipe())
    ref = _ref("exports/content.txt")

    uri = source._external_url(ref.key)
    asset_hash = source.generate_hash_id(uri)
    source._object_ref_by_hash[asset_hash] = ref

    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda _ref_obj: ContentSnapshot(
            mime_type="text/plain",
            raw_content="hello world",
            text_content="hello world",
            parse_error=None,
            downloaded_bytes=11,
            truncated=False,
        ),
    )

    content = await source.fetch_content(asset_hash)
    assert content == ("hello world", "hello world")
    assert await source.fetch_content(asset_hash) == ("hello world", "hello world")


def test_azure_blob_storage_external_url():
    source = AzureBlobStorageSource(_recipe())
    assert (
        source._external_url("folder/report.csv")
        == "https://acme.blob.core.windows.net/documents/folder/report.csv"
    )
