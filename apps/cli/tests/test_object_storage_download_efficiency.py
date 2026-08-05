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
import io
import zipfile
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from src.pipeline.parsed_content_provider import ParsedContentProvider
from src.sources.dropbox.source import DropboxObjectRef, DropboxSource
from src.sources.git.source import GitObjectRef, GitSource
from src.sources.hugging_face.source import HuggingFaceObjectRef, HuggingFaceSource
from src.sources.object_storage.base import ObjectRef
from src.sources.s3_compatible_storage.source import S3CompatibleStorageSource
from src.utils.payload import PayloadTooLargeError

CSV_BYTES = b"name,email\nAda,ada@example.com\nGrace,grace@example.com\n"
MODIFIED = datetime(2026, 6, 1, tzinfo=UTC)


def _archive_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("inside/member.txt", b"member content")
    return buffer.getvalue()


ARCHIVE_BYTES = _archive_bytes()


def _archive_ref(source, template):
    """A container ref shaped like this source's own refs (subclass fields intact)."""
    del source
    return replace(template, key="data/bundle.zip", size=len(ARCHIVE_BYTES))


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


def _git(file_count: int):
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": "https://git.example.com/acme/corpus.git"},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    source._resolved_branch = "main"
    source._commit_sha = "c" * 40
    refs = [
        GitObjectRef(
            key=f"data/f{index:03d}.csv",
            size=len(CSV_BYTES),
            last_modified=MODIFIED,
            etag=f"blob-{index}",
            blob_id=f"blob-{index}",
        )
        for index in range(file_count)
    ]
    return source, refs


SOURCE_FACTORIES = {
    "hugging_face": _hugging_face,
    "dropbox": _dropbox,
    "s3_compatible_storage": _s3,
    "git": _git,
}


def _instrument(source, refs, monkeypatch, *, fail_on: set[str] | None = None):
    """Wire the source to in-memory objects and count byte reads.

    Both seams are counted. ``_download_object`` is the whole-object read (binary
    detectors, and providers that have not been migrated); ``_stream_object`` is
    the chunked read behind ``_open_object``, which is where a migrated provider
    now fetches its bytes. Either one hitting the network twice for the same
    object is the regression these tests exist to catch, so both land in the same
    list.
    """
    downloads: list[str] = []

    def _download(ref):
        downloads.append(ref.key)
        if fail_on and ref.key in fail_on:
            raise RuntimeError("object unavailable")
        return CSV_BYTES, "text/csv"

    def _stream(ref):
        downloads.append(ref.key)
        if fail_on and ref.key in fail_on:
            raise RuntimeError("object unavailable")
        yield CSV_BYTES

    monkeypatch.setattr(source, "_list_objects", lambda: iter(refs))
    monkeypatch.setattr(source, "_download_object", _download)
    monkeypatch.setattr(source, "_stream_object", _stream)
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
async def test_discovery_reads_containers_but_not_ordinary_objects(source_name, monkeypatch):
    """Containers are the sole exception to the metadata-only discovery pass.

    A container's child assets can only be enumerated by reading it, and discovery
    is the only phase where new assets may appear — so skipping it there means the
    embedded files and archive members never become assets at all. Everything else
    must still cost nothing.
    """
    source, refs = SOURCE_FACTORIES[source_name](3)
    archive_ref = _archive_ref(source, refs[0])
    refs.append(archive_ref)
    downloads = _instrument(source, refs, monkeypatch)

    def _download(ref):
        downloads.append(ref.key)
        return (ARCHIVE_BYTES, "application/zip") if ref is archive_ref else (CSV_BYTES, "text/csv")

    monkeypatch.setattr(source, "_download_object", _download)

    stubs = await _discover(source)

    assert downloads == [archive_ref.key]
    assert any(stub.name.endswith("#inside/member.txt") for stub in stubs)
    # The container's bytes are not pinned for the rest of the scan.
    parent = next(stub for stub in stubs if stub.name.endswith("bundle.zip"))
    assert parent.hash not in source._bytes_cache
    source.cleanup()


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


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_an_object_far_larger_than_the_memory_cap_is_still_scanned(source_name, monkeypatch):
    """The size ceiling is gone: ``max_object_bytes`` bounds memory, not file size.

    It used to bound both, by truncating — which for a text file lost the tail and
    for a Parquet or a zip lost the file. Now anything past the cap is streamed to
    a temp file, so the object is read whole and the heap is not.
    """
    source, refs = SOURCE_FACTORIES[source_name](1)
    # One object two orders of magnitude past the in-memory threshold.
    big_row = b"filler,padding,ada@example.com\n"
    body = b"a,b,email\n" + big_row * 40_000
    refs[0] = replace(refs[0], size=len(body))

    monkeypatch.setattr(source, "_list_objects", lambda: iter(refs))
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(
        source,
        "_download_object",
        lambda _ref: pytest.fail("the streaming path must be used for a large object"),
    )
    monkeypatch.setattr(source, "_stream_object", lambda _ref: iter([body]))
    # A threshold far below the object forces the spill-to-disk path.
    monkeypatch.setattr(source, "_spool_threshold_bytes", lambda: 4096)

    stubs = await _discover(source)
    pages_by_asset = await _run_scan(source, stubs, max_concurrent=1)

    pages = next(iter(pages_by_asset.values()))
    assert len(pages) == 40_000, f"expected every row to be paged, got {len(pages)}"
    assert all("ada@example.com" in page for page in pages)


@pytest.mark.parametrize("source_name", sorted(SOURCE_FACTORIES))
@pytest.mark.asyncio
async def test_a_hard_size_limit_refuses_an_object_instead_of_truncating_it(
    source_name, monkeypatch
):
    """``max_file_bytes`` is the deliberate refusal, and it is opt-in.

    The distinction that matters is refusal versus truncation: a partial payload
    reports success and is recorded as a scanned, near-empty asset, which is the
    failure mode the old caps had.
    """
    source, refs = SOURCE_FACTORIES[source_name](1)
    body = b"a,b,email\n" + b"filler,padding,ada@example.com\n" * 5_000
    refs[0] = replace(refs[0], size=len(body))

    monkeypatch.setattr(source, "_list_objects", lambda: iter(refs))
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(source, "_stream_object", lambda _ref: iter([body]))
    monkeypatch.setattr(source, "_hard_size_limit_bytes", lambda: 1024)

    stubs = await _discover(source)

    with pytest.raises(PayloadTooLargeError):
        source._open_object(refs[0])

    # And through the scan, the asset yields nothing rather than a truncated head.
    pages_by_asset = await _run_scan(source, stubs, max_concurrent=1)
    assert all(pages == [] for pages in pages_by_asset.values())
