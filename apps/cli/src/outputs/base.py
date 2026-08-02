from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel

OutputType = Literal["rest", "file", "console"]

# How long to wait for the API to answer a write-back. Generous enough that a
# bulk ingest of a large batch finishes well inside it — the old 30 s cut those
# off mid-flight and made urllib3 re-upload the same body — but finite, so a
# wedged API fails the run instead of hanging it forever.
DEFAULT_REST_TIMEOUT_SEC = 300


@dataclass(frozen=True)
class OutputRuntimeContext:
    source_id: str | None
    runner_id: str | None
    managed_runner: bool
    batch_size: int


@dataclass(frozen=True)
class OutputSettings:
    output_type: OutputType
    batch_size: int
    source_id: str | None
    runner_id: str | None
    managed_runner: bool
    rest_url: str | None = None
    # Read timeout in seconds; None disables it. See resolve_output_settings.
    rest_timeout_sec: int | None = DEFAULT_REST_TIMEOUT_SEC
    file_path: str | None = None


class BatchEnvelope(BaseModel):
    event: Literal["batch"] = "batch"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    batch_index: int
    asset_count: int
    assets: list[dict[str, Any]]


class FinishEnvelope(BaseModel):
    event: Literal["finish"] = "finish"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    batch_count: int
    total_assets: int


class ErrorEnvelope(BaseModel):
    event: Literal["error"] = "error"
    output_type: OutputType
    source_id: str | None = None
    runner_id: str | None = None
    error: str


class OutputSink(Protocol):
    batch_size: int

    async def start(self) -> None: ...

    async def emit_batch(
        self, assets: list[dict[str, Any]], *, skip_findings: bool = False
    ) -> None: ...

    async def finish(self) -> None: ...

    async def fail(self, error: Exception) -> None: ...
