from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.google_cloud_storage.source import GoogleCloudStorageSource
from src.sources.object_storage.base import ContentSnapshot, ObjectRef


def _recipe(*, strategy: str = "ALL", rows_per_page: int | None = None) -> dict:
    sampling: dict[str, object] = {"strategy": strategy}
    if rows_per_page is not None:
        sampling["rows_per_page"] = rows_per_page

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
        ),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert [asset.name for asset in assets] == ["new.txt", "data.parquet"]
    assert assets[0].asset_type == OutputAssetType.TXT
    assert assets[1].asset_type == OutputAssetType.TABLE


class _FakeBlob:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def download_as_bytes(
        self, start: int | None = None, end: int | None = None, timeout: float | None = None
    ) -> bytes:
        if start is None and end is None:
            return self._data
        range_start = start or 0
        range_end = len(self._data) - 1 if end is None else end
        return self._data[range_start : range_end + 1]


class _FakeBucket:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def blob(self, key: str) -> _FakeBlob:
        return _FakeBlob(self._data)


class _FakeGcsClient:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def bucket(self, name: str) -> _FakeBucket:
        return _FakeBucket(self._data)


def test_google_cloud_storage_download_object_truncates_oversized_blob(monkeypatch, caplog):
    source = GoogleCloudStorageSource(
        {
            **_recipe(),
            "optional": {
                "connection": {"max_object_bytes": 1024},
                "scope": {"include_content_preview": True},
            },
        }
    )
    big_bytes = b"y" * 3000
    monkeypatch.setattr(source, "_client", lambda: _FakeGcsClient(big_bytes))
    ref = _ref("exports/big.bin", days_ago=0, size=len(big_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, _content_type = source._download_object(ref)

    assert len(file_bytes) == 1024
    assert any("Truncated" in record.message for record in caplog.records)


def test_google_cloud_storage_download_object_leaves_normal_blob_unchanged(monkeypatch, caplog):
    source = GoogleCloudStorageSource(_recipe())
    small_bytes = b"hello gcs"
    monkeypatch.setattr(source, "_client", lambda: _FakeGcsClient(small_bytes))
    ref = _ref("exports/small.txt", days_ago=0, size=len(small_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, content_type = source._download_object(ref)

    assert file_bytes == small_bytes
    assert content_type == "text/plain"
    assert not any("Truncated" in record.message for record in caplog.records)
