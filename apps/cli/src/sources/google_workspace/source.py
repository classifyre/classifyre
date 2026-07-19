"""Google Workspace source — scan Google Drive files, Docs, Sheets, and Slides via the Drive API."""

from __future__ import annotations

import json
import logging
import random
from collections import defaultdict
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any

from ...models.generated_input import (
    GoogleWorkspaceInput,
    GoogleWorkspaceMaskedOAuth,
    GoogleWorkspaceMaskedServiceAccount,
    GoogleWorkspaceRequiredOAuth,
    GoogleWorkspaceRequiredServiceAccount,
    SamplingStrategy,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)
from ...utils.file_metadata import extract_file_metadata
from ...utils.file_parser import resolve_mime_type
from ...utils.hashing import hash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

_MY_DRIVE_ID = "my_drive"

_FILES_LIST_FIELDS = (
    "nextPageToken, files(id, name, mimeType, size, owners, parents, "
    "modifiedTime, createdTime, webViewLink, md5Checksum, shortcutDetails)"
)

_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
_SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut"

_NON_DOWNLOADABLE_GOOGLE_TYPES = {
    "application/vnd.google-apps.folder",
    "application/vnd.google-apps.shortcut",
    "application/vnd.google-apps.form",
    "application/vnd.google-apps.site",
}

# Google-native mimeType -> (export mimeType, export file extension)
_EXPORT_MIME_MAP: dict[str, tuple[str, str]] = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
    "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
}

_TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/x-ndjson",
}

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

_FILE_EXTENSION_HINTS: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".svg": OutputAssetType.IMAGE,
    ".bmp": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".mkv": OutputAssetType.VIDEO,
    ".avi": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".wav": OutputAssetType.AUDIO,
    ".aac": OutputAssetType.AUDIO,
    ".ogg": OutputAssetType.AUDIO,
    ".pdf": OutputAssetType.BINARY,
    ".docx": OutputAssetType.BINARY,
    ".xlsx": OutputAssetType.TABLE,
    ".pptx": OutputAssetType.BINARY,
    ".parquet": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".xml": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".md": OutputAssetType.TXT,
    ".html": OutputAssetType.TXT,
    ".htm": OutputAssetType.TXT,
}


def _is_google_native(mime_type: str) -> bool:
    return mime_type.startswith("application/vnd.google-apps.")


@dataclass(frozen=True)
class DriveRef:
    drive_id: str
    display_name: str
    drive_type: str  # "my_drive" | "shared_drive"


@dataclass
class FileRef:
    file_id: str
    name: str
    path: str
    size: int
    mime_type: str
    modified_time: datetime
    created_time: datetime
    web_url: str
    md5_checksum: str | None
    owner: str | None
    drive_id: str
    drive_name: str
    drive_type: str


