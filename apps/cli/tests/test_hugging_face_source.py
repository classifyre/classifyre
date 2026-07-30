from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.asset_metadata import resolve_fields
from src.sources.hugging_face.source import HuggingFaceObjectRef, HuggingFaceSource
from src.sources.object_storage.base import ContentSnapshot

REPO_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"


def _recipe(
    *,
    strategy: str = "LATEST",
    rows_per_page: int | None = 10,
    repo_id: str = "acme/corpus",
    repo_type: str = "dataset",
    optional: dict | None = None,
) -> dict:
    sampling: dict[str, object] = {"strategy": strategy}
    if rows_per_page is not None:
        sampling["rows_per_page"] = rows_per_page

    return {
        "type": "HUGGING_FACE",
        "required": {"repo_id": repo_id, "repo_type": repo_type},
        "masked": {"token": "hf_test-token"},
        "optional": optional if optional is not None else {"scope": {"paths": ["data"]}},
        "sampling": sampling,
    }


def _source(**kwargs) -> HuggingFaceSource:
    """A source with the revision pre-resolved so no HfApi call is needed."""
    source = HuggingFaceSource(_recipe(**kwargs))
    source._cached_revision = REPO_SHA
    return source


def _ref(
    path: str,
    *,
    days_ago: int = 0,
    size: int = 2048,
    lfs_sha256: str | None = None,
) -> HuggingFaceObjectRef:
    return HuggingFaceObjectRef(
        key=path,
        size=size,
        last_modified=datetime.now(UTC) - timedelta(days=days_ago),
        etag=lfs_sha256 or f"blob-{path}",
        blob_id=f"blob-{path}",
        lfs_sha256=lfs_sha256,
    )


def _register(source: HuggingFaceSource, *refs: HuggingFaceObjectRef) -> None:
    for ref in refs:
        source._ref_by_key[ref.key] = ref


# ── tree entries ─────────────────────────────────────────────────────────


class _RepoFile(SimpleNamespace):
    """Stand-in for huggingface_hub.hf_api.RepoFile (class name is the signal)."""


class _RepoFolder(SimpleNamespace):
    """Stand-in for huggingface_hub.hf_api.RepoFolder."""


def _file_entry(
    path: str,
    *,
    size: int = 1024,
    lfs_sha256: str | None = None,
    lfs_size: int | None = None,
    commit_date: datetime | None = None,
) -> _RepoFile:
    entry = _RepoFile(
        path=path,
        size=size,
        blob_id=f"oid-{path}",
        lfs=(SimpleNamespace(sha256=lfs_sha256, size=lfs_size or size) if lfs_sha256 else None),
    )
    if commit_date is not None:
        entry.last_commit = SimpleNamespace(oid="c0ffee", date=commit_date)
    return entry


def _folder_entry(path: str) -> _RepoFolder:
    return _RepoFolder(path=path, tree_id=f"tree-{path}")


class _FakeHfApi:
    def __init__(self, tree: dict[str | None, list[object]], sha: str = REPO_SHA) -> None:
        self._tree = tree
        self._sha = sha
        self.tree_calls: list[dict] = []
        self.repo_info_calls: list[dict] = []

    def list_repo_tree(self, **kwargs):
        self.tree_calls.append(kwargs)
        return iter(self._tree.get(kwargs.get("path_in_repo"), []))

    def repo_info(self, **kwargs):
        self.repo_info_calls.append(kwargs)
        return SimpleNamespace(
            sha=self._sha,
            last_modified=datetime(2026, 6, 1, tzinfo=UTC),
        )


def _install_hub(monkeypatch, api: _FakeHfApi) -> None:
    def _hf_hub_url(*, repo_id, filename, repo_type, revision, endpoint):
        prefix = {"model": "", "dataset": "datasets/", "space": "spaces/"}[repo_type]
        return f"{endpoint}/{prefix}{repo_id}/resolve/{revision}/{filename}"

    monkeypatch.setattr(
        "src.sources.hugging_face.source.require_module",
        lambda **_kw: SimpleNamespace(
            HfApi=lambda **_kwargs: api,
            hf_hub_url=_hf_hub_url,
        ),
    )


