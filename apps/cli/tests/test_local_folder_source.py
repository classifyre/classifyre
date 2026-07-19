from __future__ import annotations

import os
from pathlib import Path

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.local_folder.source import LocalFolderSource

# Minimal valid 1x1 PNG (8-byte signature + IHDR/IDAT/IEND chunks).
_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)


def _recipe(path: Path, *, optional: dict | None = None, sampling: dict | None = None) -> dict:
    return {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(path)},
        "masked": {},
        "optional": optional or {},
        "sampling": sampling or {"strategy": "ALL"},
    }


def _make_source(path: Path, *, optional: dict | None = None, sampling: dict | None = None):
    return LocalFolderSource(
        _recipe(path, optional=optional, sampling=sampling),
        source_id="s",
        runner_id="r",
    )


async def _extract_assets(source: LocalFolderSource) -> list:
    assets = []
    async for batch in source.extract_raw():
        assets.extend(batch)
    return assets


def _keys(assets: list) -> set[str]:
    return {a.metadata["object_key"] for a in assets}


# ---------------------------------------------------------------------------
# 1. Nested traversal
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nested_traversal_returns_posix_relative_keys(tmp_path: Path):
    (tmp_path / "top.txt").write_text("top level")
    nested_dir = tmp_path / "a" / "b"
    nested_dir.mkdir(parents=True)
    (nested_dir / "deep.txt").write_text("deep file")

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    assert _keys(assets) == {"top.txt", "a/b/deep.txt"}
    names = {a.name for a in assets}
    assert names == {"top.txt", "deep.txt"}


# ---------------------------------------------------------------------------
# 2. Hidden files/dirs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hidden_files_skipped_by_default(tmp_path: Path):
    (tmp_path / "visible.txt").write_text("visible")
    (tmp_path / ".hidden.txt").write_text("hidden")
    hidden_dir = tmp_path / ".hiddendir"
    hidden_dir.mkdir()
    (hidden_dir / "inside.txt").write_text("inside hidden dir")

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    assert _keys(assets) == {"visible.txt"}


@pytest.mark.asyncio
async def test_hidden_files_included_when_configured(tmp_path: Path):
    (tmp_path / "visible.txt").write_text("visible")
    (tmp_path / ".hidden.txt").write_text("hidden")
    hidden_dir = tmp_path / ".hiddendir"
    hidden_dir.mkdir()
    (hidden_dir / "inside.txt").write_text("inside hidden dir")

    source = _make_source(tmp_path, optional={"traversal": {"include_hidden": True}})
    assets = await _extract_assets(source)

    assert _keys(assets) == {"visible.txt", ".hidden.txt", ".hiddendir/inside.txt"}


# ---------------------------------------------------------------------------
# 3. include/exclude extensions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_include_extensions_filters_to_allowlist(tmp_path: Path):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.csv").write_text("b,c\n1,2\n")
    (tmp_path / "c.md").write_text("# markdown")

    source = _make_source(tmp_path, optional={"scope": {"include_extensions": [".txt", ".csv"]}})
    assets = await _extract_assets(source)

    assert _keys(assets) == {"a.txt", "b.csv"}


@pytest.mark.asyncio
async def test_exclude_extensions_filters_out_denylist(tmp_path: Path):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.csv").write_text("b,c\n1,2\n")
    (tmp_path / "c.md").write_text("# markdown")

    source = _make_source(tmp_path, optional={"scope": {"exclude_extensions": [".md"]}})
    assets = await _extract_assets(source)

    assert _keys(assets) == {"a.txt", "b.csv"}


# ---------------------------------------------------------------------------
# 4. Empty files
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_files_skipped_by_default(tmp_path: Path):
    (tmp_path / "empty.txt").touch()
    (tmp_path / "nonempty.txt").write_text("content")

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    assert _keys(assets) == {"nonempty.txt"}


@pytest.mark.asyncio
async def test_empty_files_included_when_configured(tmp_path: Path):
    (tmp_path / "empty.txt").touch()
    (tmp_path / "nonempty.txt").write_text("content")

    source = _make_source(tmp_path, optional={"scope": {"include_empty_objects": True}})
    assets = await _extract_assets(source)

    assert _keys(assets) == {"empty.txt", "nonempty.txt"}


