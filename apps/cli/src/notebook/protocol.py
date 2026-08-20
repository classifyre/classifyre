"""The request/response contract between the API and one notebook process.

One JSON object in, one JSON object out, then the process exits. Nothing is
streamed and nothing is stateful, so the same shape works for a local subprocess
and for a Kubernetes Job whose only channel back is its pod log.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

#: Marks the result line in a stream that also carries ordinary logging. Pod
#: logs interleave everything, so the reader needs a way to find the answer
#: without guessing which line was JSON.
RESULT_PREFIX = "__CLASSIFYRE_NOTEBOOK_RESULT__"


class ExecutionMode(StrEnum):
    #: Rebuild state from the preceding cells, then capture only the target.
    CELL = "cell"
    #: Run every cell and capture every cell's output.
    ALL = "all"
    #: Rebuild state, then call the notebook's test_connection().
    TEST_CONNECTION = "test_connection"
    #: Rebuild state, then pull a bounded sample from extract().
    PREVIEW_EXTRACT = "preview_extract"
    #: Parse and contract-check only. Runs no cells, so it is cheap enough for
    #: the editor to call on a debounce while someone is typing.
    VALIDATE = "validate"


class ExecutionStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"


#: Modes that call one of the contract functions, and so require the notebook to
#: actually define it. `cell` and `all` deliberately do not: an author must be
#: able to run a cell while the notebook is still half-written.
CONTRACT_MODES = frozenset({ExecutionMode.TEST_CONNECTION, ExecutionMode.PREVIEW_EXTRACT})

DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
DEFAULT_PREVIEW_ASSETS = 10


@dataclass
class ExecutionRequest:
    recipe: dict[str, Any]
    mode: ExecutionMode = ExecutionMode.ALL
    target_cell_id: str | None = None
    execution_id: str | None = None
    revision: int | None = None
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    max_assets: int = DEFAULT_PREVIEW_ASSETS

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ExecutionRequest:
        recipe = raw.get("recipe")
        if not isinstance(recipe, dict):
            raise ValueError("Notebook request is missing a 'recipe' object")

        mode_value = str(raw.get("mode") or ExecutionMode.ALL)
        try:
            mode = ExecutionMode(mode_value)
        except ValueError as exc:
            valid = ", ".join(member.value for member in ExecutionMode)
            raise ValueError(
                f"Unknown notebook mode {mode_value!r}. Expected one of: {valid}"
            ) from exc

        if (
            mode is ExecutionMode.CELL
            and not raw.get("targetCellId")
            and not raw.get("target_cell_id")
        ):
            raise ValueError("mode 'cell' requires 'targetCellId'")

        return cls(
            recipe=recipe,
            mode=mode,
            target_cell_id=raw.get("targetCellId") or raw.get("target_cell_id"),
            execution_id=raw.get("executionId") or raw.get("execution_id"),
            revision=raw.get("revision"),
            max_output_bytes=int(
                raw.get("maxOutputBytes") or raw.get("max_output_bytes") or DEFAULT_MAX_OUTPUT_BYTES
            ),
            max_assets=int(raw.get("maxAssets") or raw.get("max_assets") or DEFAULT_PREVIEW_ASSETS),
        )


@dataclass
class CellResult:
    cell_id: str
    status: ExecutionStatus = ExecutionStatus.SUCCESS
    duration_ms: int = 0
    outputs: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cellId": self.cell_id,
            "status": self.status.value,
            "durationMs": self.duration_ms,
            "outputs": self.outputs,
        }


@dataclass
class ExecutionError:
    type: str
    message: str
    traceback: list[str] = field(default_factory=list)
    cell_id: str | None = None
    line: int | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": self.type,
            "message": self.message,
            "traceback": self.traceback,
        }
        if self.cell_id is not None:
            payload["cellId"] = self.cell_id
        if self.line is not None:
            payload["line"] = self.line
        return payload


@dataclass
class ExecutionResponse:
    """What one execution produced.

    ``cells`` is per-cell rather than one flat output list because Run All needs
    to place each output under the cell that produced it; a single-target run is
    just the one-entry case.
    """

    status: ExecutionStatus
    mode: ExecutionMode
    execution_id: str | None = None
    revision: int | None = None
    target_cell_id: str | None = None
    failed_cell_id: str | None = None
    duration_ms: int = 0
    cells: list[CellResult] = field(default_factory=list)
    error: ExecutionError | None = None
    #: test_connection mode: the notebook's verdict.
    result: dict[str, Any] | None = None
    #: preview_extract mode: a bounded sample of what extract() yielded.
    assets: list[dict[str, Any]] = field(default_factory=list)
    #: Contract violations, when the mode required functions the notebook lacks.
    contract: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status.value,
            "mode": self.mode.value,
            "durationMs": self.duration_ms,
            "cells": [cell.to_dict() for cell in self.cells],
        }
        if self.execution_id is not None:
            payload["executionId"] = self.execution_id
        if self.revision is not None:
            payload["notebookRevision"] = self.revision
        if self.target_cell_id is not None:
            payload["targetCellId"] = self.target_cell_id
        if self.failed_cell_id is not None:
            payload["failedCellId"] = self.failed_cell_id
        if self.error is not None:
            payload["error"] = self.error.to_dict()
        if self.result is not None:
            payload["result"] = self.result
        if self.assets:
            payload["assets"] = self.assets
        if self.contract is not None:
            payload["contract"] = self.contract
        return payload

    @classmethod
    def failure(
        cls,
        mode: ExecutionMode,
        error: ExecutionError,
        **kwargs: Any,
    ) -> ExecutionResponse:
        return cls(status=ExecutionStatus.ERROR, mode=mode, error=error, **kwargs)


def as_dict(value: Any) -> dict[str, Any]:
    return asdict(value) if hasattr(value, "__dataclass_fields__") else dict(value)
