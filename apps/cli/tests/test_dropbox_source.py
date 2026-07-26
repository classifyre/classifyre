from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.asset_metadata import resolve_fields
from src.sources.dropbox.source import DropboxObjectRef, DropboxSource
from src.sources.object_storage.base import ContentSnapshot


def _recipe(
    *,
    strategy: str = "LATEST",
    rows_per_page: int | None = 10,
    optional: dict | None = None,
    oauth: bool = False,
) -> dict:
    sampling: dict[str, object] = {"strategy": strategy}
    if rows_per_page is not None:
        sampling["rows_per_page"] = rows_per_page

    if oauth:
        required: dict[str, object] = {"auth_method": "oauth", "app_key": "app-key"}
        masked: dict[str, object] = {
            "app_secret": "app-secret",
            "refresh_token": "refresh-token",
        }
    else:
        required = {"auth_method": "access_token"}
        masked = {"access_token": "sl.token"}

    return {
        "type": "DROPBOX",
        "required": required,
        "masked": masked,
        "optional": optional
        if optional is not None
        else {"scope": {"folder_path": "/Finance", "include_content_preview": True}},
        "sampling": sampling,
    }


def _ref(
    path: str,
    *,
    days_ago: int = 0,
    size: int = 1108,
    file_id: str | None = None,
) -> DropboxObjectRef:
    return DropboxObjectRef(
        key=path,
        size=size,
        last_modified=datetime.now(UTC) - timedelta(days=days_ago),
        etag=f"content-hash-{path}",
        file_id=file_id or f"id:{path.strip('/').replace('/', '-')}",
        rev="0123456789abcdef",
    )


def _register(source: DropboxSource, *refs: DropboxObjectRef) -> None:
    for ref in refs:
        source._ref_by_key[ref.key] = ref


# ── identity ─────────────────────────────────────────────────────────────


def test_dropbox_identity_survives_move_and_rename():
    source = DropboxSource(_recipe())
    before = _ref("/Finance/report.pdf", file_id="id:STABLE1")
    after = _ref("/Archive/2026/report-final.pdf", file_id="id:STABLE1")

    _register(source, before, after)

    url_before = source._external_url(before.key)
    url_after = source._external_url(after.key)

    assert url_before == "dropbox://files/id:STABLE1"
    assert url_before == url_after
    assert source.generate_hash_id(url_before) == source.generate_hash_id(url_after)


def test_dropbox_identity_differs_per_file():
    source = DropboxSource(_recipe())
    one = _ref("/a.txt", file_id="id:ONE")
    two = _ref("/b.txt", file_id="id:TWO")
    _register(source, one, two)

    assert source._external_url(one.key) != source._external_url(two.key)


def test_dropbox_external_url_falls_back_to_path_without_known_id():
    source = DropboxSource(_recipe())

    assert source._external_url("/Finance/q1 report.csv") == (
        "dropbox://path/Finance/q1%20report.csv"
    )


# ── sampling ─────────────────────────────────────────────────────────────


def test_dropbox_sampling_random_is_deterministic():
    source = DropboxSource(_recipe(strategy="RANDOM", rows_per_page=10))
    refs = [_ref(f"/f{index:02d}.txt", days_ago=index) for index in range(25)]

    first = source._apply_sampling(refs)
    second = source._apply_sampling(refs)

    assert [item.key for item in first] == [item.key for item in second]
    assert len(first) == 10


def test_dropbox_sampling_latest_prefers_newest():
    source = DropboxSource(_recipe(strategy="LATEST", rows_per_page=10))
    refs = [_ref(f"/f{index:02d}.txt", days_ago=index) for index in range(25)]

    sampled = source._apply_sampling(refs)

    assert [item.key for item in sampled] == [f"/f{index:02d}.txt" for index in range(10)]


def test_dropbox_sampling_all_returns_everything():
    source = DropboxSource(_recipe(strategy="ALL", rows_per_page=10))
    refs = [_ref(f"/f{index:02d}.txt", days_ago=index) for index in range(25)]

    assert len(source._apply_sampling(refs)) == 25


