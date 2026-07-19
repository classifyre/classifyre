from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime, timedelta

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.object_storage.base import ContentSnapshot, ObjectRef
from src.sources.s3_compatible_storage.source import S3CompatibleStorageSource


def _recipe(
    *,
    strategy: str = "LATEST",
    rows_per_page: int | None = 10,
) -> dict:
    sampling: dict[str, object] = {"strategy": strategy}
    if rows_per_page is not None:
        sampling["rows_per_page"] = rows_per_page
    return {
        "type": "S3_COMPATIBLE_STORAGE",
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


def _ref(key: str, *, days_ago: int, size: int = 1108) -> ObjectRef:
    return ObjectRef(
        key=key,
        size=size,
        last_modified=datetime.now(UTC) - timedelta(days=days_ago),
        etag=f"etag-{key}",
    )


def test_s3_storage_sampling_random_is_deterministic():
    source = S3CompatibleStorageSource(_recipe(strategy="RANDOM", rows_per_page=10))
    refs = [
        _ref("exports/a.txt", days_ago=4),
        _ref("exports/b.txt", days_ago=3),
        _ref("exports/c.txt", days_ago=10),
        _ref("exports/d.txt", days_ago=1),
        _ref("exports/e.txt", days_ago=0),
    ]

    sampled_once = source._apply_sampling(refs)
    sampled_twice = source._apply_sampling(refs)

    assert [item.key for item in sampled_once] == [item.key for item in sampled_twice]
    assert len(sampled_once) == 5


@pytest.mark.asyncio
async def test_s3_storage_extract_applies_latest_sampling_and_asset_types(monkeypatch):
    source = S3CompatibleStorageSource(_recipe(strategy="LATEST", rows_per_page=10))
    refs = [
        _ref("exports/old.csv", days_ago=10),
        _ref("exports/new.csv", days_ago=0),
        _ref("exports/mid.pdf", days_ago=5),
    ]

    monkeypatch.setattr(source, "_list_objects", lambda: refs)

    snapshots = {
        "exports/old.csv": ContentSnapshot(
            mime_type="text/csv",
            raw_content="a,b\n1,10\n",
            text_content="a,b\n1,10\n",
            parse_error=None,
            downloaded_bytes=110,
        ),
        "exports/new.csv": ContentSnapshot(
            mime_type="text/csv",
            raw_content="a,b\n10,3\n",
            text_content="a,b\n10,3\n",
            parse_error=None,
            downloaded_bytes=110,
        ),
        "exports/mid.pdf": ContentSnapshot(
            mime_type="application/pdf",
            raw_content="",
            text_content="Extracted PDF text",
            parse_error=None,
            downloaded_bytes=10104,
        ),
    }
    monkeypatch.setattr(source, "_build_snapshot", lambda ref: snapshots[ref.key])

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert [asset.name for asset in assets] == ["new.csv", "mid.pdf", "old.csv"]
    assert assets[0].asset_type == OutputAssetType.TABLE
    assert assets[1].asset_type == OutputAssetType.BINARY


@pytest.mark.asyncio
async def test_s3_storage_fetch_content_bytes_redownloads_binary_media(monkeypatch):
    source = S3CompatibleStorageSource(_recipe())
    ref = ObjectRef(
        key="exports/image.jpg",
        size=2048,
        last_modified=datetime.now(UTC),
        etag="etag-jpg",
        content_type_hint="application/octet-stream",
    )

    external_url = source._external_url(ref.key)
    asset_hash = source.generate_hash_id(external_url)
    source._hash_to_uri[asset_hash] = external_url
    source._object_ref_by_hash[asset_hash] = ref

    jpeg_bytes = b"\xff\xd8\xfftest-image"
    monkeypatch.setattr(
        source,
        "_download_object",
        lambda _ref_obj: (jpeg_bytes, "application/octet-stream"),
    )

    assert await source.fetch_content_bytes(asset_hash) == (jpeg_bytes, "image/jpeg")


def test_s3_storage_iter_asset_pages_passes_media_without_feature_flags(
    monkeypatch: pytest.MonkeyPatch,
):
    source = S3CompatibleStorageSource(_recipe())
    captured: dict[str, object] = {}

    def _iter_file_pages(
        file_bytes: bytes,
        mime_type: str,
        batch_size: int = 100,
        include_column_names: bool = True,
        *,
        file_name: str = "",
    ):
        captured["file_bytes"] = file_bytes
        captured["mime_type"] = mime_type
        captured["batch_size"] = batch_size
        captured["include_column_names"] = include_column_names
        captured["file_name"] = file_name
        yield "ocr page"

    monkeypatch.setattr("src.utils.file_parser.iter_file_pages", _iter_file_pages)

    pages = list(
        source.iter_asset_pages(
            b"file-bytes",
            "application/pdf",
            batch_size=50,
            include_column_names=False,
            file_name="scan.pdf",
        )
    )

    assert pages == ["ocr page"]
    assert captured["file_name"] == "scan.pdf"


def _hf_parquet_bytes() -> bytes:
    import io

    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    from PIL import Image

    def _png(color: str) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), color).save(buf, format="PNG")
        return buf.getvalue()

    table = pa.table(
        {
            "image": pa.array(
                [{"bytes": _png("red"), "path": None}, {"bytes": _png("blue"), "path": None}]
            ),
            "label": pa.array([6, 7], type=pa.int64()),
        }
    )
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_s3_storage_emits_child_image_assets_for_parquet(monkeypatch):
    pytest.importorskip("PIL")
    source = S3CompatibleStorageSource(_recipe(strategy="LATEST", rows_per_page=10))
    ref = _ref("exports/dataset.parquet", days_ago=0)
    monkeypatch.setattr(source, "_list_objects", lambda: [ref])

    parquet_bytes = _hf_parquet_bytes()
    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda _ref: ContentSnapshot(
            mime_type="application/parquet",
            raw_content="",
            text_content="",
            parse_error=None,
            downloaded_bytes=len(parquet_bytes),
            raw_bytes=parquet_bytes,
        ),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    parents = [a for a in assets if a.asset_type == OutputAssetType.TABLE]
    children = [a for a in assets if a.asset_type == OutputAssetType.IMAGE]

    assert len(parents) == 1
    parent = parents[0]
    # One child IMAGE asset per embedded image, referenced from the parent's links.
    assert len(children) == 2
    child_hashes = {c.hash for c in children}
    assert child_hashes.issubset(set(parent.links))
    for child in children:
        # Bytes are cached so the binary-detector path serves them with no download.
        fetched = await source.fetch_content_bytes(child.hash)
        assert fetched is not None
        image_bytes, mime = fetched
        assert mime == "image/png"
        assert image_bytes.startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_s3_storage_spools_archive_members_until_processing(monkeypatch):
    source = S3CompatibleStorageSource(_recipe(strategy="LATEST", rows_per_page=10))
    ref = _ref("exports/documents.zip", days_ago=0)
    monkeypatch.setattr(source, "_list_objects", lambda: [ref])

    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        archive.writestr("inside/report.txt", b"archive member content")
    archive_bytes = archive_buffer.getvalue()
    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda _ref: ContentSnapshot(
            mime_type="application/zip",
            raw_content="",
            text_content="",
            parse_error=None,
            downloaded_bytes=len(archive_bytes),
            raw_bytes=archive_bytes,
        ),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    child = next(asset for asset in assets if "#inside/report.txt" in asset.name)
    member_path = source._archive_bytes_cache[child.hash]
    assert child.hash not in source._bytes_cache
    assert member_path.is_file()
    assert len(member_path.name) == 64
    assert await source.fetch_content_bytes(child.hash) == (
        b"archive member content",
        "text/plain",
    )

    source.evict_asset_cache(child.hash)

    assert not member_path.exists()
    source.cleanup()


