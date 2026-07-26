from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from ...models.generated_input import DropboxInput, DropboxRequiredOAuth
from ...models.generated_single_asset_scan_results import SingleAssetScanResults
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)

# Dropbox Paper docs (and a few other cloud-native items) carry no downloadable
# bytes. They are exported instead; markdown keeps the text intact for detectors.
_EXPORT_MIME_TYPES = {
    "markdown": "text/markdown",
    "html": "text/html",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
_PREFERRED_EXPORT_FORMATS = ("markdown", "html")


@dataclass(frozen=True)
class DropboxObjectRef(ObjectRef):
    """An ObjectRef carrying the Dropbox identity fields.

    ``key`` is the display path (used for naming, extension filters and MIME
    inference); ``file_id`` is the immutable Dropbox ID that survives moves and
    renames, and is what the asset hash is derived from.
    """

    file_id: str = ""
    rev: str | None = None
    is_downloadable: bool = True
    export_format: str | None = None
    preview_url: str | None = None


class DropboxSource(ObjectStorageSourceBase):
    """Scan files stored in a Dropbox account.

    Asset identity is anchored to the Dropbox file ID rather than the path, so
    moving or renaming a file keeps its assets, findings and history intact.
    """

    source_type = "dropbox"
    provider_label = "DROPBOX"
    input_model = DropboxInput

    DEFAULT_MAX_ENTRIES_PER_PAGE = 500

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        # Populated while listing so _external_url() (which only receives the
        # path) can resolve the stable file ID for that path.
        self._ref_by_key: dict[str, DropboxObjectRef] = {}
        self._exported_as_by_key: dict[str, str] = {}

    # ── configuration ────────────────────────────────────────────────────

    def _folder_path(self) -> str:
        """Dropbox root is the empty string; sub-folders are '/Foo/Bar'."""
        value = self._scope_option("folder_path", "")
        path = str(value or "").strip().rstrip("/")
        if not path:
            return ""
        return path if path.startswith("/") else f"/{path}"

    def _recursive(self) -> bool:
        value = self._scope_option("recursive", True)
        return bool(value) if isinstance(value, bool) else True

    def _include_mounted_folders(self) -> bool:
        value = self._scope_option("include_mounted_folders", True)
        return bool(value) if isinstance(value, bool) else True

    def _export_non_downloadable(self) -> bool:
        value = self._scope_option("export_non_downloadable", True)
        return bool(value) if isinstance(value, bool) else True

    def _max_keys_per_page(self) -> int:
        value = self._connection_option("max_entries_per_page", self.DEFAULT_MAX_ENTRIES_PER_PAGE)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return self.DEFAULT_MAX_ENTRIES_PER_PAGE
        return min(max(parsed, 1), 2000)

    def _max_retries(self) -> int:
        value = self._connection_option("max_retries", 4)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 4
        return min(max(parsed, 0), 10)

    # ── client ───────────────────────────────────────────────────────────

    def _build_client(self) -> Any:
        dropbox_module = require_module(
            module_name="dropbox",
            source_name="Dropbox",
            uv_groups=["dropbox"],
            detail="Dropbox scanning requires the official Dropbox SDK.",
        )

        common: dict[str, Any] = {
            "timeout": self._request_timeout_seconds(),
            "max_retries_on_error": self._max_retries(),
            "max_retries_on_rate_limit": self._max_retries(),
            "user_agent": "classifyre",
        }

        required = self.config.required
        if isinstance(required, DropboxRequiredOAuth):
            app_key = str(required.app_key or "").strip()
            app_secret = self._masked_value("app_secret")
            refresh_token = self._masked_value("refresh_token")
            if not app_key or not app_secret or not refresh_token:
                raise ValueError(
                    "Dropbox OAuth authentication requires required.app_key, "
                    "masked.app_secret and masked.refresh_token"
                )
            return dropbox_module.Dropbox(
                oauth2_refresh_token=refresh_token,
                app_key=app_key,
                app_secret=app_secret,
                **common,
            )

        access_token = self._masked_value("access_token")
        if not access_token:
            raise ValueError("Dropbox access token authentication requires masked.access_token")
        return dropbox_module.Dropbox(oauth2_access_token=access_token, **common)

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    # ── listing ──────────────────────────────────────────────────────────

    def _list_objects(self) -> Iterator[ObjectRef]:
        client = self._client()
        folder_path = self._folder_path()

        result = client.files_list_folder(
            path=folder_path,
            recursive=self._recursive(),
            limit=self._max_keys_per_page(),
            include_mounted_folders=self._include_mounted_folders(),
            include_non_downloadable_files=self._export_non_downloadable(),
        )

        while True:
            for entry in result.entries or []:
                ref = self._entry_to_ref(entry)
                if ref is not None:
                    self._ref_by_key[ref.key] = ref
                    yield ref

            if not getattr(result, "has_more", False):
                break
            result = client.files_list_folder_continue(result.cursor)

    def _entry_to_ref(self, entry: Any) -> DropboxObjectRef | None:
        """Convert a Dropbox list entry into a ref, or None when it is not a
        scannable file (folders, deletions, filtered-out extensions)."""
        file_id = str(getattr(entry, "id", "") or "")
        # Folder and deleted entries have no id/size/rev triple.
        if not file_id or not hasattr(entry, "rev"):
            return None

        key = str(getattr(entry, "path_display", None) or getattr(entry, "name", "") or "")
        if not key:
            return None

        size = int(getattr(entry, "size", 0) or 0)
        is_downloadable = bool(getattr(entry, "is_downloadable", True))
        export_format = self._export_format(entry) if not is_downloadable else None

        if not is_downloadable and export_format is None:
            logger.debug("Skipping non-downloadable Dropbox item without export option: %s", key)
            return None
        # Exportable items report size 0; they still carry text worth scanning.
        if size == 0 and is_downloadable and not self._include_empty_objects():
            return None
        if not self._object_matches_extension_filters(key):
            return None

        return DropboxObjectRef(
            key=key,
            size=size,
            last_modified=self._parse_datetime(getattr(entry, "server_modified", None)),
            etag=str(getattr(entry, "content_hash", "") or "") or None,
            file_id=file_id,
            rev=str(getattr(entry, "rev", "") or "") or None,
            is_downloadable=is_downloadable,
            export_format=export_format,
            preview_url=str(getattr(entry, "preview_url", "") or "") or None,
        )

    def _export_format(self, entry: Any) -> str | None:
        if not self._export_non_downloadable():
            return None
        export_info = getattr(entry, "export_info", None)
        options = [str(option) for option in (getattr(export_info, "export_options", None) or [])]
        for preferred in _PREFERRED_EXPORT_FORMATS:
            if preferred in options:
                return preferred
        export_as = getattr(export_info, "export_as", None)
        if export_as:
            return str(export_as)
        return options[0] if options else "markdown"

    # ── download ─────────────────────────────────────────────────────────

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        client = self._client()
        max_bytes = self._max_object_bytes()
        dropbox_ref = ref if isinstance(ref, DropboxObjectRef) else None
        # Download by ID so a file moved mid-scan still resolves.
        path = dropbox_ref.file_id if dropbox_ref and dropbox_ref.file_id else ref.key

        if dropbox_ref is not None and not dropbox_ref.is_downloadable:
            export_format = dropbox_ref.export_format or "markdown"
            _export_result, response = client.files_export(path, export_format)
            content_type = _EXPORT_MIME_TYPES.get(export_format, "text/plain")
            self._exported_as_by_key[ref.key] = content_type
        else:
            _metadata, response = client.files_download(path)
            content_type = (response.headers or {}).get("Content-Type") if response else None

        file_bytes = self._read_capped(response, max_bytes)
        if len(file_bytes) > max_bytes:
            file_bytes = file_bytes[:max_bytes]
            logger.warning(
                "Truncated dropbox:%s to %d of %d bytes for content extraction",
                ref.key,
                max_bytes,
                ref.size,
            )
        return file_bytes, content_type

    @staticmethod
    def _read_capped(response: Any, max_bytes: int) -> bytes:
        """Read at most ``max_bytes`` + 1 bytes so oversized files never land in
        memory whole, then close the streamed response."""
        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    break
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    logger.debug("Failed to close Dropbox response body")
        return b"".join(chunks)

    # ── asset shape ──────────────────────────────────────────────────────

    def _external_url(self, key: str) -> str:
        """Identity URL for a file.

        Anchored to the immutable Dropbox file ID so renames and moves keep the
        same asset. Falls back to the path only when the ID is unknown (a ref
        that never came through ``_list_objects``).
        """
        ref = self._ref_by_key.get(key)
        if ref is not None and ref.file_id:
            return f"dropbox://files/{ref.file_id}"
        return f"dropbox://path/{quote(key.lstrip('/'), safe='/')}"

    def _extra_asset_metadata(self, ref: ObjectRef) -> dict[str, Any]:
        dropbox_ref = ref if isinstance(ref, DropboxObjectRef) else self._ref_by_key.get(ref.key)
        metadata: dict[str, Any] = {}
        if dropbox_ref is not None:
            if dropbox_ref.file_id:
                metadata["file_id"] = dropbox_ref.file_id
            if dropbox_ref.rev:
                metadata["rev"] = dropbox_ref.rev
            if dropbox_ref.preview_url:
                metadata["web_url"] = dropbox_ref.preview_url
        exported_as = self._exported_as_by_key.get(ref.key)
        if exported_as:
            metadata["exported_as"] = exported_as
        return metadata

    # ── lifecycle ────────────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            client = self._client()
            account = client.users_get_current_account()
            display_name = getattr(getattr(account, "name", None), "display_name", "") or ""
            folder_path = self._folder_path() or "/"
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Connected to Dropbox as {display_name or 'the authenticated account'}. "
                f"Scanning {folder_path}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Dropbox: {exc}"
        return result

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        self._ref_by_key = {}
        self._exported_as_by_key = {}
        async for batch in super().extract_raw():
            yield batch
