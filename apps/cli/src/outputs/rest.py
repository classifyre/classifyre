from __future__ import annotations

import logging
from typing import Any, Literal, cast
from urllib.parse import urljoin

import requests  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field

from .base import OutputRuntimeContext, OutputType

logger = logging.getLogger(__name__)


def _drop_none_recursive(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _drop_none_recursive(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_drop_none_recursive(item) for item in value if item is not None]
    return value


class BulkIngestAssetsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    runner_id: str = Field(serialization_alias="runnerId")
    assets: list[dict[str, Any]]
    finalize_run: bool = Field(False, serialization_alias="finalizeRun")


class FinalizeIngestRunRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    runner_id: str = Field(serialization_alias="runnerId")
    seen_hashes: list[str] = Field(serialization_alias="seenHashes")


class UpdateRunnerStatusRequest(BaseModel):
    status: Literal["COMPLETED", "ERROR"]


class ExternalRunnerResponse(BaseModel):
    id: str
    source_id: str = Field(validation_alias="sourceId")


class RestOutputSink:
    output_type: OutputType = "rest"

    def __init__(
        self,
        context: OutputRuntimeContext,
        *,
        base_url: str,
        timeout_sec: int,
    ):
        self.context = context
        self.batch_size = context.batch_size
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.session = requests.Session()
        self._runner_id = context.runner_id
        self._seen_hashes: set[str] = set()

    async def start(self) -> None:
        if not self.context.source_id:
            raise ValueError("REST output requires source_id")

        if self._runner_id:
            return

        if self.context.managed_runner:
            raise ValueError("managed_runner mode requires runner_id")

        payload = self._request_json(
            "POST",
            f"/sources/{self.context.source_id}/runners/external",
        )
        response = ExternalRunnerResponse.model_validate(payload)
        self._runner_id = response.id
        logger.info("Created external runner %s for source %s", response.id, response.source_id)

    # Keep each bulk request well under Fastify's 50 MB bodyLimit
    _MAX_BATCH_BYTES = 20 * 1024 * 1024  # 20 MB

    async def emit_batch(self, assets: list[dict[str, Any]]) -> None:
        if not assets:
            return

        source_id = self._require_source_id()
        runner_id = self._require_runner_id()

        for asset in assets:
            hash_value = asset.get("hash")
            if hash_value is not None:
                self._seen_hashes.add(str(hash_value))

        for chunk in self._split_by_size(assets):
            cleaned_chunk = cast(list[dict[str, Any]], _drop_none_recursive(chunk))
            payload = BulkIngestAssetsRequest(
                runner_id=runner_id,
                assets=cleaned_chunk,
                finalize_run=False,
            )
            self._request_json(
                "POST",
                f"/sources/{source_id}/assets/bulk",
                payload.model_dump(mode="json", by_alias=True),
            )

    def _split_by_size(self, assets: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        """Split assets into chunks that each stay under _MAX_BATCH_BYTES."""
        import json as _json

        chunks: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        current_bytes = 0

        for asset in assets:
            asset_bytes = len(_json.dumps(asset, ensure_ascii=False).encode())
            if current and current_bytes + asset_bytes > self._MAX_BATCH_BYTES:
                chunks.append(current)
                current = []
                current_bytes = 0
            current.append(asset)
            current_bytes += asset_bytes

        if current:
            chunks.append(current)

        return chunks

    async def finish(self) -> None:
        source_id = self._require_source_id()
        runner_id = self._require_runner_id()

        payload = FinalizeIngestRunRequest(
            runner_id=runner_id,
            seen_hashes=sorted(self._seen_hashes),
        )
        self._request_json(
            "POST",
            f"/sources/{source_id}/assets/finalize",
            payload.model_dump(mode="json", by_alias=True),
        )

        status_payload = UpdateRunnerStatusRequest(status="COMPLETED")
        self._request_json(
            "PATCH",
            f"/runners/{runner_id}/status",
            status_payload.model_dump(mode="json"),
        )

    async def fail(self, error: Exception) -> None:
        if not self._runner_id:
            return

        try:
            payload = UpdateRunnerStatusRequest(status="ERROR")
            self._request_json(
                "PATCH",
                f"/runners/{self._runner_id}/status",
                payload.model_dump(mode="json"),
            )
        except Exception as update_error:
            logger.warning(
                "Failed to update runner status to ERROR after failure %s: %s",
                error,
                update_error,
            )

    def _require_source_id(self) -> str:
        source_id = self.context.source_id
        if not source_id:
            raise ValueError("source_id is required for REST output")
        return source_id

    def _require_runner_id(self) -> str:
        if not self._runner_id:
            raise ValueError("runner_id is required for REST output")
        return self._runner_id

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        response = self.session.request(
            method=method,
            url=url,
            json=payload,
            timeout=self.timeout_sec,
        )

        if response.status_code >= 400:
            body_preview = response.text.strip()[:400]
            raise RuntimeError(
                f"REST output request failed ({method} {url}): "
                f"{response.status_code} {response.reason} {body_preview}"
            )

        if not response.text.strip():
            return {}

        try:
            parsed = response.json()
        except ValueError:
            return {}

        if not isinstance(parsed, dict):
            raise RuntimeError(f"Expected JSON object response from {method} {url}")

        return cast(dict[str, Any], parsed)
