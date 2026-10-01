"""Runner for the ``CODE_DETECTOR`` pipeline type: a code detector.

Like ``TAG`` it never runs over a page of text: ``detect()`` returns nothing and
no content type is advertised, so the text, binary and link passes never
schedule it and the worker pool never receives it. The detector pipeline
recognises it by this class and calls it once per asset, after every other
detector, through the :class:`CustomDetectorSession` it owns.

The session is created lazily on first use and bound to the scan's source,
because it needs the source to serve payload and holds child processes that
must not exist in the worker pool's processes.
"""

from __future__ import annotations

from typing import Any

from ....models.generated_detectors import CodeDetectorPipelineSchema, PipelineResult
from ....models.generated_single_asset_scan_results import DetectionResult
from ._base import BaseRunner


class CustomDetectorRunner(BaseRunner):
    """Asset-scoped runner: judged per asset by a notebook, never per page."""

    asset_scoped = True

    def __init__(
        self,
        schema: CodeDetectorPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self.schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        self._session: Any = None

    def run(self, text: str) -> PipelineResult:
        return PipelineResult(metadata={"runner": "CODE_DETECTOR"})

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        """Never called per page. The pipeline calls ``session().detect(asset)``."""
        return []

    def get_supported_content_types(self) -> list[str]:
        return []

    @property
    def deterministic(self) -> bool:
        return self.schema.deterministic is not False

    @property
    def needs_findings(self) -> bool:
        return bool(self.schema.needs_findings)

    def session(self, source: Any) -> Any:
        """The run's session, created on first use."""
        if self._session is None:
            from ...custom_detector.session import CustomDetectorSession

            self._session = CustomDetectorSession(
                key=self._detector_key,
                name=self._detector_name,
                schema=self.schema,
                source=source,
            )
        return self._session

    def close(self) -> None:
        if self._session is not None:
            self._session.close()
