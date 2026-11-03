from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.sources.azure_blob_storage.source import AzureBlobStorageSource
from src.sources.object_storage.base import ContentSnapshot, ObjectRef
from src.utils.urn import Urn


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


class _FakeDownloader:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def readall(self) -> bytes:
        return self._data


class _FakeBlobClient:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def download_blob(
        self, offset: int = 0, length: int | None = None, timeout: float | None = None
    ) -> _FakeDownloader:
        start = offset or 0
        end = len(self._data) if length is None else start + length
        return _FakeDownloader(self._data[start:end])


class _FakeContainerClient:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def get_blob_client(self, key: str) -> _FakeBlobClient:
        return _FakeBlobClient(self._data)


class _FakeAzureClient:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def get_container_client(self, container: str) -> _FakeContainerClient:
        return _FakeContainerClient(self._data)


def test_azure_blob_storage_download_object_truncates_oversized_blob(monkeypatch, caplog):
    source = AzureBlobStorageSource(
        {
            **_recipe(),
            "optional": {
                "connection": {"max_object_bytes": 1024},
                "scope": {"include_content_preview": True},
            },
        }
    )
    big_bytes = b"z" * 3000
    monkeypatch.setattr(source, "_client", lambda: _FakeAzureClient(big_bytes))
    ref = _ref("exports/big.bin", size=len(big_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, _content_type = source._download_object(ref)

    assert len(file_bytes) == 1024
    assert any("Truncated" in record.message for record in caplog.records)


def test_azure_blob_storage_download_object_leaves_normal_blob_unchanged(monkeypatch, caplog):
    source = AzureBlobStorageSource(_recipe())
    small_bytes = b"hello azure"
    monkeypatch.setattr(source, "_client", lambda: _FakeAzureClient(small_bytes))
    ref = _ref("exports/small.txt", size=len(small_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, content_type = source._download_object(ref)

    assert file_bytes == small_bytes
    assert content_type == "text/plain"
    assert not any("Truncated" in record.message for record in caplog.records)


def test_azure_listing_passes_the_page_size_to_list_blobs(monkeypatch) -> None:
    """azure-core's ItemPaged.by_page() takes only a continuation token.

    Handing it the page size raised TypeError, so every Azure listing failed.
    """

    class _Blob:
        def __init__(self, name: str) -> None:
            self.name = name
            self.size = 10
            self.last_modified = datetime(2026, 1, 1, tzinfo=UTC)
            self.etag = "e"
            self.content_settings = None

    class _Pages:
        def by_page(self, continuation_token: str | None = None) -> list[list[_Blob]]:
            assert continuation_token is None
            return [[_Blob("docs/a.txt"), _Blob("docs/b.txt")]]

    calls: list[dict] = []

    class _Container:
        def list_blobs(self, **kwargs: object) -> _Pages:
            calls.append(kwargs)
            return _Pages()

    class _Service:
        def get_container_client(self, container: str) -> _Container:
            return _Container()

    source = AzureBlobStorageSource(_recipe())
    monkeypatch.setattr(source, "_client", _Service)
    assert [ref.key for ref in source._list_objects()] == ["docs/a.txt", "docs/b.txt"]
    assert calls and calls[0]["results_per_page"] == source._max_keys_per_page()


def test_azure_lakehouse_table_urn_round_trips() -> None:
    """The table URN authority is the account, not the account URL.

    The authority used to be the full account URL plus container, so the URN
    held '://' and slashes and never survived a parse round-trip.
    """
    source = AzureBlobStorageSource(_recipe())
    authority = source._lakehouse_authority()
    assert authority is not None and "://" not in authority and "/" not in authority
    urn = Urn.of("delta", authority, *source._lakehouse_prefix(), "warehouse", "orders")
    assert str(urn) == "delta://acme/documents/warehouse/orders"
    assert Urn.parse(str(urn)) == urn