class GoogleWorkspaceSource(BaseSource):
    source_type = "google_workspace"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = GoogleWorkspaceInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._service: Any = None
        self._credentials: Any = None

        self._seen_hashes: set[str] = set()
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._bytes_cache: dict[str, bytes] = {}
        self._mime_cache: dict[str, str] = {}
        self._hash_to_url: dict[str, str] = {}

        self._validate_auth_configuration()

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, GoogleWorkspaceRequiredServiceAccount):
            if not isinstance(masked, GoogleWorkspaceMaskedServiceAccount):
                raise ValueError("service_account auth requires masked.service_account_json")
        elif isinstance(required, GoogleWorkspaceRequiredOAuth):
            if not isinstance(masked, GoogleWorkspaceMaskedOAuth):
                raise ValueError(
                    "oauth auth requires masked.client_secret and masked.refresh_token"
                )

    # -- Config accessors --

    def _scope(self) -> Any:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        from ...models.generated_input import GoogleWorkspaceOptionalScope

        return GoogleWorkspaceOptionalScope()

    def _connection(self) -> Any:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        from ...models.generated_input import GoogleWorkspaceOptionalConnection

        return GoogleWorkspaceOptionalConnection()

    def _extraction(self) -> Any:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        from ...models.generated_input import GoogleWorkspaceOptionalExtraction

        return GoogleWorkspaceOptionalExtraction()

    def _page_size(self) -> int:
        return int(self._connection().page_size or 1000)

    def _max_object_bytes(self) -> int:
        return int(self._connection().max_object_bytes or 104857600)

    def _max_retries(self) -> int:
        return int(self._connection().max_retries or 5)

    def _timeout_seconds(self) -> int:
        return int(self._connection().timeout_seconds or 30)

    def _include_permissions(self) -> bool:
        return bool(self._scope().include_permissions)

    def _include_my_drive(self) -> bool:
        value = self._scope().include_my_drive
        return True if value is None else bool(value)

    def _include_shared_drives(self) -> bool:
        value = self._scope().include_shared_drives
        return True if value is None else bool(value)

    def _export_google_formats(self) -> bool:
        value = self._extraction().export_google_formats
        return True if value is None else bool(value)

    def _include_drive_metadata(self) -> bool:
        value = self._extraction().include_drive_metadata
        return True if value is None else bool(value)

    # -- Drive client --

    def _build_credentials(self) -> Any:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, GoogleWorkspaceRequiredServiceAccount):
            assert isinstance(masked, GoogleWorkspaceMaskedServiceAccount)
            service_account = require_module(
                "google.oauth2.service_account",
                "Google Workspace",
                ["google-workspace"],
                detail="google-auth is required for Google Workspace service-account authentication.",
            )
            info = json.loads(masked.service_account_json)
            credentials = service_account.Credentials.from_service_account_info(
                info, scopes=_SCOPES
            )
            if required.delegated_subject:
                credentials = credentials.with_subject(required.delegated_subject)
            return credentials

        assert isinstance(required, GoogleWorkspaceRequiredOAuth)
        assert isinstance(masked, GoogleWorkspaceMaskedOAuth)
        oauth_credentials = require_module(
            "google.oauth2.credentials",
            "Google Workspace",
            ["google-workspace"],
            detail="google-auth is required for Google Workspace OAuth authentication.",
        )
        return oauth_credentials.Credentials(
            token=None,
            refresh_token=masked.refresh_token,
            client_id=required.client_id,
            client_secret=masked.client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=_SCOPES,
        )

    def _get_service(self) -> Any:
        if self._service is not None:
            return self._service

        discovery = require_module(
            "googleapiclient.discovery",
            "Google Workspace",
            ["google-workspace"],
            detail="google-api-python-client is required for Google Workspace.",
        )
        self._credentials = self._build_credentials()
        self._service = discovery.build(
            "drive", "v3", credentials=self._credentials, cache_discovery=False
        )
        return self._service

    def _download_media(self, request: Any) -> bytes:
        http_module = require_module(
            "googleapiclient.http",
            "Google Workspace",
            ["google-workspace"],
            detail="google-api-python-client is required for Google Workspace.",
        )
        buffer = BytesIO()
        downloader = http_module.MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _status, done = downloader.next_chunk(num_retries=self._max_retries())
        return buffer.getvalue()

    # -- Discovery --

    def _discover_shared_drives(self) -> list[DriveRef]:
        scope = self._scope()
        drive_ids_filter = scope.drive_ids or []
        service = self._get_service()

        if drive_ids_filter:
            drives: list[DriveRef] = []
            for drive_id in drive_ids_filter:
                if self._aborted:
                    break
                try:
                    data = (
                        service.drives()
                        .get(driveId=drive_id, fields="id,name")
                        .execute(num_retries=self._max_retries())
                    )
                    drives.append(
                        DriveRef(
                            drive_id=data.get("id", drive_id),
                            display_name=data.get("name", drive_id),
                            drive_type="shared_drive",
                        )
                    )
                except Exception as exc:
                    logger.warning("Could not access shared drive %s: %s", drive_id, exc)
            return drives

        drives = []
        page_token: str | None = None
        while True:
            if self._aborted:
                break
            data = (
                service.drives()
                .list(pageSize=100, pageToken=page_token)
                .execute(num_retries=self._max_retries())
            )
            for item in data.get("drives", []):
                drives.append(
                    DriveRef(
                        drive_id=item.get("id", ""),
                        display_name=item.get("name", ""),
                        drive_type="shared_drive",
                    )
                )
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        logger.info("Discovered %d shared drives", len(drives))
        return drives

    def _resolve_shared_drive(self, drive_id: str) -> DriveRef:
        service = self._get_service()
        try:
            data = (
                service.drives()
                .get(driveId=drive_id, fields="id,name")
                .execute(num_retries=self._max_retries())
            )
            return DriveRef(
                drive_id=data.get("id", drive_id),
                display_name=data.get("name", drive_id),
                drive_type="shared_drive",
            )
        except Exception as exc:
            logger.debug("Could not resolve shared drive %s: %s", drive_id, exc)
            return DriveRef(drive_id=drive_id, display_name=drive_id, drive_type="shared_drive")

    def _get_file_metadata(self, file_id: str, fields: str) -> dict[str, Any] | None:
        service = self._get_service()
        try:
            result: dict[str, Any] = (
                service.files()
                .get(fileId=file_id, fields=fields, supportsAllDrives=True)
                .execute(num_retries=self._max_retries())
            )
            return result
        except Exception as exc:
            logger.debug("Could not resolve file metadata for %s: %s", file_id, exc)
            return None

    # -- Folder BFS --

    def _list_folder_children(self, folder_id: str) -> list[dict[str, Any]]:
        service = self._get_service()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            if self._aborted:
                break
            data = (
                service.files()
                .list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    fields=_FILES_LIST_FIELDS,
                    pageSize=self._page_size(),
                    pageToken=page_token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
                .execute(num_retries=self._max_retries())
            )
            items.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return items

    def _build_file_ref(
        self,
        item: dict[str, Any],
        path: str,
        drive_id: str,
        drive_name: str,
        drive_type: str,
    ) -> FileRef:
        owners = item.get("owners") or []
        owner = None
        if owners:
            first_owner = owners[0]
            owner = first_owner.get("displayName") or first_owner.get("emailAddress")

        size_raw = item.get("size")
        size = int(size_raw) if size_raw is not None else 0

        return FileRef(
            file_id=item.get("id", ""),
            name=item.get("name", ""),
            path=path,
            size=size,
            mime_type=item.get("mimeType") or "application/octet-stream",
            modified_time=self._parse_datetime(item.get("modifiedTime")),
            created_time=self._parse_datetime(item.get("createdTime")),
            web_url=item.get("webViewLink", ""),
            md5_checksum=item.get("md5Checksum"),
            owner=owner,
            drive_id=drive_id,
            drive_name=drive_name,
            drive_type=drive_type,
        )

    def _scan_folder_bfs(
        self,
        root_folder_id: str,
        root_path: str,
        drive_id: str,
        drive_name: str,
        drive_type: str,
    ) -> list[FileRef]:
        files: list[FileRef] = []
        seen: set[str] = set()
        queue: list[tuple[str, str]] = [(root_folder_id, root_path)]

        while queue:
            if self._aborted:
                return files
            folder_id, parent_path = queue.pop(0)

            for item in self._list_folder_children(folder_id):
                if self._aborted:
                    return files

                item_id = item.get("id", "")
                if not item_id or item_id in seen:
                    continue

                mime_type = item.get("mimeType", "")
                name = item.get("name", "")
                item_path = f"{parent_path}/{name}".replace("//", "/")

                if mime_type == _SHORTCUT_MIME_TYPE:
                    target_id = item.get("shortcutDetails", {}).get("targetId")
                    if not target_id or target_id in seen:
                        continue
                    target = self._get_file_metadata(
                        target_id,
                        "id, name, mimeType, size, owners, parents, modifiedTime, "
                        "createdTime, webViewLink, md5Checksum",
                    )
                    if not target:
                        continue
                    seen.add(target_id)
                    target_mime = target.get("mimeType", "")
                    if target_mime == _FOLDER_MIME_TYPE:
                        queue.append((target_id, item_path))
                    elif self._matches_extension_filters(target.get("name", "")):
                        files.append(
                            self._build_file_ref(
                                target, item_path, drive_id, drive_name, drive_type
                            )
                        )
                    continue

                seen.add(item_id)

                if mime_type == _FOLDER_MIME_TYPE:
                    queue.append((item_id, item_path))
                    continue

                if not self._matches_extension_filters(name):
                    continue

                files.append(
                    self._build_file_ref(item, item_path, drive_id, drive_name, drive_type)
                )

        return files

    def _iter_drive_root(self, drive_ref: DriveRef) -> list[FileRef]:
        root_id = "root" if drive_ref.drive_type == "my_drive" else drive_ref.drive_id
        return self._scan_folder_bfs(
            root_id, "/", drive_ref.drive_id, drive_ref.display_name, drive_ref.drive_type
        )

    def _matches_extension_filters(self, filename: str) -> bool:
        scope = self._scope()
        ext = PurePosixPath(filename).suffix.lower()

        include = scope.include_file_extensions
        if include:
            normalized_include = [
                e.lower() if e.startswith(".") else f".{e.lower()}" for e in include
            ]
            if ext not in normalized_include:
                return False

        exclude = scope.exclude_file_extensions
        if exclude:
            normalized_exclude = [
                e.lower() if e.startswith(".") else f".{e.lower()}" for e in exclude
            ]
            if ext in normalized_exclude:
                return False

        return True

    # -- Sampling --

    def _apply_sampling(self, items: list[FileRef], drive_id: str) -> list[FileRef]:
        strategy = self.config.sampling.strategy
        limit = int(self.config.sampling.rows_per_page or 100)

        if strategy == SamplingStrategy.ALL:
            return items

        if strategy == SamplingStrategy.AUTOMATIC:
            ordered = sorted(items, key=lambda ref: ref.modified_time, reverse=True)
            return self.automatic_window(ordered, key=f"drive_items:{drive_id}")

        if strategy == SamplingStrategy.RANDOM:
            if limit >= len(items):
                return items
            generator = random.Random(0)
            indexes = sorted(generator.sample(range(len(items)), k=limit))
            return [items[i] for i in indexes]

        ordered = sorted(items, key=lambda ref: ref.modified_time, reverse=True)
        return ordered[:limit]

    # -- Asset construction --

    def _asset_type_from_mime_or_key(self, mime_type: str | None, key: str) -> OutputAssetType:
        normalized_mime = (mime_type or "").split(";", maxsplit=1)[0].strip().lower()
        extension = PurePosixPath(key).suffix.lower()

        if normalized_mime in _TABULAR_MIME_TYPES:
            return OutputAssetType.TABLE
        if normalized_mime.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized_mime.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized_mime.startswith("audio/"):
            return OutputAssetType.AUDIO
        if normalized_mime.startswith("text/") or normalized_mime in _TEXT_MIME_TYPES:
            return OutputAssetType.TXT

        if extension in _FILE_EXTENSION_HINTS:
            return _FILE_EXTENSION_HINTS[extension]

        if normalized_mime and normalized_mime != "application/octet-stream":
            return OutputAssetType.BINARY

        return OutputAssetType.OTHER

    def _fetch_permissions(self, ref: FileRef) -> list[dict[str, str]]:
        service = self._get_service()
        try:
            data = (
                service.permissions()
                .list(
                    fileId=ref.file_id,
                    supportsAllDrives=True,
                    fields="permissions(role,type,emailAddress,domain)",
                )
                .execute(num_retries=self._max_retries())
            )
        except Exception as exc:
            logger.debug("Could not fetch permissions for %s: %s", ref.file_id, exc)
            return []

        permissions = []
        for perm in data.get("permissions", []):
            permissions.append(
                {
                    "role": perm.get("role", ""),
                    "grantee_type": perm.get("type", ""),
                    "grantee": perm.get("emailAddress") or perm.get("domain") or "",
                }
            )
        return permissions

    def _file_to_asset(self, ref: FileRef, drive_hash: str) -> SingleAssetScanResults:
        raw_id = f"gws_file_#_{ref.file_id}"
        asset_hash = self.generate_hash_id(raw_id)
        self._seen_hashes.add(asset_hash)

        file_bytes: bytes | None = None
        parse_error: str | None = None
        mime_type = ref.mime_type or "application/octet-stream"
        google_mime_type: str | None = None
        exported_as: str | None = None

        if _is_google_native(ref.mime_type):
            google_mime_type = ref.mime_type

        if not self._discovery_only:
            try:
                if ref.mime_type in _NON_DOWNLOADABLE_GOOGLE_TYPES:
                    parse_error = f"Not downloadable: {ref.mime_type}"
                elif _is_google_native(ref.mime_type):
                    export = _EXPORT_MIME_MAP.get(ref.mime_type)
                    if not export or not self._export_google_formats():
                        parse_error = "Google-native export skipped"
                    else:
                        export_mime, _ext = export
                        service = self._get_service()
                        request = service.files().export_media(
                            fileId=ref.file_id, mimeType=export_mime
                        )
                        file_bytes = self._download_media(request)
                        mime_type = export_mime
                        exported_as = export_mime
                elif ref.size and ref.size > self._max_object_bytes():
                    parse_error = f"File size {ref.size} exceeds limit {self._max_object_bytes()}"
                else:
                    service = self._get_service()
                    request = service.files().get_media(fileId=ref.file_id)
                    file_bytes = self._download_media(request)
                    mime_type = resolve_mime_type(
                        file_bytes,
                        declared_mime_type=ref.mime_type,
                        file_name=ref.name,
                    )
            except Exception as exc:
                parse_error = f"Download failed: {exc}"
                logger.warning("Failed to download %s: %s", ref.path, exc)

        if file_bytes:
            self._bytes_cache[asset_hash] = file_bytes
            self._mime_cache[asset_hash] = mime_type
            if ref.web_url:
                self._bytes_cache[ref.web_url] = file_bytes

        asset_type = self._asset_type_from_mime_or_key(mime_type, ref.name)

        file_meta = extract_file_metadata(file_bytes or b"", mime_type, file_name=ref.name)
        metadata: dict[str, Any] = {
            "drive_name": ref.drive_name,
            "item_path": ref.path,
        }
        if ref.web_url:
            metadata["web_url"] = ref.web_url
        if ref.md5_checksum:
            metadata["md5_checksum"] = ref.md5_checksum
        if ref.owner:
            metadata["owner"] = ref.owner
        if google_mime_type:
            metadata["google_mime_type"] = google_mime_type
        if exported_as:
            metadata["exported_as"] = exported_as
        if parse_error:
            metadata["parse_error"] = parse_error

        if self._include_permissions():
            permissions = self._fetch_permissions(ref)
            if permissions:
                metadata["permissions"] = permissions

        for key, value in file_meta.items():
            if value is not None and key not in metadata:
                metadata[key] = value

        if ref.web_url:
            self._hash_to_url[asset_hash] = ref.web_url

        checksum_data = {
            "file_id": ref.file_id,
            "size": ref.size,
            "modified_time": ref.modified_time.isoformat(),
            "md5_checksum": ref.md5_checksum or "",
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_data),
            name=ref.name,
            external_url=ref.web_url or f"gws://files/{ref.file_id}",
            links=[drive_hash] if drive_hash else [],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=ref.created_time,
            updated_at=ref.modified_time,
            runner_id=self.runner_id,
            **self.metadata_fields("file", metadata),
        )

    def _drive_to_asset(self, drive_ref: DriveRef) -> SingleAssetScanResults:
        raw_id = f"gws_drive_#_{drive_ref.drive_id}"
        asset_hash = self.generate_hash_id(raw_id)
        self._seen_hashes.add(asset_hash)

        metadata: dict[str, Any] = {
            "drive_id": drive_ref.drive_id,
            "drive_name": drive_ref.display_name,
            "drive_type": drive_ref.drive_type,
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=drive_ref.display_name,
            external_url=f"gws://drives/{drive_ref.drive_id}",
            links=[],
            asset_type=OutputAssetType.OTHER,
            source_id=self.source_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            runner_id=self.runner_id,
            **self.metadata_fields("drive", metadata),
        )

    # -- Main extraction --

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        scope = self._scope()
        batch: list[SingleAssetScanResults] = []
        drive_hash_by_id: dict[str, str] = {}
        known_drives: dict[str, DriveRef] = {}

        def ensure_drive(drive_ref: DriveRef) -> str:
            if drive_ref.drive_id in drive_hash_by_id:
                return drive_hash_by_id[drive_ref.drive_id]
            known_drives[drive_ref.drive_id] = drive_ref
            if self._include_drive_metadata():
                asset = self._drive_to_asset(drive_ref)
                drive_hash_by_id[drive_ref.drive_id] = asset.hash
                batch.append(asset)
            else:
                drive_hash_by_id[drive_ref.drive_id] = self.generate_hash_id(
                    f"gws_drive_#_{drive_ref.drive_id}"
                )
            return drive_hash_by_id[drive_ref.drive_id]

        all_files: list[FileRef] = []

        if scope.folder_ids:
            for folder_id in scope.folder_ids:
                if self._aborted:
                    return
                meta = self._get_file_metadata(folder_id, "id, name, mimeType, driveId")
                if not meta:
                    continue
                drive_id = meta.get("driveId") or _MY_DRIVE_ID
                if drive_id == _MY_DRIVE_ID:
                    drive_ref = DriveRef(
                        drive_id=_MY_DRIVE_ID, display_name="My Drive", drive_type="my_drive"
                    )
                else:
                    drive_ref = known_drives.get(drive_id) or self._resolve_shared_drive(drive_id)
                ensure_drive(drive_ref)
                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

                folder_name = meta.get("name", "")
                files = self._scan_folder_bfs(
                    folder_id,
                    f"/{folder_name}",
                    drive_ref.drive_id,
                    drive_ref.display_name,
                    drive_ref.drive_type,
                )
                all_files.extend(files)
        else:
            drives: list[DriveRef] = []
            if self._include_shared_drives():
                drives.extend(self._discover_shared_drives())
            if self._include_my_drive():
                drives.append(
                    DriveRef(drive_id=_MY_DRIVE_ID, display_name="My Drive", drive_type="my_drive")
                )

            for drive_ref in drives:
                if self._aborted:
                    return
                ensure_drive(drive_ref)
                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

            for drive_ref in drives:
                if self._aborted:
                    return
                files = self._iter_drive_root(drive_ref)
                all_files.extend(files)

        if batch:
            yield batch
            batch = []

        by_drive: dict[str, list[FileRef]] = defaultdict(list)
        for file_ref in all_files:
            by_drive[file_ref.drive_id].append(file_ref)

        for drive_id, files in by_drive.items():
            if self._aborted:
                return

            sampled = self._apply_sampling(files, drive_id)
            drive_hash = drive_hash_by_id.get(drive_id, "")

            logger.info(
                "Processing %d/%d items from drive '%s'",
                len(sampled),
                len(files),
                drive_id,
            )

            for file_ref in sampled:
                if self._aborted:
                    return

                asset = self._file_to_asset(file_ref, drive_hash)
                batch.append(asset)

                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

        if batch:
            yield batch

    # -- Required interface methods --

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id("GOOGLE_WORKSPACE", asset_id)

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": "GOOGLE_WORKSPACE",
        }
        try:
            service = self._get_service()
            required = self.config.required
            uses_identity = isinstance(required, GoogleWorkspaceRequiredOAuth) or (
                isinstance(required, GoogleWorkspaceRequiredServiceAccount)
                and bool(required.delegated_subject)
            )
            if uses_identity:
                data = service.about().get(fields="user").execute(num_retries=self._max_retries())
                user = data.get("user", {})
                result["status"] = "SUCCESS"
                result["message"] = (
                    f"Connected to Google Drive API as {user.get('emailAddress', 'unknown')}"
                )
            else:
                data = service.drives().list(pageSize=1).execute(num_retries=self._max_retries())
                drives = data.get("drives", [])
                result["status"] = "SUCCESS"
                if drives:
                    result["message"] = (
                        f"Connected to Google Drive API. Found shared drive: "
                        f"{drives[0].get('name', 'unknown')}"
                    )
                else:
                    result["message"] = (
                        "Connected to Google Drive API. No shared drives accessible."
                    )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Google Drive API: {exc}"
        return result

    def abort(self) -> None:
        self._aborted = True

    def cleanup(self) -> None:
        self._service = None
        self._credentials = None
        self._bytes_cache.clear()
        self._mime_cache.clear()
        self._content_cache.clear()

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._bytes_cache.pop(asset_hash, None)
        self._mime_cache.pop(asset_hash, None)
        self._content_cache.pop(asset_hash, None)
        url = self._hash_to_url.get(asset_hash)
        if url:
            self._bytes_cache.pop(url, None)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        if asset_id in self._content_cache:
            return self._content_cache[asset_id]

        file_bytes = self._bytes_cache.get(asset_id)
        if not file_bytes:
            return None

        mime = self._mime_cache.get(asset_id, "application/octet-stream")
        parsed = self.parse_asset_bytes(file_bytes, declared_mime_type=mime)
        result = (parsed.raw_content, parsed.text_content)
        self._content_cache[asset_id] = result
        return result

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        file_bytes = self._bytes_cache.get(asset_id)
        if not file_bytes:
            return None
        mime = self._mime_cache.get(asset_id, "application/octet-stream")
        return file_bytes, mime

    # -- Utilities --

    @staticmethod
    def _parse_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)
        if isinstance(value, str) and value.strip():
            normalized = value.strip().replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=UTC)
                return parsed.astimezone(UTC)
            except ValueError:
                pass
        return datetime.now(UTC)
