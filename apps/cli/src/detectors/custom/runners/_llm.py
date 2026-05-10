"""LLM pipeline runner (stub — not yet implemented)."""

from __future__ import annotations

from ....models.generated_detectors import LLMPipelineSchema, PipelineResult
from ._base import BaseRunner


class LLMRunner(BaseRunner):
    """LLM-based detection — not yet implemented."""

    def __init__(
        self, schema: LLMPipelineSchema, detector_key: str = "", detector_name: str = ""
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name

    def run(self, text: str) -> PipelineResult:  # pragma: no cover - stub
        raise NotImplementedError(
            f"LLM runner is not yet implemented (detector '{self._detector_key}')"
        )