def test_s3_storage_external_url_for_custom_endpoint():
    source = S3CompatibleStorageSource(
        {
            **_recipe(),
            "optional": {
                "connection": {"endpoint_url": "https://minio.local"},
                "scope": {"include_content_preview": False},
            },
        }
    )

    assert (
        source._external_url("folder/report.csv")
        == "https://minio.local/documents/folder/report.csv"
    )


def test_s3_storage_snapshot_prefers_detected_mime_for_octet_stream_hint(monkeypatch):
    source = S3CompatibleStorageSource(_recipe())
    ref = ObjectRef(
        key="exports/invoice.pdf",
        size=10104,
        last_modified=datetime.now(UTC),
        etag="etag-pdf",
        content_type_hint="application/octet-stream",
    )

    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(
        source,
        "_download_object",
        lambda _ref_obj: (b"%PDF-1.4 test", "application/octet-stream"),
    )

    snapshot = source._build_snapshot(ref)

    assert snapshot.mime_type == "application/pdf"


class _FakeStreamingBody:
    """Mimics botocore's StreamingBody: read(amt) reads at most amt bytes."""

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0
        self.closed = False

    def read(self, amt: int | None = None) -> bytes:
        if amt is None:
            chunk = self._data[self._pos :]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos : self._pos + amt]
        self._pos += len(chunk)
        return chunk

    def close(self) -> None:
        self.closed = True


class _FakeS3Client:
    def __init__(self, data: bytes, content_type: str | None = "text/plain") -> None:
        self._data = data
        self._content_type = content_type

    def get_object(self, **kwargs: object) -> dict:
        return {"Body": _FakeStreamingBody(self._data), "ContentType": self._content_type}


def test_s3_storage_download_object_truncates_oversized_object(monkeypatch, caplog):
    source = S3CompatibleStorageSource(
        {
            **_recipe(),
            "optional": {
                "connection": {"max_object_bytes": 1024},
                "scope": {"include_content_preview": True},
            },
        }
    )
    big_bytes = b"x" * 3000
    monkeypatch.setattr(source, "_client", lambda: _FakeS3Client(big_bytes))
    ref = _ref("exports/big.bin", days_ago=0, size=len(big_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, content_type = source._download_object(ref)

    assert len(file_bytes) == 1024
    assert content_type == "text/plain"
    assert any("Truncated" in record.message for record in caplog.records)


def test_s3_storage_download_object_leaves_normal_object_unchanged(monkeypatch, caplog):
    source = S3CompatibleStorageSource(_recipe())
    small_bytes = b"hello world"
    monkeypatch.setattr(source, "_client", lambda: _FakeS3Client(small_bytes))
    ref = _ref("exports/small.txt", days_ago=0, size=len(small_bytes))

    with caplog.at_level("WARNING"):
        file_bytes, _content_type = source._download_object(ref)

    assert file_bytes == small_bytes
    assert not any("Truncated" in record.message for record in caplog.records)
