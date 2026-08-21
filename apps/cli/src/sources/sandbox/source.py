from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import requests

from ...models.generated_input import SandboxInput
from ...utils.source_files import api_base_url, list_source_files, stream_source_file
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)


class SandboxSource(ObjectStorageSourceBase):
    """Uploaded files exposed by the API as a normal ingestion source."""

    source_type = "sandbox"
    provider_label = "SANDBOX"
    input_model = SandboxInput

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        if not source_id:
            raise ValueError("SANDBOX requires a source ID")
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self._api_url = api_base_url()
        self._session = requests.Session()
        self._file_by_id: dict[str, dict[str, Any]] = {}

    def _scope_option(self, key: str, default: Any = None) -> Any:
        # SANDBOX intentionally has an empty optional config section; uploaded
        # files are always in scope and always include their content.
        return default

    def _connection_option(self, key: str, default: Any = None) -> Any:
        return default

    def _max_object_bytes(self) -> int:
        # Spool threshold (RAM before spilling to disk), not a refusal ceiling —
        # uploads are no longer size-capped. Raised above the object-storage
        # family's conservative 5 MiB default because these files are local.
        return 50 * 1024 * 1024

    def _list_objects(self) -> Iterator[ObjectRef]:
        self._file_by_id = {}
        for item in list_source_files(self._session, self._api_url, str(self.source_id)):
            file_id = str(item["id"])
            self._file_by_id[file_id] = item
            created_at = str(item.get("createdAt") or "").replace("Z", "+00:00")
            try:
                modified = datetime.fromisoformat(created_at)
                if modified.tzinfo is None:
                    modified = modified.replace(tzinfo=UTC)
            except ValueError:
                modified = datetime.now(UTC)
            yield ObjectRef(
                key=file_id,
                size=int(item.get("fileSizeBytes") or 0),
                last_modified=modified,
                etag=str(item.get("contentHash") or "") or None,
                content_type_hint=str(item.get("declaredMimeType") or "application/octet-stream"),
            )

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        stream, content_type = stream_source_file(
            self._session, self._api_url, str(self.source_id), ref.key
        )
        return b"".join(chunk for chunk in stream if chunk), content_type

    def _external_url(self, key: str) -> str:
        return f"sandbox://{self.source_id}/{key}"

    def _object_file_name(self, ref: ObjectRef) -> str:
        metadata = self._file_by_id.get(ref.key, {})
        return str(metadata.get("fileName") or ref.key)

    def _file_name_for_asset_id(self, asset_id: str) -> str:
        ref_name = super()._file_name_for_asset_id(asset_id)
        metadata = self._file_by_id.get(ref_name)
        return str(metadata.get("fileName") or ref_name) if metadata else ref_name

    def cleanup(self) -> None:
        self._session.close()
        super().cleanup()