def test_dropbox_sampling_automatic_advances_window_across_runs(monkeypatch):
    refs = [_ref(f"/f{index:02d}.txt", days_ago=index) for index in range(25)]

    source = DropboxSource(_recipe(strategy="AUTOMATIC", rows_per_page=10))
    first = source._apply_sampling(refs)
    cursor = source.current_sampling_cursor()

    assert [item.key for item in first] == [f"/f{index:02d}.txt" for index in range(10)]
    assert cursor == {"objects": 10}

    import base64
    import json

    monkeypatch.setenv(
        DropboxSource.SAMPLING_CURSOR_ENV,
        base64.b64encode(json.dumps(cursor).encode()).decode(),
    )
    resumed = DropboxSource(_recipe(strategy="AUTOMATIC", rows_per_page=10))
    second = resumed._apply_sampling(refs)

    assert [item.key for item in second] == [f"/f{index:02d}.txt" for index in range(10, 20)]


# ── extraction ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dropbox_extract_emits_assets_with_stable_metadata(monkeypatch):
    source = DropboxSource(_recipe(strategy="LATEST", rows_per_page=10))
    refs = [
        _ref("/Finance/old.csv", days_ago=10, file_id="id:OLD"),
        _ref("/Finance/new.csv", days_ago=0, file_id="id:NEW"),
        _ref("/Finance/mid.pdf", days_ago=5, file_id="id:MID"),
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

    assert [asset.name for asset in assets] == ["new.csv", "mid.pdf", "old.csv"]
    assert assets[0].asset_type == OutputAssetType.TABLE
    assert assets[1].asset_type == OutputAssetType.BINARY
    assert assets[0].external_url == "dropbox://files/id:NEW"
    assert assets[0].metadata["file_id"] == "id:NEW"
    assert assets[0].metadata["object_key"] == "/Finance/new.csv"
    assert assets[0].metadata["provider"] == "DROPBOX"
    assert assets[0].metadata["rev"] == "0123456789abcdef"
    assert assets[0].asset_kind == "file"


@pytest.mark.asyncio
async def test_dropbox_archive_members_become_linked_child_assets(monkeypatch):
    source = DropboxSource(_recipe(strategy="ALL", rows_per_page=10))
    ref = _ref("/Finance/documents.zip", file_id="id:ZIP")

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
    # Children inherit the parent's Dropbox identity fields.
    assert child.metadata["file_id"] == "id:ZIP"
    assert await source.fetch_content_bytes(child.hash) == (
        b"archive member content",
        "text/plain",
    )
    source.cleanup()


# ── detector payloads ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dropbox_downloaded_file_yields_parsed_detector_pages(monkeypatch):
    """Bytes fetched from Dropbox go through the shared file parser, so detectors
    see extracted text rather than raw bytes."""
    source = DropboxSource(_recipe(strategy="ALL", rows_per_page=10))
    ref = _ref("/Finance/customers.csv", file_id="id:CSV")
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
async def test_dropbox_exported_paper_doc_yields_parsed_detector_pages(monkeypatch):
    """Paper docs have no downloadable bytes; the markdown export still reaches
    detectors as text."""
    source = DropboxSource(_recipe(strategy="ALL", rows_per_page=10))
    ref = DropboxObjectRef(
        key="/Finance/Plan.paper",
        size=0,
        last_modified=datetime.now(UTC),
        file_id="id:PAPER",
        is_downloadable=False,
        export_format="markdown",
    )

    def _list_objects():
        _register(source, ref)
        return iter([ref])

    class _Client:
        def files_export(self, path, export_format):
            return SimpleNamespace(), _FakeResponse(
                b"# Plan\n\nreach ada@example.com for the budget", None
            )

    monkeypatch.setattr(source, "_list_objects", _list_objects)
    monkeypatch.setattr(source, "_ensure_file_processing_dependencies", lambda: None)
    monkeypatch.setattr(source, "_client", _Client)

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    asset = assets[0]
    assert asset.metadata["exported_as"] == "text/markdown"
    pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    assert any("ada@example.com" in page for page in pages)


# ── listing ──────────────────────────────────────────────────────────────


def _file_entry(
    path: str,
    *,
    file_id: str,
    size: int = 100,
    is_downloadable: bool = True,
    export_options: list[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=file_id,
        name=path.rsplit("/", maxsplit=1)[-1],
        path_display=path,
        size=size,
        rev="a1b2c3",
        content_hash="deadbeef",
        server_modified=datetime(2026, 5, 1, tzinfo=UTC),
        is_downloadable=is_downloadable,
        export_info=SimpleNamespace(export_as="markdown", export_options=export_options or []),
        preview_url=None,
    )


class _FakeDropboxClient:
    def __init__(self, pages: list[SimpleNamespace]) -> None:
        self._pages = pages
        self.list_calls: list[dict] = []
        self.continue_calls: list[str] = []

    def files_list_folder(self, **kwargs):
        self.list_calls.append(kwargs)
        return self._pages[0]

    def files_list_folder_continue(self, cursor):
        self.continue_calls.append(cursor)
        return self._pages[len(self.continue_calls)]


def test_dropbox_list_objects_paginates_and_filters(monkeypatch):
    source = DropboxSource(
        _recipe(
            optional={
                "scope": {
                    "folder_path": "Finance/",
                    "exclude_extensions": [".tmp"],
                },
                "connection": {"max_entries_per_page": 250},
            }
        )
    )

    page_one = SimpleNamespace(
        entries=[
            _file_entry("/Finance/a.pdf", file_id="id:A"),
            SimpleNamespace(id="id:FOLDER", name="sub", path_display="/Finance/sub"),
            _file_entry("/Finance/scratch.tmp", file_id="id:TMP"),
            _file_entry("/Finance/empty.txt", file_id="id:EMPTY", size=0),
        ],
        has_more=True,
        cursor="cursor-1",
    )
    page_two = SimpleNamespace(
        entries=[_file_entry("/Finance/b.docx", file_id="id:B")],
        has_more=False,
        cursor="cursor-2",
    )
    client = _FakeDropboxClient([page_one, page_two])
    monkeypatch.setattr(source, "_client", lambda: client)

    refs = list(source._list_objects())

    assert [ref.key for ref in refs] == ["/Finance/a.pdf", "/Finance/b.docx"]
    assert [ref.file_id for ref in refs] == ["id:A", "id:B"]
    assert client.list_calls[0]["path"] == "/Finance"
    assert client.list_calls[0]["limit"] == 250
    assert client.list_calls[0]["recursive"] is True
    assert client.continue_calls == ["cursor-1"]


def test_dropbox_list_objects_uses_account_root_for_empty_folder_path(monkeypatch):
    source = DropboxSource(_recipe(optional={}))
    client = _FakeDropboxClient(
        [SimpleNamespace(entries=[], has_more=False, cursor="c")],
    )
    monkeypatch.setattr(source, "_client", lambda: client)

    list(source._list_objects())

    assert client.list_calls[0]["path"] == ""


# ── download ─────────────────────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, data: bytes, content_type: str | None = "application/octet-stream") -> None:
        self._data = data
        self.headers = {"Content-Type": content_type} if content_type else {}
        self.closed = False

    def iter_content(self, chunk_size: int = 1024):
        for start in range(0, len(self._data), chunk_size):
            yield self._data[start : start + chunk_size]

    def close(self) -> None:
        self.closed = True


def test_dropbox_download_object_downloads_by_file_id(monkeypatch):
    source = DropboxSource(_recipe())
    ref = _ref("/Finance/report.pdf", file_id="id:REPORT")
    captured: dict[str, object] = {}

    class _Client:
        def files_download(self, path):
            captured["path"] = path
            return SimpleNamespace(), _FakeResponse(b"%PDF-1.4 hello", "application/pdf")

    monkeypatch.setattr(source, "_client", _Client)

    file_bytes, content_type = source._download_object(ref)

    assert captured["path"] == "id:REPORT"
    assert file_bytes == b"%PDF-1.4 hello"
    assert content_type == "application/pdf"


def test_dropbox_download_object_truncates_oversized_file(monkeypatch, caplog):
    source = DropboxSource(
        _recipe(optional={"connection": {"max_object_bytes": 1024}}),
    )
    ref = _ref("/Finance/big.bin", size=300000)
    response = _FakeResponse(b"x" * 300000)

    class _Client:
        def files_download(self, path):
            return SimpleNamespace(), response

    monkeypatch.setattr(source, "_client", _Client)

    with caplog.at_level("WARNING"):
        file_bytes, _content_type = source._download_object(ref)

    assert len(file_bytes) == 1024
    assert response.closed
    assert any("Truncated" in record.message for record in caplog.records)


def test_dropbox_exports_non_downloadable_paper_doc(monkeypatch):
    source = DropboxSource(_recipe())
    ref = DropboxObjectRef(
        key="/Finance/Plan.paper",
        size=0,
        last_modified=datetime.now(UTC),
        file_id="id:PAPER",
        is_downloadable=False,
        export_format="markdown",
    )
    captured: dict[str, object] = {}

    class _Client:
        def files_export(self, path, export_format):
            captured["path"] = path
            captured["export_format"] = export_format
            return SimpleNamespace(), _FakeResponse(b"# Plan\n\nsecret budget", None)

    monkeypatch.setattr(source, "_client", _Client)

    file_bytes, content_type = source._download_object(ref)

    assert captured == {"path": "id:PAPER", "export_format": "markdown"}
    assert file_bytes == b"# Plan\n\nsecret budget"
    assert content_type == "text/markdown"
    assert source._extra_asset_metadata(ref)["exported_as"] == "text/markdown"


def test_dropbox_non_downloadable_entry_keeps_export_format(monkeypatch):
    source = DropboxSource(_recipe(optional={}))
    entry = _file_entry(
        "/Plan.paper",
        file_id="id:PAPER",
        size=0,
        is_downloadable=False,
        export_options=["markdown", "html"],
    )
    client = _FakeDropboxClient(
        [SimpleNamespace(entries=[entry], has_more=False, cursor="c")],
    )
    monkeypatch.setattr(source, "_client", lambda: client)

    refs = list(source._list_objects())

    assert len(refs) == 1
    assert refs[0].is_downloadable is False
    assert refs[0].export_format == "markdown"


def test_dropbox_non_downloadable_entry_skipped_when_export_disabled(monkeypatch):
    source = DropboxSource(
        _recipe(optional={"scope": {"export_non_downloadable": False}}),
    )
    entry = _file_entry("/Plan.paper", file_id="id:PAPER", size=0, is_downloadable=False)
    client = _FakeDropboxClient(
        [SimpleNamespace(entries=[entry], has_more=False, cursor="c")],
    )
    monkeypatch.setattr(source, "_client", lambda: client)

    assert list(source._list_objects()) == []


# ── client construction ──────────────────────────────────────────────────


def test_dropbox_client_uses_refresh_token_for_oauth(monkeypatch):
    source = DropboxSource(_recipe(oauth=True))
    captured: dict[str, object] = {}

    class _FakeSdk:
        @staticmethod
        def Dropbox(**kwargs):  # noqa: N802 - mirrors the SDK class name
            captured.update(kwargs)
            return SimpleNamespace()

    monkeypatch.setattr("src.sources.dropbox.source.require_module", lambda **_kw: _FakeSdk)

    source._build_client()

    assert captured["oauth2_refresh_token"] == "refresh-token"
    assert captured["app_key"] == "app-key"
    assert captured["app_secret"] == "app-secret"
    assert "oauth2_access_token" not in captured


def test_dropbox_client_uses_access_token(monkeypatch):
    source = DropboxSource(_recipe())
    captured: dict[str, object] = {}

    class _FakeSdk:
        @staticmethod
        def Dropbox(**kwargs):  # noqa: N802 - mirrors the SDK class name
            captured.update(kwargs)
            return SimpleNamespace()

    monkeypatch.setattr("src.sources.dropbox.source.require_module", lambda **_kw: _FakeSdk)

    source._build_client()

    assert captured["oauth2_access_token"] == "sl.token"
    assert "oauth2_refresh_token" not in captured


def test_dropbox_test_connection_reports_account(monkeypatch):
    source = DropboxSource(_recipe())

    class _Client:
        def users_get_current_account(self):
            return SimpleNamespace(name=SimpleNamespace(display_name="Ada Lovelace"))

    monkeypatch.setattr(source, "_client", _Client)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Ada Lovelace" in result["message"]
    assert "/Finance" in result["message"]


def test_dropbox_test_connection_reports_failure(monkeypatch):
    source = DropboxSource(_recipe())

    def _boom():
        raise RuntimeError("invalid_access_token")

    monkeypatch.setattr(source, "_client", _boom)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "invalid_access_token" in result["message"]


# ── asset metadata catalog ───────────────────────────────────────────────


def test_dropbox_asset_metadata_catalog_declares_every_kind():
    for asset_kind in ("file", "image", "audio", "video", "archive"):
        fields = resolve_fields("dropbox", asset_kind)
        names = {field["name"] for field in fields}
        assert {"provider", "object_key", "file_id", "rev"} <= names, asset_kind
