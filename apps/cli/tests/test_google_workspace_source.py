"""Unit tests for the Google Workspace source."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from src.sources.google_workspace.source import (
    _EXPORT_MIME_MAP,
    _NON_DOWNLOADABLE_GOOGLE_TYPES,
    FileRef,
    GoogleWorkspaceSource,
)


def _base_recipe(auth_mode: str = "service_account", **overrides: object) -> dict:
    if auth_mode == "service_account":
        required: dict = {"auth_method": "service_account"}
        masked: dict = {"service_account_json": '{"type": "service_account"}'}
    elif auth_mode == "service_account_delegated":
        required = {"auth_method": "service_account", "delegated_subject": "admin@example.com"}
        masked = {"service_account_json": '{"type": "service_account"}'}
    elif auth_mode == "oauth":
        required = {"auth_method": "oauth", "client_id": "client-1"}
        masked = {"client_secret": "secret-1", "refresh_token": "refresh-1"}
    else:
        raise ValueError(f"Unknown auth_mode: {auth_mode}")

    recipe: dict = {
        "type": "GOOGLE_WORKSPACE",
        "required": required,
        "masked": masked,
        "sampling": {"strategy": "LATEST"},
        **overrides,
    }
    return recipe


def _make_files(count: int, drive_id: str = "drive-1") -> list[FileRef]:
    base = datetime(2025, 1, 1, tzinfo=UTC)
    from datetime import timedelta

    return [
        FileRef(
            file_id=f"file-{i}",
            name=f"file-{i}.pdf",
            path=f"/docs/file-{i}.pdf",
            size=1000 * (i + 1),
            mime_type="application/pdf",
            modified_time=base + timedelta(days=i),
            created_time=base,
            web_url=f"https://drive.example.com/file-{i}",
            md5_checksum=None,
            owner=None,
            drive_id=drive_id,
            drive_name="Shared Drive",
            drive_type="shared_drive",
        )
        for i in range(count)
    ]


class TestAuthValidation:
    def test_service_account_valid(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe("service_account"))
        assert source.source_type == "google_workspace"

    def test_service_account_delegated_valid(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe("service_account_delegated"))
        assert source.config.required.auth_method == "service_account"
        assert source.config.required.delegated_subject == "admin@example.com"

    def test_oauth_valid(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe("oauth"))
        assert source.config.required.auth_method == "oauth"

    def test_missing_service_account_json_raises(self) -> None:
        recipe = {
            "type": "GOOGLE_WORKSPACE",
            "required": {"auth_method": "service_account"},
            "masked": {"client_secret": "x", "refresh_token": "y"},
            "sampling": {"strategy": "LATEST"},
        }
        with pytest.raises(ValueError):
            GoogleWorkspaceSource(recipe)

    def test_oauth_missing_refresh_token_raises(self) -> None:
        recipe = {
            "type": "GOOGLE_WORKSPACE",
            "required": {"auth_method": "oauth", "client_id": "c"},
            "masked": {"service_account_json": "{}"},
            "sampling": {"strategy": "LATEST"},
        }
        with pytest.raises(ValueError):
            GoogleWorkspaceSource(recipe)


class TestSampling:
    def test_all_returns_everything(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "ALL"})
        source = GoogleWorkspaceSource(recipe)
        items = _make_files(10)
        sampled = source._apply_sampling(items, "drive-1")
        assert len(sampled) == 10

    def test_random_returns_limited(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10})
        source = GoogleWorkspaceSource(recipe)
        items = _make_files(20)
        sampled = source._apply_sampling(items, "drive-1")
        assert len(sampled) == 10

    def test_random_is_deterministic(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10})
        source = GoogleWorkspaceSource(recipe)
        items = _make_files(20)
        sampled1 = source._apply_sampling(items, "drive-1")
        sampled2 = source._apply_sampling(items, "drive-1")
        assert [s.file_id for s in sampled1] == [s.file_id for s in sampled2]

    def test_latest_returns_most_recent(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10})
        source = GoogleWorkspaceSource(recipe)
        items = _make_files(20)
        sampled = source._apply_sampling(items, "drive-1")
        assert len(sampled) == 10
        assert sampled[0].file_id == "file-19"

    def test_automatic_advances_cursor_and_wraps(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
        source = GoogleWorkspaceSource(recipe)
        items = _make_files(24)

        first = source._apply_sampling(items, "drive-1")
        assert [f.file_id for f in first] == [f"file-{i}" for i in range(23, 13, -1)]
        cursor_after_first = source.current_sampling_cursor()
        assert cursor_after_first is not None
        assert cursor_after_first["drive_items:drive-1"] == 10

        # Simulate a second run reading the persisted cursor.
        import base64
        import json
        import os

        encoded = base64.b64encode(
            json.dumps(cursor_after_first).encode("utf-8")
        ).decode("utf-8")
        os.environ["CLASSIFYRE_SAMPLING_CURSOR"] = encoded
        try:
            source2 = GoogleWorkspaceSource(recipe)
            second = source2._apply_sampling(items, "drive-1")
        finally:
            del os.environ["CLASSIFYRE_SAMPLING_CURSOR"]

        assert [f.file_id for f in second] == [f"file-{i}" for i in range(13, 3, -1)]
        cursor_after_second = source2.current_sampling_cursor()
        assert cursor_after_second is not None
        assert cursor_after_second["drive_items:drive-1"] == 20

        # A third page underfills (only 4 items remain) and should wrap to 0.
        os.environ["CLASSIFYRE_SAMPLING_CURSOR"] = base64.b64encode(
            json.dumps(cursor_after_second).encode("utf-8")
        ).decode("utf-8")
        try:
            source3 = GoogleWorkspaceSource(recipe)
            third = source3._apply_sampling(items, "drive-1")
        finally:
            del os.environ["CLASSIFYRE_SAMPLING_CURSOR"]

        assert [f.file_id for f in third] == [f"file-{i}" for i in range(3, -1, -1)]
        cursor_after_third = source3.current_sampling_cursor()
        assert cursor_after_third is not None
        assert cursor_after_third["drive_items:drive-1"] == 0


class TestExtensionFiltering:
    def test_include_extensions(self) -> None:
        recipe = _base_recipe(optional={"scope": {"include_file_extensions": [".pdf", ".docx"]}})
        source = GoogleWorkspaceSource(recipe)
        assert source._matches_extension_filters("report.pdf")
        assert source._matches_extension_filters("doc.docx")
        assert not source._matches_extension_filters("image.png")

    def test_exclude_extensions(self) -> None:
        recipe = _base_recipe(optional={"scope": {"exclude_file_extensions": [".mp4", ".mov"]}})
        source = GoogleWorkspaceSource(recipe)
        assert source._matches_extension_filters("report.pdf")
        assert not source._matches_extension_filters("video.mp4")

    def test_no_filters_allows_all(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._matches_extension_filters("anything.xyz")


class TestExportMap:
    def test_document_export_mime(self) -> None:
        export = _EXPORT_MIME_MAP["application/vnd.google-apps.document"]
        assert export[0] == (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    def test_spreadsheet_export_mime(self) -> None:
        export = _EXPORT_MIME_MAP["application/vnd.google-apps.spreadsheet"]
        assert export[0] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def test_presentation_export_mime(self) -> None:
        export = _EXPORT_MIME_MAP["application/vnd.google-apps.presentation"]
        assert export[0] == (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )

    def test_folder_shortcut_form_not_downloadable(self) -> None:
        assert "application/vnd.google-apps.folder" in _NON_DOWNLOADABLE_GOOGLE_TYPES
        assert "application/vnd.google-apps.shortcut" in _NON_DOWNLOADABLE_GOOGLE_TYPES
        assert "application/vnd.google-apps.form" in _NON_DOWNLOADABLE_GOOGLE_TYPES
        assert "application/vnd.google-apps.site" in _NON_DOWNLOADABLE_GOOGLE_TYPES


class TestHashGeneration:
    def test_hash_is_deterministic(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        h1 = source.generate_hash_id("gws_file_#_file-1")
        h2 = source.generate_hash_id("gws_file_#_file-1")
        assert h1 == h2

    def test_different_ids_produce_different_hashes(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        h1 = source.generate_hash_id("gws_file_#_file-1")
        h2 = source.generate_hash_id("gws_file_#_file-2")
        assert h1 != h2


class TestConfigAccessors:
    def test_default_page_size(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._page_size() == 1000

    def test_custom_page_size(self) -> None:
        recipe = _base_recipe(optional={"connection": {"page_size": 500}})
        source = GoogleWorkspaceSource(recipe)
        assert source._page_size() == 500

    def test_max_object_bytes_default(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._max_object_bytes() == 104857600

    def test_include_my_drive_default_true(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._include_my_drive() is True

    def test_include_shared_drives_default_true(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._include_shared_drives() is True

    def test_include_permissions_default_false(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        assert source._include_permissions() is False


class TestAssetMetadataContract:
    def test_file_metadata_validates(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        result = source.metadata_fields(
            "file",
            {
                "drive_name": "Shared Drive",
                "item_path": "/test.pdf",
                "web_url": "https://drive.example.com/test.pdf",
                "md5_checksum": "abc123",
                "owner": "user@example.com",
                "size_bytes": 1024,
                "mime_type": "application/pdf",
            },
        )
        assert result["asset_kind"] == "file"
        assert result["metadata"]["drive_name"] == "Shared Drive"

    def test_drive_metadata_validates(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        result = source.metadata_fields(
            "drive",
            {
                "drive_id": "drive-1",
                "drive_name": "Shared Drive",
                "drive_type": "shared_drive",
            },
        )
        assert result["asset_kind"] == "drive"


class TestPagination:
    def test_list_folder_children_follows_next_page_token(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())

        mock_service = MagicMock()
        page1 = {
            "files": [{"id": "f1", "name": "a.pdf", "mimeType": "application/pdf"}],
            "nextPageToken": "token-2",
        }
        page2 = {
            "files": [{"id": "f2", "name": "b.pdf", "mimeType": "application/pdf"}],
        }
        mock_list = MagicMock()
        mock_list.return_value.execute.side_effect = [page1, page2]
        mock_service.files.return_value.list = mock_list
        source._service = mock_service

        items = source._list_folder_children("folder-1")

        assert [i["id"] for i in items] == ["f1", "f2"]
        assert mock_list.call_count == 2
        second_call_kwargs = mock_list.call_args_list[1].kwargs
        assert second_call_kwargs["pageToken"] == "token-2"


class TestShortcutResolution:
    def test_shortcut_followed_not_emitted(self) -> None:
        source = GoogleWorkspaceSource(_base_recipe())
        mock_service = MagicMock()

        folder_children = {
            "files": [
                {
                    "id": "shortcut-1",
                    "name": "Link to report",
                    "mimeType": "application/vnd.google-apps.shortcut",
                    "shortcutDetails": {"targetId": "target-1"},
                }
            ],
        }
        mock_list = MagicMock()
        mock_list.return_value.execute.side_effect = [folder_children]
        mock_service.files.return_value.list = mock_list

        target_metadata = {
            "id": "target-1",
            "name": "report.pdf",
            "mimeType": "application/pdf",
            "size": "100",
        }
        mock_get = MagicMock()
        mock_get.return_value.execute.side_effect = [target_metadata]
        mock_service.files.return_value.get = mock_get

        source._service = mock_service

        files = source._scan_folder_bfs("folder-1", "/", "drive-1", "Drive", "shared_drive")

        assert len(files) == 1
        assert files[0].file_id == "target-1"
        assert files[0].name == "report.pdf"


class TestEndToEndExtraction:
    @pytest.mark.asyncio
    async def test_extract_raw_end_to_end(self) -> None:
        recipe = _base_recipe(
            optional={"scope": {"include_my_drive": False, "include_shared_drives": True}},
            sampling={"strategy": "ALL"},
        )
        source = GoogleWorkspaceSource(recipe)

        mock_service = MagicMock()

        # drives().list() -> one shared drive
        drives_list_result = {"drives": [{"id": "drive-1", "name": "Team Drive"}]}
        mock_service.drives.return_value.list.return_value.execute.return_value = (
            drives_list_result
        )

        # files().list() -> root has one subfolder + nothing else, subfolder has
        # one binary file and one Google Doc.
        root_children = {
            "files": [
                {
                    "id": "folder-1",
                    "name": "Reports",
                    "mimeType": "application/vnd.google-apps.folder",
                }
            ],
        }
        sub_children = {
            "files": [
                {
                    "id": "bin-file-1",
                    "name": "notes.pdf",
                    "mimeType": "application/pdf",
                    "size": "10",
                    "webViewLink": "https://drive.example.com/bin-file-1",
                    "modifiedTime": "2025-01-02T00:00:00Z",
                    "createdTime": "2025-01-01T00:00:00Z",
                },
                {
                    "id": "gdoc-1",
                    "name": "Design Doc",
                    "mimeType": "application/vnd.google-apps.document",
                    "webViewLink": "https://drive.example.com/gdoc-1",
                    "modifiedTime": "2025-01-03T00:00:00Z",
                    "createdTime": "2025-01-01T00:00:00Z",
                },
            ],
        }
        mock_files_list = MagicMock()
        mock_files_list.return_value.execute.side_effect = [root_children, sub_children]
        mock_service.files.return_value.list = mock_files_list

        # get_media / export_media downloads.
        binary_bytes = b"%PDF-1.4 fake pdf bytes"
        exported_bytes = b"PK fake docx bytes"

        def fake_get_media(**_kwargs: str) -> MagicMock:
            request = MagicMock()
            request.execute.return_value = binary_bytes
            return request

        def fake_export_media(**_kwargs: str) -> MagicMock:
            request = MagicMock()
            request.execute.return_value = exported_bytes
            return request

        mock_service.files.return_value.get_media.side_effect = fake_get_media
        mock_service.files.return_value.export_media.side_effect = fake_export_media

        source._service = mock_service

        def fake_download(request: MagicMock) -> bytes:
            return bytes(request.execute())

        source._download_media = fake_download  # type: ignore[method-assign]

        assets = []
        async for batch in source.extract_raw():
            assets.extend(batch)

        drive_assets = [a for a in assets if a.asset_kind == "drive"]
        file_assets = [a for a in assets if a.asset_kind == "file"]

        assert len(drive_assets) == 1
        drive_hash = drive_assets[0].hash
        assert len(file_assets) == 2

        for file_asset in file_assets:
            assert file_asset.links == [drive_hash]

        names = {a.name for a in file_assets}
        assert names == {"notes.pdf", "Design Doc"}

        binary_asset = next(a for a in file_assets if a.name == "notes.pdf")
        gdoc_asset = next(a for a in file_assets if a.name == "Design Doc")

        binary_content = await source.fetch_content_bytes(binary_asset.hash)
        assert binary_content is not None
        assert binary_content[0] == binary_bytes

        gdoc_content = await source.fetch_content_bytes(gdoc_asset.hash)
        assert gdoc_content is not None
        assert gdoc_content[0] == exported_bytes
        assert gdoc_content[1] == (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
