from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import requests

from ...models.generated_input import SandboxInput
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
        self._api_url = (
            os.environ.get("CLASSIFYRE_OUTPUT_REST_URL")
            or os.environ.get("API_URL")
            or "http://localhost:8000"
        ).rstrip("/")
        self._session = requests.Session()
        self._file_by_id: dict[str, dict[str, Any]] = {}

    def _scope_option(self, key: str, default: Any = None) -> Any:
        # SANDBOX intentionally has an empty optional config section; uploaded
        # files are always in scope and always include their content.
        return default

    def _connection_option(self, key: str, default: Any = None) -> Any:
        return default

    def _max_object_bytes(self) -> int:
        # Keep the extractor aligned with the API's per-upload limit instead
        # of the object-storage connector family's conservative 5 MiB default.
        return 50 * 1024 * 1024

    def _request(self, method: str, path: str, *, stream: bool = False) -> requests.Response:
        response = self._session.request(
            method,
            f"{self._api_url}{path}",
            timeout=120,
            stream=stream,
            headers={"Connection": "close"},
        )
        response.raise_for_status()
        return response

    def _list_objects(self) -> Iterator[ObjectRef]:
        response = self._request("GET", f"/sources/{self.source_id}/files")
        payload = response.json()
        if not isinstance(payload, list):
            raise ValueError("Source files API returned a non-array response")

        self._file_by_id = {}
        for item in payload:
            if not isinstance(item, dict) or not item.get("id"):
                continue
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
        response = self._request(
            "GET",
            f"/sources/{self.source_id}/files/{quote(ref.key, safe='')}/content",
            stream=True,
        )
        chunks: list[bytes] = []
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                chunks.append(chunk)
        return b"".join(chunks), response.headers.get("Content-Type")

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
