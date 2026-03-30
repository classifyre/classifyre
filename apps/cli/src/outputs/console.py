from __future__ import annotations

import json
from typing import Any

from .base import (
    BatchEnvelope,
    ErrorEnvelope,
    FinishEnvelope,
    OutputRuntimeContext,
    OutputType,
)


class ConsoleOutputSink:
    output_type: OutputType = "console"

    def __init__(self, context: OutputRuntimeContext):
        self.context = context
        self.batch_size = context.batch_size
        self._batch_count = 0
        self._total_assets = 0

    async def start(self) -> None:
        return None

    async def emit_batch(self, assets: list[dict[str, Any]]) -> None:
        if not assets:
            return

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
        print(json.dumps(payload.model_dump(mode="json")), flush=True)

    async def finish(self) -> None:
        payload = FinishEnvelope(
            output_type=self.output_type,
            source_id=self.context.source_id,
            runner_id=self.context.runner_id,
            batch_count=self._batch_count,
            total_assets=self._total_assets,
        )
        print(json.dumps(payload.model_dump(mode="json")), flush=True)

    async def fail(self, error: Exception) -> None:
        payload = ErrorEnvelope(
            output_type=self.output_type,
            source_id=self.context.source_id,
            runner_id=self.context.runner_id,
            error=str(error),
        )
        print(json.dumps(payload.model_dump(mode="json")), flush=True)
