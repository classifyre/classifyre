from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel

OutputType = Literal["rest", "file", "console"]


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
    rest_timeout_sec: int = 30
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

    async def emit_batch(self, assets: list[dict[str, Any]]) -> None: ...

    async def finish(self) -> None: ...

    async def fail(self, error: Exception) -> None: ...