# ---------------------------------------------------------------------------
# 5. max_depth
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_max_depth_limits_recursion(tmp_path: Path):
    (tmp_path / "root.txt").write_text("root")
    level1 = tmp_path / "l1"
    level1.mkdir()
    (level1 / "one.txt").write_text("one")
    level2 = level1 / "l2"
    level2.mkdir()
    (level2 / "two.txt").write_text("two")

    source = _make_source(tmp_path, optional={"traversal": {"max_depth": 1}})
    assets = await _extract_assets(source)

    assert _keys(assets) == {"root.txt", "l1/one.txt"}


# ---------------------------------------------------------------------------
# 6. max_file_bytes truncation
# ---------------------------------------------------------------------------


def test_download_object_truncates_to_max_file_bytes(tmp_path: Path):
    big_file = tmp_path / "big.bin"
    big_file.write_bytes(b"x" * 3000)

    source = _make_source(tmp_path, optional={"traversal": {"max_file_bytes": 1024}})
    refs = list(source._list_objects())
    assert len(refs) == 1

    file_bytes, content_type_hint = source._download_object(refs[0])

    assert len(file_bytes) == 1024
    assert content_type_hint is None


# ---------------------------------------------------------------------------
# 7. external_url / hash determinism / etag & checksum change on edit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_url_and_hash_determinism(tmp_path: Path):
    file_path = tmp_path / "note.txt"
    file_path.write_text("hello")

    source_a = _make_source(tmp_path)
    assets_a = await _extract_assets(source_a)
    assert len(assets_a) == 1
    asset_a = assets_a[0]

    assert asset_a.external_url.startswith("file://")
    assert asset_a.external_url == f"file://{file_path.resolve().as_posix()}"

    source_b = _make_source(tmp_path)
    assets_b = await _extract_assets(source_b)
    asset_b = assets_b[0]

    assert asset_a.hash == asset_b.hash


@pytest.mark.asyncio
async def test_etag_and_checksum_change_on_content_and_mtime_change(tmp_path: Path):
    file_path = tmp_path / "note.txt"
    file_path.write_text("hello")
    os.utime(file_path, (1_700_000_000, 1_700_000_000))

    source_before = _make_source(tmp_path)
    assets_before = await _extract_assets(source_before)
    asset_before = assets_before[0]

    file_path.write_text("hello world, now longer")
    os.utime(file_path, (1_700_001_000, 1_700_001_000))

    source_after = _make_source(tmp_path)
    assets_after = await _extract_assets(source_after)
    asset_after = assets_after[0]

    # Hash is derived from the (unchanged) external_url/key, so it stays stable...
    assert asset_before.hash == asset_after.hash
    # ...but the etag (mtime+size signature) and checksum must reflect the edit.
    assert asset_before.metadata["etag"] != asset_after.metadata["etag"]
    assert asset_before.checksum != asset_after.checksum


# ---------------------------------------------------------------------------
# 8. asset_type mapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_asset_type_mapping_by_extension(tmp_path: Path):
    (tmp_path / "doc.txt").write_text("plain text")
    (tmp_path / "table.csv").write_text("a,b\n1,2\n")
    (tmp_path / "image.png").write_bytes(_PNG_BYTES)

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)
    by_key = {a.metadata["object_key"]: a for a in assets}

    assert by_key["doc.txt"].asset_type == OutputAssetType.TXT
    assert by_key["table.csv"].asset_type == OutputAssetType.TABLE
    assert by_key["image.png"].asset_type == OutputAssetType.IMAGE
    assert by_key["image.png"].asset_kind == "image"


# ---------------------------------------------------------------------------
# 9. Metadata contract (asset_kind + catalog-validated metadata)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_metadata_contract_for_file_asset(tmp_path: Path):
    (tmp_path / "doc.txt").write_text("plain text")

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)
    asset = assets[0]

    assert asset.asset_kind == "file"
    assert asset.metadata["provider"] == "LOCAL_FOLDER"
    assert asset.metadata["object_key"] == "doc.txt"
    assert asset.metadata["size_bytes"] == len("plain text")
    assert "mime_type" in asset.metadata


# ---------------------------------------------------------------------------
# 10. test_connection
# ---------------------------------------------------------------------------


def test_connection_success_for_valid_directory(tmp_path: Path):
    (tmp_path / "a.txt").write_text("a")

    source = _make_source(tmp_path)
    result = source.test_connection()

    assert result["status"] == "SUCCESS"


