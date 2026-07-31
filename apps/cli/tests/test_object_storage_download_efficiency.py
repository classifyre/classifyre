"""Object-storage sources must read each object's bytes exactly once per scan.

These are family-wide guards, parametrized over every concrete
``ObjectStorageSourceBase`` connector, because the behaviour under test lives in
the shared base: a regression in one place silently doubles egress and memory for
S3, Azure, GCS, Dropbox, Google Workspace, Microsoft 365 and Hugging Face at once.

The scan shape mirrors ``main.py``: phase 1 discovers with
``set_discovery_only(True)`` (metadata only), then phase 2 processes each asset
through ``ParsedContentProvider`` under a concurrency semaphore.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from src.pipeline.parsed_content_provider import ParsedContentProvider
from src.sources.dropbox.source import DropboxObjectRef, DropboxSource
from src.sources.hugging_face.source import HuggingFaceObjectRef, HuggingFaceSource
from src.sources.object_storage.base import ObjectRef
from src.sources.s3_compatible_storage.source import S3CompatibleStorageSource

CSV_BYTES = b"name,email\nAda,ada@example.com\nGrace,grace@example.com\n"
MODIFIED = datetime(2026, 6, 1, tzinfo=UTC)


def _hugging_face(file_count: int):
    source = HuggingFaceSource(
        {
            "type": "HUGGING_FACE",
            "required": {"repo_id": "acme/corpus", "repo_type": "dataset"},
            "masked": {"token": "hf_test-token"},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    source._cached_revision = "a" * 40
    refs = [
        HuggingFaceObjectRef(
            key=f"data/f{index:03d}.csv",
            size=len(CSV_BYTES),
            last_modified=MODIFIED,
            etag=f"sha-{index}",
            blob_id=f"oid-{index}",
        )
        for index in range(file_count)
    ]
    return source, refs


def _dropbox(file_count: int):
    source = DropboxSource(
        {
            "type": "DROPBOX",
            "required": {"auth_method": "access_token"},
            "masked": {"access_token": "sl.token"},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    refs = [
        DropboxObjectRef(
            key=f"/data/f{index:03d}.csv",
            size=len(CSV_BYTES),
            last_modified=MODIFIED,
            etag=f"hash-{index}",
            file_id=f"id:{index}",
        )
        for index in range(file_count)
    ]
    return source, refs


def _s3(file_count: int):
    source = S3CompatibleStorageSource(
        {
            "type": "S3_COMPATIBLE_STORAGE",
            "required": {"bucket": "corpus"},
            "masked": {"aws_access_key_id": "key", "aws_secret_access_key": "secret"},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    refs = [
        ObjectRef(
            key=f"data/f{index:03d}.csv",
            size=len(CSV_BYTES),
            last_modified=MODIFIED,
            etag=f"etag-{index}",
        )
        for index in range(file_count)
    ]
    return source, refs


SOURCE_FACTORIES = {
    "hugging_face": _hugging_face,
    "dropbox": _dropbox,
    "s3_compatible_storage": _s3,
}


def _instrument(source, refs, monkeypatch, *, fail_on: set[str] | None = None):
    """Wire the source to in-memory objects and count byte reads."""
    downloads: list[str] = []

    def _download(ref):
        downloads.append(ref.key)
        if fail_on and ref.key in fail_on:
            raise RuntimeError("object unavailable")
        return CSV_BYTES, "text/csv"

    monkeypatch.setattr(source, "_list_objects", lambda: iter(refs))
    monkeypatch.setattr(source, "_download_object", _download)
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    return downloads


async def _run_scan(source, stub_assets, *, max_concurrent: int, evict: bool = True):
    """Phase 2 as main.py runs it: bounded concurrency, evict after each asset."""
    provider = ParsedContentProvider(source)
    semaphore = asyncio.Semaphore(max_concurrent)
    pages_by_asset: dict[str, list[str]] = {}

    async def _process(asset):
        async with semaphore:
            try:
                pages_by_asset[asset.hash] = [
                    page async for page in provider.fetch_text_pages(asset.hash)
                ]
            finally:
                if evict:
                    source.evict_asset_cache(asset.hash)

    await asyncio.gather(*(_process(asset) for asset in stub_assets), return_exceptions=True)
    return pages_by_asset


async def _discover(source):
    source.set_discovery_only(True)
    stubs = [asset async for batch in source.extract_raw() for asset in batch]
    source.set_discovery_only(False)
    return stubs


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_discovery_phase_downloads_nothing(source_name, monkeypatch):
    """Phase 1 builds the asset inventory from listing metadata alone.

    Downloading here would mean a 10,000-object bucket fetches 10,000 objects
    before a single detector runs.
    """
    source, refs = SOURCE_FACTORIES[source_name](25)
    downloads = _instrument(source, refs, monkeypatch)

    stubs = await _discover(source)

    assert len(stubs) == 25
    assert downloads == []


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_each_object_is_downloaded_exactly_once(source_name, monkeypatch):
    """Regression: fetch_content_pages() used to fall through to fetch_content(),
    which downloaded the object and discarded it, so the provider's
    fetch_content_bytes() fallback fetched the same object a second time."""
    source, refs = SOURCE_FACTORIES[source_name](20)
    downloads = _instrument(source, refs, monkeypatch)

    stubs = await _discover(source)
    pages_by_asset = await _run_scan(source, stubs, max_concurrent=5)

    assert len(downloads) == 20, f"expected 1 download per object, got {len(downloads)} for 20"
    assert sorted(downloads) == sorted(ref.key for ref in refs)
    # The single download must still produce detector-ready text.
    assert all(
        any("ada@example.com" in page for page in pages) for pages in pages_by_asset.values()
    )


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_processed_objects_do_not_accumulate_in_memory(source_name, monkeypatch):
    """Object bytes must not stay resident after an asset is processed.

    A scan pod runs under a hard memory limit, so retaining even one capped
    object per processed asset is enough to OOM a large bucket.
    """
    source, refs = SOURCE_FACTORIES[source_name](30)
    _instrument(source, refs, monkeypatch)

    stubs = await _discover(source)
    await _run_scan(source, stubs, max_concurrent=5)

    assert source._bytes_cache == {}
    assert source._content_cache == {}


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_failed_objects_leak_no_bytes(source_name, monkeypatch):
    """main.py skips evict_asset_cache() when an asset raises, so the byte-fetch
    path must not be what keeps those bytes alive."""
    source, refs = SOURCE_FACTORIES[source_name](10)
    failing = {refs[index].key for index in (1, 4, 7)}
    _instrument(source, refs, monkeypatch, fail_on=failing)

    stubs = await _discover(source)
    # evict=False models the error path, where main.py never evicts.
    await _run_scan(source, stubs, max_concurrent=5, evict=False)

    assert source._bytes_cache == {}
