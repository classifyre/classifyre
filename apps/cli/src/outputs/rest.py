from __future__ import annotations

import logging
import random
from typing import Any, Literal, cast
from urllib.parse import urljoin

import requests  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry  # type: ignore[import-untyped]

from .base import OutputRuntimeContext, OutputType

logger = logging.getLogger(__name__)


class _JitteredRetry(Retry):
    """urllib3 Retry subclass that adds ±25 % multiplicative jitter to the
    computed backoff so that multiple concurrent CLI jobs do not all retry
    at exactly the same moment (thundering-herd mitigation).

    The jitter is applied *after* the standard exponential backoff formula
    and the backoff_max cap, so it never pushes the delay above
    backoff_max * 1.25.
    """

    _JITTER_FACTOR: float = 0.25

    def get_backoff_time(self) -> float:  # type: ignore[override]
        base = super().get_backoff_time()
        if base == 0:
            return 0.0
        lo = base * (1 - self._JITTER_FACTOR)
        hi = base * (1 + self._JITTER_FACTOR)
        return random.uniform(lo, hi)


# Retry policy for CLI → API REST calls.
#
# What we retry and why:
#   connect=8  — pod restarted / not yet ready (RemoteDisconnected, ConnectionReset,
#                ConnectTimeout). Request never reached the application.
#   read=8     — API is under load and slow to respond (ReadTimeout). Safe to retry
#                because all endpoints are idempotent (bulk ingest is upsert-based,
#                status/findings updates are set-operations).
#   status=8   — transient HTTP errors from an overloaded or restarting API:
#                  408 Request Timeout   - API-level timeout
#                  429 Too Many Requests - rate-limited / backpressure
#                  502 Bad Gateway       - proxy has no upstream yet
#                  503 Service Unavail.  - under-pressure / pod not ready
#                  504 Gateway Timeout   - upstream took too long
#
# backoff_factor=2, backoff_max=60: exponential cap at 60 s, with ±25 % jitter
# (see _JitteredRetry). Approximate wait schedule between attempts:
#   attempt 1 → immediate (0 s)
#   attempt 2 → ~2 s
#   attempt 3 → ~4 s
#   attempt 4 → ~8 s
#   attempt 5 → ~16 s
#   attempt 6 → ~32 s
#   attempt 7 → ~60 s  (capped)
#   attempt 8 → ~60 s  (capped)
# Total extra wait: ~182 s (~3 min) — covers extended load spikes on a
# single-node VPS before event-loop pressure drops. Worst-case a single
# call costs 8 * 120 s + 182 s = ~18 min, acceptable for long-running scans.
#
# POST and PATCH are explicitly allowed: without this urllib3 only retries
# idempotent methods (GET/HEAD) by default.
_RETRY_POLICY = _JitteredRetry(
    total=8,
    connect=8,
    read=8,
    status=8,
    backoff_factor=2,
    backoff_max=60,
    status_forcelist={408, 429, 502, 503, 504},
    allowed_methods={"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
    raise_on_status=False,
)


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
    skip_findings: bool = Field(False, serialization_alias="skipFindings")


class IngestEdge(BaseModel):
    """A source-derived relationship edge for the investigation graph.

    Identify endpoints by UUID (from_id / to_id) or by asset hash
    (from_hash / to_hash — the API resolves hashes to UUIDs).
    """

    model_config = ConfigDict(populate_by_name=True)

    from_type: str = Field(serialization_alias="fromType")
    from_id: str | None = Field(None, serialization_alias="fromId")
    from_hash: str | None = Field(None, serialization_alias="fromHash")
    to_type: str = Field(serialization_alias="toType")
    to_id: str | None = Field(None, serialization_alias="toId")
    to_hash: str | None = Field(None, serialization_alias="toHash")
    relation_type: str = Field(serialization_alias="relationType")
    confidence: float = 1.0


class BulkIngestEdgesRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    edges: list[IngestEdge]


class FinalizeIngestRunRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    runner_id: str = Field(serialization_alias="runnerId")
    seen_hashes: list[str] = Field(serialization_alias="seenHashes")
    # AUTOMATIC sampling cursor to persist on the source for the next run.
    # Omitted (None) for other strategies so the stored cursor is left untouched.
    sampling_cursor: dict[str, Any] | None = Field(
        None, serialization_alias="samplingCursor"
    )


class UpdateRunnerStatusRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["COMPLETED", "ERROR"]
    error_message: str | None = Field(None, serialization_alias="errorMessage")


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
        # Disable keep-alive so stale pooled connections are never reused after
        # a pod restart or server-side keep-alive timeout.  Each request opens
        # a fresh TCP connection, which is cheap enough for our batch cadence.
        self.session.headers.update({"Connection": "close"})
        adapter = HTTPAdapter(max_retries=_RETRY_POLICY)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self._runner_id = context.runner_id
        self._seen_hashes: set[str] = set()
        self._sampling_cursor: dict[str, Any] | None = None

    def set_sampling_cursor(self, cursor: dict[str, Any] | None) -> None:
        """Record the AUTOMATIC sampling cursor to persist on finalize."""
        self._sampling_cursor = cursor

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

    async def emit_batch(
        self, assets: list[dict[str, Any]], *, skip_findings: bool = False
    ) -> None:
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
                skip_findings=skip_findings,
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
            sampling_cursor=self._sampling_cursor,
        )
        self._request_json(
            "POST",
            f"/sources/{source_id}/assets/finalize",
            payload.model_dump(mode="json", by_alias=True, exclude_none=True),
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

        error_message = f"{type(error).__name__}: {error}"
        try:
            payload = UpdateRunnerStatusRequest(status="ERROR", error_message=error_message)
            self._request_json(
                "PATCH",
                f"/runners/{self._runner_id}/status",
                payload.model_dump(mode="json", by_alias=True, exclude_none=True),
            )
        except Exception as update_error:
            logger.warning(
                "Failed to update runner status to ERROR after failure %s: %s",
                error,
                update_error,
            )

    async def emit_edges(self, edges: list[IngestEdge]) -> None:
        """Bulk-upsert source-derived relationship edges to the investigation graph.

        Idempotent — safe to call multiple times with overlapping data.
        Silently skips if the list is empty.
        """
        if not edges:
            return

        _edge_batch = 500
        for i in range(0, len(edges), _edge_batch):
            chunk = edges[i : i + _edge_batch]
            payload = BulkIngestEdgesRequest(edges=chunk)
            try:
                self._request_json(
                    "POST",
                    "/graph/edges",
                    payload.model_dump(mode="json", by_alias=True),
                )
                logger.debug("Emitted %d source-derived edges to graph", len(chunk))
            except Exception as exc:
                # Edge emission is best-effort: log and continue.
                logger.warning("Failed to emit edges to graph: %s", exc)

    async def register_discovered_assets(self, hashes: list[str]) -> None:
        runner_id = self._require_runner_id()
        for i in range(0, len(hashes), 500):
            chunk = hashes[i : i + 500]
            self._request_json(
                "POST",
                f"/runners/{runner_id}/assets/discover",
                {"assetHashes": chunk},
            )

    async def update_asset_status(
        self,
        asset_hash: str,
        status: str,
        error_message: str | None = None,
        findings_total: int | None = None,
        findings_by_severity: dict[str, int] | None = None,
        findings_by_detector: dict[str, dict[str, int]] | None = None,
    ) -> None:
        runner_id = self._require_runner_id()
        item: dict[str, Any] = {"assetHash": asset_hash, "status": status}
        if error_message is not None:
            item["errorMessage"] = error_message[:2000]
        if findings_total is not None:
            item["findingsTotal"] = findings_total
        if findings_by_severity is not None:
            item["findingsBySeverity"] = findings_by_severity
        if findings_by_detector is not None:
            item["findingsByDetector"] = findings_by_detector
        self._request_json(
            "PATCH",
            f"/runners/{runner_id}/assets/status",
            {"assets": [item]},
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
