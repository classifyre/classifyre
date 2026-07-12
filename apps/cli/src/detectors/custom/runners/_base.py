"""Base runner interface and shared utilities for all pipeline execution strategies."""

from __future__ import annotations

import io
import logging
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from ....models.generated_detectors import (
    PipelineResult,
    PipelineSeverityRule,
    Severity,
)
from ....models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
)

_DEFAULT_GLINER2_MODEL = "fastino/gliner2-base-v1"
_DEFAULT_IMAGE_CLASSIFICATION_MODEL = "google/vit-base-patch16-224"

_TEXT_CONTENT_TYPES = [
    "text/plain",
    "text/html",
    "text/markdown",
    "application/json",
    "application/xml",
    "text/xml",
]
_IMAGE_CONTENT_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
]
# Content types HuggingFace image detectors accept. Non-image renderable files
# (PDFs) are rasterised page-by-page via render_to_images before classification,
# mirroring the vision LLM detector's input handling.
_IMAGE_INPUT_CONTENT_TYPES = [*_IMAGE_CONTENT_TYPES, "application/pdf"]

logger = logging.getLogger(__name__)

# Cap per-label entity spans embedded in each finding's metadata. Every finding
# carries a copy of the pipeline result (the API builds extraction rows from it),
# so an uncapped regex with thousands of matches would blow up the scan payload
# quadratically.
_MAX_EMBEDDED_SPANS_PER_LABEL = 25


def _slim_pipeline_result(result: PipelineResult) -> dict[str, Any]:
    """model_dump with entity span lists capped for embedding in finding metadata."""
    dump = result.model_dump()
    entities = dump.get("entities")
    if isinstance(entities, dict):
        for label, spans in entities.items():
            if isinstance(spans, list) and len(spans) > _MAX_EMBEDDED_SPANS_PER_LABEL:
                entities[label] = spans[:_MAX_EMBEDDED_SPANS_PER_LABEL]
                dump.setdefault("metadata", {})[f"truncated_spans:{label}"] = len(spans)
    return dump


def _load_input_images(content: bytes, content_type: str, pil: Any) -> list[tuple[int, Any]]:
    """Return ``(page_index, PIL.Image)`` tuples for an image or renderable file.

    Image MIME types open directly; PDFs (and any type ``render_to_images`` supports)
    are rasterised to one image per page. Unsupported types return ``[]``.
    """
    from ....utils.file_to_images import render_to_images, supported_mime_type

    normalized = content_type.split(";", 1)[0].strip().lower()
    try:
        if normalized.startswith("image/"):
            return [(0, pil.open(io.BytesIO(content)))]
        if supported_mime_type(content_type):
            pages = render_to_images(content, content_type)
            return [(idx, pil.open(io.BytesIO(png))) for idx, png in enumerate(pages)]
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to load input images (%s): %s", normalized, exc)
    return []


def _resolve_pipeline_severity(
    label: str,
    severity_map: list[PipelineSeverityRule] | None,
    default: Severity = Severity.info,
) -> Severity:
    """Return the first severity whose pattern matches label (case-insensitive)."""
    if not severity_map:
        return default
    label_lower = label.lower()
    for rule in severity_map:
        try:
            if re.search(rule.pattern, label_lower, re.IGNORECASE):
                return rule.severity
        except re.error:
            if rule.pattern.lower() in label_lower:
                return rule.severity
    return default


class BaseRunner(ABC):
    """Common interface for all pipeline execution strategies."""

    _detector_key: str = ""
    _detector_name: str = ""

    @abstractmethod
    def run(self, text: str) -> PipelineResult:
        """Execute the pipeline on *text* and return a normalised PipelineResult."""
        ...

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        """Run detection and return findings. Default: text-only path via run()."""
        if isinstance(content, bytes):
            return []
        text = content.strip()
        if not text:
            return []
        result = self.run(text)
        return self._result_to_findings(text, result)

    def get_supported_content_types(self) -> list[str]:
        return list(_TEXT_CONTENT_TYPES)

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
            custom_detector_key=self._detector_key,
            custom_detector_name=self._detector_name,
            detected_at=datetime.now(UTC),
            metadata=metadata,
        )

    def _result_to_findings(self, text: str, result: PipelineResult) -> list[DetectionResult]:
        findings: list[DetectionResult] = []
        runner_type = result.metadata.get("runner", "GLINER2")
        pipeline_result_dump = _slim_pipeline_result(result)

        for label, spans in result.entities.items():
            for span in spans:
                confidence = float(span.get("confidence", 0.0))
                value = str(span.get("value", ""))
                start = span.get("start")
                end = span.get("end")

                loc: Location | None = None
                if isinstance(start, int) and isinstance(end, int):
                    loc = Location(start=start, end=end, path=f"{runner_type.lower()}-entity")

                finding_type = f"regex:{label}" if runner_type == "REGEX" else f"entity:{label}"

                span_severity = span.get("severity")
                if isinstance(span_severity, str) and span_severity in Severity.__members__:
                    sev = Severity(span_severity)
                else:
                    sev = Severity.medium if confidence < 0.9 else Severity.high

                meta: dict[str, Any] = {
                    "runner": runner_type,
                    "entity_label": label,
                    "pipeline_result": pipeline_result_dump,
                }
                if "groups" in span:
                    meta["capture_groups"] = span["groups"]

                findings.append(
                    self._make_result(
                        finding_type=finding_type,
                        category="CLASSIFICATION",
                        severity=sev,
                        confidence=min(0.99, confidence),
                        matched_content=value,
                        location=loc,
                        metadata=meta,
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
                        "pipeline_result": pipeline_result_dump,
                    },
                )
            )

        return findings
