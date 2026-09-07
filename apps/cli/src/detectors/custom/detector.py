"""Custom detector — delegates to the appropriate runner via the runner factory."""

from __future__ import annotations

import asyncio
import logging

from ...models.generated_detectors import (
    CustomDetectorConfig,
    DetectorConfig,
)
from ...models.generated_single_asset_scan_results import DetectionResult
from ..base import BaseDetector
from .runners import BaseRunner, create_runner

logger = logging.getLogger(__name__)


class CustomDetector(BaseDetector):
    """Schema-driven detector backed by a pluggable runner.

    GLINER2 | REGEX | LLM | transformer run over content. TAG does not: it
    produces findings only from tags a CUSTOM connector attached to an asset,
    which the pipeline applies through ``runner.tag_finding``.
    """

    detector_type = "custom"
    detector_name = "custom"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        if not isinstance(self.config, CustomDetectorConfig):
            raise ValueError("CustomDetector requires CustomDetectorConfig with pipeline_schema")
        self.custom_config: CustomDetectorConfig = self.config
        self._runner: BaseRunner = create_runner(
            self.custom_config.pipeline_schema,
            detector_key=self.custom_config.custom_detector_key,
            detector_name=self.custom_config.name,
        )

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        return await asyncio.to_thread(self._detect_sync, content, content_type)

    def _detect_sync(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        findings = self._runner.detect(content, content_type)
        max_findings = self.custom_config.max_findings
        if isinstance(max_findings, int) and max_findings > 0:
            findings = findings[:max_findings]
        return findings

    @property
    def runner(self) -> BaseRunner:
        """The pipeline strategy behind this detector.

        Public because the tag pass has to ask what kind of runner this is: a
        TAG detector never reaches ``detect()``, so recognising it is the only
        way its findings get produced at all.
        """
        return self._runner

    def get_supported_content_types(self) -> list[str]:
        return self._runner.get_supported_content_types()
