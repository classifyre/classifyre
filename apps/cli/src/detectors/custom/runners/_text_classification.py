"""Text classification pipeline runner."""

from __future__ import annotations

import logging
from typing import Any

from ....models.generated_detectors import Severity, TextClassificationPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult
from ...dependencies import ensure_torch, require_module
from ._base import _TEXT_CONTENT_TYPES, BaseRunner, _resolve_pipeline_severity

logger = logging.getLogger(__name__)


def _chunk_text(text: str, chunk_size: int | None, chunk_overlap: int) -> list[str]:
    """Split text into chunks. Returns [text] when chunk_size is not set."""
    if not chunk_size:
        return [text]
    step = max(1, chunk_size - chunk_overlap)
    return [text[i : i + chunk_size] for i in range(0, len(text), step)]


class TextClassificationRunner(BaseRunner):
    """Text classification via a single HuggingFace text-classification pipeline."""

    def __init__(
        self,
        schema: TextClassificationPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        ensure_torch("text_classification", ["custom", "detectors"])
        transformers = require_module(
            "transformers", "text_classification", ["custom", "detectors"]
        )
        pipeline_kwargs: dict[str, Any] = {
            "model": schema.model,
            "device": schema.device or "cpu",
        }
        if schema.model_revision:
            pipeline_kwargs["revision"] = schema.model_revision
        if schema.top_k is not None:
            pipeline_kwargs["top_k"] = schema.top_k
        if schema.function_to_apply is not None:
            pipeline_kwargs["function_to_apply"] = str(schema.function_to_apply)
        self._pipe: Any = transformers.pipeline("text-classification", **pipeline_kwargs)

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("TextClassificationRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return []
        if content_type not in _TEXT_CONTENT_TYPES:
            return []
        text = content.strip()
        if not text:
            return []

        schema = self._schema
        chunk_size: int | None = getattr(schema.chunk_size, "root", schema.chunk_size)
        chunk_overlap: int = getattr(schema.chunk_overlap, "root", schema.chunk_overlap) or 0
        max_length: int | None = getattr(schema.max_length, "root", schema.max_length)
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.7
        default_severity = schema.severity if schema.severity is not None else Severity.info

        best_scores: dict[str, float] = {}
        try:
            for chunk in _chunk_text(text, chunk_size, chunk_overlap):
                call_kwargs: dict[str, Any] = {"truncation": True}
                if max_length is not None:
                    call_kwargs["max_length"] = max_length
                raw = self._pipe(chunk, **call_kwargs) or []
                preds: list[dict[str, Any]] = raw[0] if raw and isinstance(raw[0], list) else raw
                for pred in preds:
                    label: str = pred.get("label", "unknown")
                    score: float = float(pred.get("score", 0.0))
                    if score > best_scores.get(label, 0.0):
                        best_scores[label] = score
        except Exception as exc:
            logger.error(
                "text_classification error (model=%s): %s", schema.model, exc, exc_info=True
            )

        results: list[DetectionResult] = []
        for label, score in best_scores.items():
            if score < threshold:
                continue
            severity = _resolve_pipeline_severity(label, schema.severity_map, default_severity)
            results.append(
                self._make_result(
                    finding_type=f"classification:{label}",
                    category="CONTENT",
                    severity=severity,
                    confidence=score,
                    matched_content=text[:512],
                    location=None,
                    metadata={"model": schema.model, "predicted_label": label, "score": score},
                )
            )
        results.sort(key=lambda r: r.confidence, reverse=True)
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_TEXT_CONTENT_TYPES)
