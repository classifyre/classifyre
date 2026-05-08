"""Custom detector — delegates to the appropriate runner via the runner factory."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ...models.generated_detectors import (
    CustomDetectorConfig,
    DetectorConfig,
    PipelineResult,
    Severity,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
)
from ..base import BaseDetector
from .runners import BaseRunner, create_runner

logger = logging.getLogger(__name__)


class CustomDetector(BaseDetector):
    """Schema-driven detector backed by a pluggable runner (GLINER2 | REGEX | LLM)."""

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
        )

    # ── Public API ────────────────────────────────────────────────────────────

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip()
        if not text:
            return []

        result = self._runner.run(text)
        findings = self._result_to_findings(text, result)

        max_findings = self.custom_config.max_findings
        if isinstance(max_findings, int) and max_findings > 0:
            findings = findings[:max_findings]

        return findings

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
            "application/xml",
            "text/xml",
        ]

    # ── Convert pipeline result to DetectionResult findings ───────────────────

    def _make_result(
        self,
        *,
        finding_type: str,
        category: str,
        severity: Severity,
        confidence: float,
        matched_content: str,
        location: Location | None,
        metadata: dict[str, Any],
    ) -> DetectionResult:
        return DetectionResult(
            detector_type=DetectorType.CUSTOM,
            finding_type=finding_type,
            category=category,
            severity=severity,
            confidence=confidence,
            matched_content=matched_content,
            location=location,
            custom_detector_key=self.custom_config.custom_detector_key,
            custom_detector_name=self.custom_config.name,
            detected_at=datetime.now(UTC),
            metadata=metadata,
        )

    def _result_to_findings(self, text: str, result: PipelineResult) -> list[DetectionResult]:
        findings: list[DetectionResult] = []
        runner_type = result.metadata.get("runner", "GLINER2")

        for label, spans in result.entities.items():
            for span in spans:
                confidence = float(span.get("confidence", 0.0))
                value = str(span.get("value", ""))
                start = span.get("start")
                end = span.get("end")

                location: Location | None = None
                if isinstance(start, int) and isinstance(end, int):
                    location = Location(start=start, end=end, path=f"{runner_type.lower()}-entity")

                finding_type = f"regex:{label}" if runner_type == "REGEX" else f"entity:{label}"

                findings.append(
                    self._make_result(
                        finding_type=finding_type,
                        category="CLASSIFICATION",
                        severity=Severity.medium if confidence < 0.9 else Severity.high,
                        confidence=min(0.99, confidence),
                        matched_content=value,
                        location=location,
                        metadata={
                            "runner": runner_type,
                            "entity_label": label,
                            "pipeline_result": result.model_dump(),
                        },
                    )
                )

        for task, outcome in result.classification.items():
            label = str(outcome.get("label", ""))
            confidence = float(outcome.get("confidence", 0.0))
            if not label:
                continue

            findings.append(
                self._make_result(
                    finding_type=f"classification:{task}:{label}",
                    category="CLASSIFICATION",
                    severity=Severity.medium if confidence < 0.9 else Severity.high,
                    confidence=min(0.99, confidence),
                    matched_content=text[:320],
                    location=None,
                    metadata={
                        "runner": runner_type,
                        "task": task,
                        "label": label,
                        "pipeline_result": result.model_dump(),
                    },
                )
            )

        return findings