# ── identity ─────────────────────────────────────────────────────────────


def test_hugging_face_identity_excludes_revision():
    """A commit that leaves a file untouched must not fork its asset."""
    source = _source()
    url = source._external_url("data/train-00000.parquet")

    assert url == "hf://datasets/acme/corpus/data/train-00000.parquet"

    source._cached_revision = "a" * 40
    assert source._external_url("data/train-00000.parquet") == url


def test_hugging_face_identity_is_namespaced_by_repo_type():
    """A model and a same-named dataset must not collide on one asset identity."""
    dataset = _source(repo_type="dataset", repo_id="acme/corpus")
    model = _source(repo_type="model", repo_id="acme/corpus")
    space = _source(repo_type="space", repo_id="acme/corpus")

    assert dataset._external_url("config.json") == "hf://datasets/acme/corpus/config.json"
    assert model._external_url("config.json") == "hf://models/acme/corpus/config.json"
    assert space._external_url("config.json") == "hf://spaces/acme/corpus/config.json"
    assert dataset.generate_hash_id(dataset._external_url("config.json")) != model.generate_hash_id(
        model._external_url("config.json")
    )


def test_hugging_face_external_url_escapes_spaces():
    source = _source()

    assert source._external_url("data/q1 report.csv") == (
        "hf://datasets/acme/corpus/data/q1%20report.csv"
    )


def test_hugging_face_web_url_points_at_the_scanned_commit():
    source = _source(repo_type="dataset")

    assert source._web_url("data/train.parquet") == (
        f"https://huggingface.co/datasets/acme/corpus/blob/{REPO_SHA}/data/train.parquet"
    )


def test_hugging_face_rejects_unsupported_repo_type():
    """repo_type is a schema enum, so a bad value is refused before any Hub call."""
    with pytest.raises(ValueError, match=r"'dataset', 'model' or 'space'"):
        HuggingFaceSource(
            {**_recipe(), "required": {"repo_id": "acme/corpus", "repo_type": "pipeline"}}
        )


# ── credentials ──────────────────────────────────────────────────────────


