from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TextIO

from .base import (
    BatchEnvelope,
    ErrorEnvelope,
    FinishEnvelope,
    OutputRuntimeContext,
    OutputType,
)


class FileOutputSink:
    output_type: OutputType = "file"

    def __init__(self, context: OutputRuntimeContext, file_path: str):
        self.context = context
        self.batch_size = context.batch_size
        self.file_path = Path(file_path)
        self._batch_count = 0
        self._total_assets = 0
        self._handle: TextIO | None = None

    async def start(self) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.file_path.open("a", encoding="utf-8")

    async def emit_batch(self, assets: list[dict[str, Any]]) -> None:
        if not assets:
            return
        handle = self._require_handle()
        self._batch_count += 1
        self._total_assets += len(assets)
        payload = BatchEnvelope(
            output_type=self.output_type,
            source_id=self.context.source_id,
            runner_id=self.context.runner_id,
            batch_index=self._batch_count,
            asset_count=len(assets),
            assets=assets,
        )
        handle.write(json.dumps(payload.model_dump(mode="json")))
        handle.write("\n")
        handle.flush()

    async def finish(self) -> None:
        handle = self._require_handle()
        payload = FinishEnvelope(
            output_type=self.output_type,
            source_id=self.context.source_id,
            runner_id=self.context.runner_id,
            batch_count=self._batch_count,
            total_assets=self._total_assets,
        )
        handle.write(json.dumps(payload.model_dump(mode="json")))
        handle.write("\n")
        handle.flush()
        handle.close()
        self._handle = None

    async def fail(self, error: Exception) -> None:
        handle = self._require_handle()
        payload = ErrorEnvelope(
            output_type=self.output_type,
            source_id=self.context.source_id,
            runner_id=self.context.runner_id,
            error=str(error),
        )
        handle.write(json.dumps(payload.model_dump(mode="json")))
        handle.write("\n")
        handle.flush()
        handle.close()
        self._handle = None

    def _require_handle(self) -> TextIO:
        if self._handle is None:
            raise RuntimeError("File output sink was not started before attempting to emit.")
        return self._handle
