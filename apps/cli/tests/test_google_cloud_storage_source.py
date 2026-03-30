from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.google_cloud_storage.source import GoogleCloudStorageSource
from src.sources.object_storage.base import ContentSnapshot, ObjectRef


def _recipe(*, strategy: str = "ALL", limit: int | None = None) -> dict:
    sampling: dict[str, object] = {"strategy": strategy}
    if limit is not None:
        sampling["limit"] = limit

    return {
        "type": "GOOGLE_CLOUD_STORAGE",
        "required": {"bucket": "documents"},
        "masked": {},
        "optional": {
            "scope": {
                "prefix": "exports/",
                "include_content_preview": True,
            }
        },
        "sampling": sampling,
    }


def _ref(key: str, *, days_ago: int, size: int = 128) -> ObjectRef:
    return ObjectRef(
        key=key,
        size=size,
        last_modified=datetime.now(UTC) - timedelta(days=days_ago),
        etag=f"etag-{key}",
        content_type_hint="text/plain" if key.endswith(".txt") else None,
    )


def test_google_cloud_storage_external_url():
    source = GoogleCloudStorageSource(_recipe())
    assert source._external_url("folder/report.csv") == "gs://documents/folder/report.csv"


@pytest.mark.asyncio
async def test_google_cloud_storage_extract_uses_all_sampling(monkeypatch):
    source = GoogleCloudStorageSource(_recipe(strategy="ALL"))
    refs = [
        _ref("exports/new.txt", days_ago=0),
        _ref("exports/data.parquet", days_ago=1),
    ]

    monkeypatch.setattr(source, "_list_objects", lambda: refs)
    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda ref: ContentSnapshot(
            mime_type="text/plain" if ref.key.endswith(".txt") else "application/parquet",
            raw_content="hello" if ref.key.endswith(".txt") else "",
            text_content="hello" if ref.key.endswith(".txt") else "",
            parse_error=None,
            downloaded_bytes=5,
            truncated=False,
        ),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert [asset.name for asset in assets] == ["new.txt", "data.parquet"]
    assert assets[0].asset_type == OutputAssetType.TXT
    assert assets[1].asset_type == OutputAssetType.TABLE