def test_hugging_face_token_comes_from_the_recipe_not_the_environment(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf_environment-token")
    source = _source()

    assert source._token() == "hf_test-token"


def test_hugging_face_missing_token_fails_loudly():
    source = HuggingFaceSource({**_recipe(), "masked": {"token": "  "}})

    with pytest.raises(ValueError, match=r"masked\.token"):
        source._token()


def test_hugging_face_api_is_built_with_the_explicit_token(monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "src.sources.hugging_face.source.require_module",
        lambda **_kw: SimpleNamespace(
            HfApi=lambda **kwargs: captured.update(kwargs) or SimpleNamespace(),
        ),
    )
    source = _source(
        optional={"connection": {"endpoint": "https://hub.internal.acme.com/"}},
    )
    source._api()

    assert captured == {
        "endpoint": "https://hub.internal.acme.com",
        "token": "hf_test-token",
    }


# ── listing ──────────────────────────────────────────────────────────────


def test_hugging_face_list_objects_walks_each_path_and_skips_folders(monkeypatch):
    source = _source(optional={"scope": {"paths": ["data/train", "data/test"]}})
    api = _FakeHfApi(
        {
            "data/train": [
                _file_entry("data/train/shard-0.parquet"),
                _folder_entry("data/train/nested"),
                _file_entry("data/train/nested/shard-1.parquet"),
            ],
            "data/test": [_file_entry("data/test/shard-0.parquet")],
        }
    )
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert [ref.key for ref in refs] == [
        "data/train/shard-0.parquet",
        "data/train/nested/shard-1.parquet",
        "data/test/shard-0.parquet",
    ]
    assert [call["path_in_repo"] for call in api.tree_calls] == ["data/train", "data/test"]
    assert api.tree_calls[0]["recursive"] is True
    assert api.tree_calls[0]["repo_type"] == "dataset"
    assert api.tree_calls[0]["token"] == "hf_test-token"


def test_hugging_face_list_objects_lists_repo_root_without_paths(monkeypatch):
    source = _source(optional={})
    api = _FakeHfApi({None: [_file_entry("README.md")]})
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert [ref.key for ref in refs] == ["README.md"]
    assert api.tree_calls[0]["path_in_repo"] is None


def test_hugging_face_overlapping_paths_emit_each_file_once(monkeypatch):
    source = _source(optional={"scope": {"paths": ["data", "data/train"]}})
    shared = _file_entry("data/train/shard-0.parquet")
    api = _FakeHfApi({"data": [shared], "data/train": [shared]})
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert [ref.key for ref in refs] == ["data/train/shard-0.parquet"]


def test_hugging_face_allow_and_ignore_patterns_filter_the_tree(monkeypatch):
    source = _source(
        optional={
            "scope": {
                "allow_patterns": ["**/*.parquet", "*.json"],
                "ignore_patterns": ["**/checkpoints/*"],
            }
        }
    )
    api = _FakeHfApi(
        {
            None: [
                _file_entry("config.json"),
                _file_entry("data/train.parquet"),
                _file_entry("data/checkpoints/step-100.parquet"),
                _file_entry("model.safetensors"),
                _file_entry("README.md"),
            ]
        }
    )
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert [ref.key for ref in refs] == ["config.json", "data/train.parquet"]


def test_hugging_face_bare_directory_pattern_matches_its_contents(monkeypatch):
    source = _source(optional={"scope": {"allow_patterns": ["data/"]}})
    api = _FakeHfApi({None: [_file_entry("data/train.csv"), _file_entry("other/train.csv")]})
    _install_hub(monkeypatch, api)

    assert [ref.key for ref in source._list_objects()] == ["data/train.csv"]


def test_hugging_face_extension_filters_apply_on_top_of_patterns(monkeypatch):
    source = _source(optional={"scope": {"exclude_extensions": [".safetensors", ".bin"]}})
    api = _FakeHfApi(
        {
            None: [
                _file_entry("model.safetensors"),
                _file_entry("pytorch_model.bin"),
                _file_entry("config.json"),
            ]
        }
    )
    _install_hub(monkeypatch, api)

    assert [ref.key for ref in source._list_objects()] == ["config.json"]


def test_hugging_face_lfs_files_report_the_payload_size_and_sha256(monkeypatch):
    """An LFS entry's own size is the pointer file; the payload size and the
    content digest both come from the LFS metadata."""
    source = _source(optional={})
    api = _FakeHfApi(
        {
            None: [
                _file_entry(
                    "data/train.parquet",
                    size=135,
                    lfs_sha256="f" * 64,
                    lfs_size=524288000,
                )
            ]
        }
    )
    _install_hub(monkeypatch, api)

    ref = next(iter(source._list_objects()))

    assert ref.size == 524288000
    assert ref.lfs_sha256 == "f" * 64
    assert ref.etag == "f" * 64


def test_hugging_face_non_lfs_files_fall_back_to_the_blob_oid(monkeypatch):
    source = _source(optional={})
    api = _FakeHfApi({None: [_file_entry("config.json", size=512)]})
    _install_hub(monkeypatch, api)

    ref = next(iter(source._list_objects()))

    assert ref.etag == "oid-config.json"
    assert ref.lfs_sha256 is None


def test_hugging_face_empty_files_are_skipped_by_default(monkeypatch):
    source = _source(optional={})
    api = _FakeHfApi({None: [_file_entry(".gitkeep", size=0), _file_entry("a.txt", size=10)]})
    _install_hub(monkeypatch, api)

    assert [ref.key for ref in source._list_objects()] == ["a.txt"]


def test_hugging_face_empty_files_included_on_request(monkeypatch):
    source = _source(optional={"scope": {"include_empty_objects": True}})
    api = _FakeHfApi({None: [_file_entry(".gitkeep", size=0)]})
    _install_hub(monkeypatch, api)

    assert [ref.key for ref in source._list_objects()] == [".gitkeep"]


def test_hugging_face_listing_uses_repo_last_modified_without_last_commit(monkeypatch):
    source = _source(optional={})
    api = _FakeHfApi({None: [_file_entry("a.txt")]})
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert api.tree_calls[0]["expand"] is False
    assert refs[0].last_modified == datetime(2026, 6, 1, tzinfo=UTC)


def test_hugging_face_last_commit_dates_drive_per_file_timestamps(monkeypatch):
    source = _source(optional={"scope": {"include_last_commit": True}})
    api = _FakeHfApi(
        {
            None: [
                _file_entry("a.txt", commit_date=datetime(2026, 7, 20, tzinfo=UTC)),
                _file_entry("b.txt", commit_date=datetime(2026, 3, 2, tzinfo=UTC)),
            ]
        }
    )
    _install_hub(monkeypatch, api)

    refs = list(source._list_objects())

    assert api.tree_calls[0]["expand"] is True
    assert [ref.last_modified for ref in refs] == [
        datetime(2026, 7, 20, tzinfo=UTC),
        datetime(2026, 3, 2, tzinfo=UTC),
    ]


def test_hugging_face_revision_is_resolved_once_and_pinned(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={"scope": {"revision": "refs/convert/parquet"}}))
    api = _FakeHfApi({}, sha="1234abcd" * 5)
    _install_hub(monkeypatch, api)

    assert source._revision() == "1234abcd" * 5
    assert source._revision() == "1234abcd" * 5
    assert len(api.repo_info_calls) == 1
    assert api.repo_info_calls[0]["revision"] == "refs/convert/parquet"


