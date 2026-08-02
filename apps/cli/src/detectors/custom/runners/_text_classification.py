"""Text classification pipeline runner."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

from ....models.generated_detectors import Severity, TextClassificationPipelineSchema
from ....models.generated_single_asset_scan_results import DetectionResult
from ...dependencies import ensure_torch, require_module
from ._base import _TEXT_CONTENT_TYPES, BaseRunner, _resolve_pipeline_severity

logger = logging.getLogger(__name__)


# A transformer pipeline called with truncation=True silently keeps only the
# first model_max_length tokens, so without chunking a long document is
# classified on its opening paragraph alone -- no error, no log, and everything
# after it is never looked at. When chunk_size is not configured we derive a
# window from the model's own token limit instead.
# Deliberate under-estimate: too small a window only costs compute, too large
# a one hands the tail back to truncation.
_CHARS_PER_TOKEN = 3
_DEFAULT_MODEL_MAX_TOKENS = 512
# model_max_length is a huge sentinel on tokenizers that declare no limit.
_MODEL_MAX_TOKENS_SENTINEL = 100_000
_AUTO_CHUNK_OVERLAP = 128
# Bound per-asset CPU cost; hitting this is logged, never silent.
_MAX_AUTO_CHUNKS = 200


def _chunk_text(text: str, chunk_size: int | None, chunk_overlap: int) -> list[str]:
    """Split text into chunks. Returns [text] when chunk_size is not set."""
    if not chunk_size:
        return [text]
    step = max(1, chunk_size - chunk_overlap)
    return [text[i : i + chunk_size] for i in range(0, len(text), step)]


def _model_chunk_chars(pipe: Any, max_length: int | None) -> int:
    """Characters that comfortably fit one forward pass of *pipe*."""
    tokens = max_length
    if tokens is None:
        tokenizer_limit = getattr(getattr(pipe, "tokenizer", None), "model_max_length", None)
        if isinstance(tokenizer_limit, int) and 0 < tokenizer_limit < _MODEL_MAX_TOKENS_SENTINEL:
            tokens = tokenizer_limit
    if not isinstance(tokens, int) or tokens <= 0:
        tokens = _DEFAULT_MODEL_MAX_TOKENS
    return max(256, tokens * _CHARS_PER_TOKEN)


def _iter_analysis_chunks(
    text: str,
    chunk_size: int | None,
    chunk_overlap: int,
    auto_chunk_chars: int,
) -> Iterator[str]:
    """Yield the windows to classify, one resident at a time.

    An explicit chunk_size wins. Otherwise the text is passed through whole
    unless it would overflow the model window, in which case it is auto-chunked
    so the tail is classified rather than truncated away.
    """
    if chunk_size:
        step = max(1, chunk_size - chunk_overlap)
        for start in range(0, len(text), step):
            yield text[start : start + chunk_size]
        return

    if len(text) <= auto_chunk_chars:
        yield text
        return

    overlap = min(_AUTO_CHUNK_OVERLAP, auto_chunk_chars // 4)
    step = max(1, auto_chunk_chars - overlap)
    for index, start in enumerate(range(0, len(text), step)):
        if index >= _MAX_AUTO_CHUNKS:
            logger.warning(
                "text_classification: text of %d chars exceeds %d auto-chunks of %d; "
                "the remainder was not classified (set chunk_size to control this)",
                len(text),
                _MAX_AUTO_CHUNKS,
                auto_chunk_chars,
            )
            return
        yield text[start : start + auto_chunk_chars]


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
        # Model loading is deferred to first detect() so the parent process
        # (which only routes when a worker pool is active) never pays the
        # torch import + model memory cost.
        self._pipe: Any | None = None
        self._load_error: str | None = None

    def _ensure_pipeline(self) -> Any | None:
        if self._pipe is not None:
            return self._pipe
        if self._load_error is not None:
            return None
        schema = self._schema
        try:
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
            self._pipe = transformers.pipeline("text-classification", **pipeline_kwargs)
            return self._pipe
        except Exception as exc:
            # Raise on the first failure so the scan records one structured
            # error; later assets skip quietly via the cached _load_error.
            self._load_error = str(exc)
            raise RuntimeError(
                f"text_classification model '{schema.model}' failed to load for "
                f"detector '{self._detector_key}': {exc}"
            ) from exc

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
        pipe = self._ensure_pipeline()
        if pipe is None:
            return []

        schema = self._schema
        chunk_size: int | None = getattr(schema.chunk_size, "root", schema.chunk_size)
        chunk_overlap: int = getattr(schema.chunk_overlap, "root", schema.chunk_overlap) or 0
        max_length: int | None = getattr(schema.max_length, "root", schema.max_length)
        threshold = schema.confidence_threshold if schema.confidence_threshold is not None else 0.7
        default_severity = schema.severity if schema.severity is not None else Severity.info

        best_scores: dict[str, float] = {}
        auto_chunk_chars = _model_chunk_chars(pipe, max_length)
        try:
            for chunk in _iter_analysis_chunks(text, chunk_size, chunk_overlap, auto_chunk_chars):
                call_kwargs: dict[str, Any] = {"truncation": True}
                if max_length is not None:
                    call_kwargs["max_length"] = max_length
                raw = pipe(chunk, **call_kwargs) or []
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