def test_connection_failure_for_missing_directory(tmp_path: Path):
    missing = tmp_path / "does-not-exist"

    source = _make_source(missing)
    result = source.test_connection()

    assert result["status"] == "FAILURE"


# ---------------------------------------------------------------------------
# 11. Sampling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sampling_random_respects_rows_per_page(tmp_path: Path):
    # SamplingConfig.rows_per_page has a hard floor of 10 (ge=10), so exercise the
    # floor value against a larger population rather than requesting 1 row.
    for i in range(15):
        (tmp_path / f"file{i}.txt").write_text(f"content {i}")

    source = _make_source(tmp_path, sampling={"strategy": "RANDOM", "rows_per_page": 10})
    assets = await _extract_assets(source)

    assert len(assets) == 10


@pytest.mark.asyncio
async def test_sampling_latest_respects_rows_per_page(tmp_path: Path):
    for i in range(15):
        (tmp_path / f"file{i}.txt").write_text(f"content {i}")

    source = _make_source(tmp_path, sampling={"strategy": "LATEST", "rows_per_page": 10})
    assets = await _extract_assets(source)

    assert len(assets) == 10


# ---------------------------------------------------------------------------
# Archive expansion (zip/tar members become child assets)
# ---------------------------------------------------------------------------


def _write_zip(path: Path, entries: dict[str, bytes]) -> None:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    path.write_bytes(buffer.getvalue())


@pytest.mark.asyncio
async def test_zip_archive_expands_members_into_child_assets(tmp_path: Path):
    _write_zip(
        tmp_path / "bundle.zip",
        {"docs/readme.txt": b"member text content", "logo.png": _PNG_BYTES},
    )

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    by_key = {a.metadata["object_key"]: a for a in assets}
    assert set(by_key) == {
        "bundle.zip",
        "bundle.zip#docs/readme.txt",
        "bundle.zip#logo.png",
    }

    parent = by_key["bundle.zip"]
    assert parent.asset_kind == "archive"
    assert parent.asset_type == OutputAssetType.BINARY

    text_child = by_key["bundle.zip#docs/readme.txt"]
    assert text_child.asset_kind == "file"
    assert text_child.asset_type == OutputAssetType.TXT
    assert text_child.metadata["source_hash"] == parent.hash
    assert text_child.metadata["location"] == "docs/readme.txt"
    assert text_child.metadata["mime_type"] == "text/plain"
    assert set(parent.links) == {text_child.hash, by_key["bundle.zip#logo.png"].hash}

    image_child = by_key["bundle.zip#logo.png"]
    assert image_child.asset_kind == "image"
    assert image_child.asset_type == OutputAssetType.IMAGE
    assert image_child.metadata["image_width"] == 1


@pytest.mark.asyncio
async def test_zip_member_content_flows_to_text_pages(tmp_path: Path):
    _write_zip(tmp_path / "bundle.zip", {"inner.txt": b"secret member text"})

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)
    child = next(a for a in assets if a.metadata["object_key"].endswith("#inner.txt"))

    pages = [page async for page in source.fetch_content_pages(child.hash)]
    assert any("secret member text" in page for _, page in pages)

    fetched = await source.fetch_content_bytes(child.hash)
    assert fetched is not None
    assert fetched[0] == b"secret member text"
    assert fetched[1] == "text/plain"


@pytest.mark.asyncio
async def test_nested_archive_member_not_expanded(tmp_path: Path):
    import io
    import zipfile

    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as archive:
        archive.writestr("deep.txt", b"deep content")
    _write_zip(tmp_path / "outer.zip", {"nested.zip": inner.getvalue()})

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    keys = _keys(assets)
    assert keys == {"outer.zip", "outer.zip#nested.zip"}
    nested = next(a for a in assets if a.metadata["object_key"] == "outer.zip#nested.zip")
    assert nested.asset_kind == "archive"


@pytest.mark.asyncio
async def test_tar_gz_archive_expands_members(tmp_path: Path):
    import io
    import tarfile

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        data = b"tar member body"
        info = tarfile.TarInfo("report/summary.txt")
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    (tmp_path / "backup.tar.gz").write_bytes(buffer.getvalue())

    source = _make_source(tmp_path)
    assets = await _extract_assets(source)

    keys = _keys(assets)
    assert keys == {"backup.tar.gz", "backup.tar.gz#report/summary.txt"}
    parent = next(a for a in assets if a.metadata["object_key"] == "backup.tar.gz")
    assert parent.asset_kind == "archive"