def test_hugging_face_unresolvable_revision_falls_back_to_the_configured_ref(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={"scope": {"revision": "v1.0"}}))

    class _Broken:
        def repo_info(self, **_kwargs):
            raise RuntimeError("network down")

    _install_hub(monkeypatch, _Broken())

    assert source._revision() == "v1.0"


# ── sampling ─────────────────────────────────────────────────────────────


def test_hugging_face_sampling_all_returns_every_file():
    source = _source(strategy="ALL", rows_per_page=10)
    refs = [_ref(f"data/f{index:02d}.parquet", days_ago=index) for index in range(25)]

    assert len(source._apply_sampling(iter(refs))) == 25


def test_hugging_face_sampling_latest_prefers_newest():
    source = _source(strategy="LATEST", rows_per_page=10)
    refs = [_ref(f"data/f{index:02d}.parquet", days_ago=index) for index in range(25)]

    sampled = source._apply_sampling(iter(refs))

    assert [item.key for item in sampled] == [f"data/f{index:02d}.parquet" for index in range(10)]


def test_hugging_face_sampling_random_is_deterministic():
    source = _source(strategy="RANDOM", rows_per_page=10)
    refs = [_ref(f"data/f{index:02d}.parquet", days_ago=index) for index in range(25)]

    first = source._apply_sampling(iter(refs))
    second = source._apply_sampling(iter(refs))

    assert [item.key for item in first] == [item.key for item in second]
    assert len(first) == 10


def test_hugging_face_sampling_automatic_advances_window_across_runs(monkeypatch):
    import base64
    import json

    refs = [_ref(f"data/f{index:02d}.parquet", days_ago=index) for index in range(25)]

    source = _source(strategy="AUTOMATIC", rows_per_page=10)
    first = source._apply_sampling(iter(refs))
    cursor = source.current_sampling_cursor()

    assert [item.key for item in first] == [f"data/f{index:02d}.parquet" for index in range(10)]
    assert cursor == {"objects": 10}

    monkeypatch.setenv(
        HuggingFaceSource.SAMPLING_CURSOR_ENV,
        base64.b64encode(json.dumps(cursor).encode()).decode(),
    )
    resumed = _source(strategy="AUTOMATIC", rows_per_page=10)
    second = resumed._apply_sampling(iter(refs))

    assert [item.key for item in second] == [
        f"data/f{index:02d}.parquet" for index in range(10, 20)
    ]


# ── download ─────────────────────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, data: bytes, content_type: str | None = "application/octet-stream") -> None:
        self._data = data
        self.headers = {"Content-Type": content_type} if content_type else {}
        self.closed = False

    def iter_content(self, chunk_size: int = 1024):
        for start in range(0, len(self._data), chunk_size):
            yield self._data[start : start + chunk_size]

    def raise_for_status(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True


class _FakeSession:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: list[dict] = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._response

    def close(self) -> None:
        return None


def test_hugging_face_download_streams_the_resolve_url_with_bearer_token(monkeypatch):
    source = _source()
    api = _FakeHfApi({})
    _install_hub(monkeypatch, api)
    session = _FakeSession(_FakeResponse(b"col_a,col_b\n1,2\n", "text/csv"))
    monkeypatch.setattr(source, "_session", lambda: session)

    file_bytes, content_type = source._download_object(_ref("data/train.csv"))

    assert file_bytes == b"col_a,col_b\n1,2\n"
    assert content_type == "text/csv"
    assert session.calls[0]["url"] == (
        f"https://huggingface.co/datasets/acme/corpus/resolve/{REPO_SHA}/data/train.csv"
    )
    assert session.calls[0]["headers"]["Authorization"] == "Bearer hf_test-token"
    assert session.calls[0]["stream"] is True


def test_hugging_face_download_stops_at_the_byte_cap(monkeypatch, caplog):
    """A multi-hundred-megabyte LFS shard must never be transferred in full."""
    source = _source(optional={"connection": {"max_object_bytes": 4096}})
    source._cached_revision = REPO_SHA
    api = _FakeHfApi({})
    _install_hub(monkeypatch, api)
    response = _FakeResponse(b"x" * 5_000_000)
    session = _FakeSession(response)
    monkeypatch.setattr(source, "_session", lambda: session)

    with caplog.at_level("WARNING"):
        file_bytes, _content_type = source._download_object(
            _ref("data/huge.parquet", size=5_000_000)
        )

    assert len(file_bytes) == 4096
    assert response.closed
    assert any("Truncated hugging_face:" in record.message for record in caplog.records)


# ── extraction and detector payloads ─────────────────────────────────────


@pytest.mark.asyncio
async def test_hugging_face_extract_emits_assets_with_hub_metadata(monkeypatch):
    source = _source(strategy="LATEST", rows_per_page=10)
    refs = [
        _ref("data/old.csv", days_ago=10),
        _ref("data/new.csv", days_ago=0, lfs_sha256="a" * 64),
        _ref("docs/guide.pdf", days_ago=5),
    ]

    def _list_objects():
        _register(source, *refs)
        return iter(refs)

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda ref: ContentSnapshot(
            mime_type="text/csv" if ref.key.endswith(".csv") else "application/pdf",
            raw_content="",
            text_content="",
            parse_error=None,
            downloaded_bytes=ref.size,
        ),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert [asset.name for asset in assets] == ["new.csv", "guide.pdf", "old.csv"]
    assert assets[0].asset_type == OutputAssetType.TABLE
    assert assets[1].asset_type == OutputAssetType.BINARY
    assert assets[0].external_url == "hf://datasets/acme/corpus/data/new.csv"
    assert assets[0].asset_kind == "file"
    assert assets[0].metadata["provider"] == "HUGGING_FACE"
    assert assets[0].metadata["object_key"] == "data/new.csv"
    assert assets[0].metadata["repo_id"] == "acme/corpus"
    assert assets[0].metadata["repo_type"] == "dataset"
    assert assets[0].metadata["revision"] == REPO_SHA
    assert assets[0].metadata["lfs_sha256"] == "a" * 64
    assert assets[0].metadata["web_url"].endswith(f"/blob/{REPO_SHA}/data/new.csv")


def test_hugging_face_checksum_tracks_the_content_digest(monkeypatch):
    """Re-listing the same bytes yields the same checksum; new bytes change it, so
    the scan cache re-scans exactly the files whose content moved."""
    modified = datetime(2026, 6, 1, tzinfo=UTC)

    def _checksum_for(etag: str) -> str:
        source = _source(strategy="ALL")
        ref = HuggingFaceObjectRef(
            key="data/train.parquet",
            size=2048,
            last_modified=modified,
            etag=etag,
            blob_id="oid-train",
            lfs_sha256=etag,
        )
        monkeypatch.setattr(
            source,
            "_build_snapshot",
            lambda _ref: ContentSnapshot(
                mime_type="application/parquet",
                raw_content="",
                text_content="",
                parse_error=None,
                downloaded_bytes=0,
            ),
        )
        return source._to_asset(ref).checksum

    assert _checksum_for("a" * 64) == _checksum_for("a" * 64)
    assert _checksum_for("a" * 64) != _checksum_for("b" * 64)


@pytest.mark.asyncio
async def test_hugging_face_parquet_file_yields_parsed_detector_pages(monkeypatch):
    """Parquet shards go through the shared file parser, so detectors see rows."""
    pytest.importorskip("pyarrow")
    import pyarrow as pa
    import pyarrow.parquet as pq

    buffer = io.BytesIO()
    table = pa.table({"name": ["Ada"], "email": ["ada@example.com"]})
    pq.write_table(table, buffer)
    parquet_bytes = buffer.getvalue()

    source = _source(strategy="ALL")
    ref = _ref("data/train-00000.parquet", size=len(parquet_bytes))

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(
        source,
        "_download_object",
        lambda _ref: (parquet_bytes, "application/octet-stream"),
    )

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    asset = assets[0]
    assert asset.asset_type == OutputAssetType.TABLE
    assert asset.metadata["row_count"] == 1
    pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    assert any("ada@example.com" in page for page in pages)


@pytest.mark.asyncio
async def test_hugging_face_csv_file_yields_parsed_detector_pages(monkeypatch):
    source = _source(strategy="ALL")
    ref = _ref("data/customers.csv")
    csv_bytes = b"name,email\nAda,ada@example.com\n"

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(source, "_download_object", lambda _ref: (csv_bytes, "text/csv"))

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    asset = assets[0]
    assert asset.asset_type == OutputAssetType.TABLE
    pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    assert any("ada@example.com" in page for page in pages)


@pytest.mark.asyncio
async def test_hugging_face_image_file_becomes_an_image_asset(monkeypatch):
    source = _source(strategy="ALL")
    ref = _ref("data/images/sample.png")
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    )

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(source, "_download_object", lambda _ref: (png_bytes, "image/png"))

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert assets[0].asset_type == OutputAssetType.IMAGE
    assert assets[0].asset_kind == "image"
    assert await source.fetch_content_bytes(assets[0].hash) == (png_bytes, "image/png")


@pytest.mark.asyncio
async def test_hugging_face_archive_members_become_linked_child_assets(monkeypatch):
    source = _source(strategy="ALL")
    ref = _ref("data/raw/documents.zip")

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    monkeypatch.setattr(source, "_list_objects", _list_objects)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("inside/report.txt", b"archive member content")
    archive_bytes = buffer.getvalue()

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

    parent = next(asset for asset in assets if asset.asset_kind == "archive")
    child = next(asset for asset in assets if "#inside/report.txt" in asset.name)

    assert child.hash in parent.links
    # Children inherit the parent's Hub identity fields.
    assert child.metadata["repo_id"] == "acme/corpus"
    assert child.metadata["revision"] == REPO_SHA
    assert await source.fetch_content_bytes(child.hash) == (
        b"archive member content",
        "text/plain",
    )
    source.cleanup()


@pytest.mark.asyncio
async def test_hugging_face_discovery_only_never_downloads(monkeypatch):
    """A metadata-only inventory must not stream any bytes."""
    source = _source(strategy="ALL")
    ref = _ref("data/huge.parquet", size=5_000_000_000)
    source.set_discovery_only(True)

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    def _boom(_ref):
        raise AssertionError("discovery-only scans must not download file bytes")

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_download_object", _boom)

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert assets[0].metadata["size_bytes"] == 5_000_000_000
    assert assets[0].metadata["mime_type"] == "application/parquet"


@pytest.mark.asyncio
async def test_hugging_face_content_preview_off_skips_download(monkeypatch):
    source = _source(strategy="ALL", optional={"scope": {"include_content_preview": False}})
    source._cached_revision = REPO_SHA
    ref = _ref("data/train.parquet")

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    def _boom(_ref):
        raise AssertionError("include_content_preview=false must not download file bytes")

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_download_object", _boom)

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    assert len(assets) == 1


# ── scan cache ───────────────────────────────────────────────────────────


def test_hugging_face_trusts_the_hub_digest_for_the_scan_cache():
    """LFS SHA-256 and blob OIDs are content-derived, so an unchanged checksum
    is proof enough to skip re-reading the bytes."""
    source = _source()

    assert source.SUPPORTS_SCAN_CACHE is True
    assert source.scan_cache_verification_mode() == "metadata"


def test_hugging_face_falls_back_to_content_hashing_without_object_metadata():
    source = _source(optional={"scope": {"include_object_metadata": False}})

    assert source.scan_cache_verification_mode() == "content"


# ── connection test ──────────────────────────────────────────────────────


def test_hugging_face_test_connection_reports_repo_and_file_count(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={}))
    api = _FakeHfApi({None: [_file_entry("a.txt"), _file_entry("b.txt")]})
    _install_hub(monkeypatch, api)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "dataset acme/corpus" in result["message"]
    assert "2 file(s)" in result["message"]
    assert REPO_SHA[:12] in result["message"]


def test_hugging_face_gated_repo_error_explains_the_fix(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={}))

    class GatedRepoError(Exception):
        pass

    class _Broken:
        def repo_info(self, **_kwargs):
            raise GatedRepoError("Access to this repo is restricted")

    _install_hub(monkeypatch, _Broken())

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "gated" in result["message"]
    assert "Accept the repository's terms" in result["message"]


def test_hugging_face_missing_repo_error_points_at_token_permissions(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={}))

    class RepositoryNotFoundError(Exception):
        pass

    class _Broken:
        def repo_info(self, **_kwargs):
            raise RepositoryNotFoundError("404 Client Error")

    _install_hub(monkeypatch, _Broken())

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "read permission" in result["message"]


def test_hugging_face_bad_revision_error_names_the_revision(monkeypatch):
    source = HuggingFaceSource(_recipe(optional={"scope": {"revision": "v9.9"}}))

    class RevisionNotFoundError(Exception):
        pass

    class _Broken:
        def repo_info(self, **_kwargs):
            raise RevisionNotFoundError("revision not found")

    _install_hub(monkeypatch, _Broken())

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "v9.9" in result["message"]


# ── registration and dependencies ────────────────────────────────────────


def test_hugging_face_source_is_registered():
    from src.sources import get_source, list_available_sources

    assert "hugging_face" in list_available_sources()
    assert isinstance(get_source(_recipe()), HuggingFaceSource)


def test_hugging_face_recipe_requests_the_hub_dependency_group():
    from src.utils.dependency_groups import recipe_uv_groups

    assert recipe_uv_groups(_recipe()) == {"hugging-face"}


def test_hugging_face_missing_client_raises_actionable_error(monkeypatch):
    from src.sources.dependencies import MissingSourceDependencyError

    def _no_module(*_args, **_kwargs):
        raise ImportError("no module named huggingface_hub")

    monkeypatch.setattr("src.utils.uv_sync.auto_install_enabled", lambda: False)
    monkeypatch.setattr("importlib.import_module", _no_module)
    source = _source()

    with pytest.raises(MissingSourceDependencyError, match="uv sync --group hugging-face"):
        source._hub()


# ── asset metadata catalog ───────────────────────────────────────────────


def test_hugging_face_asset_metadata_catalog_declares_every_kind():
    for asset_kind in ("file", "image", "audio", "video", "archive"):
        fields = resolve_fields("hugging_face", asset_kind)
        names = {field["name"] for field in fields}
        assert {
            "provider",
            "object_key",
            "repo_id",
            "repo_type",
            "revision",
            "blob_id",
            "lfs_sha256",
            "web_url",
            "size_bytes",
            "mime_type",
        } <= names, asset_kind
