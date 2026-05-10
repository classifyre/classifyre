"""Feature extraction (dense embeddings) pipeline runner."""

from __future__ import annotations

import logging
from typing import Any

from ....models.generated_detectors import FeatureExtractionPipelineSchema, Severity
from ....models.generated_single_asset_scan_results import DetectionResult
from ...dependencies import ensure_torch, require_module
from ._base import _TEXT_CONTENT_TYPES, BaseRunner

logger = logging.getLogger(__name__)


def _chunk_text_with_offsets(
    text: str, chunk_size: int | None, chunk_overlap: int
) -> list[tuple[str, int]]:
    """Return (chunk, char_offset) pairs. Returns [(text, 0)] when chunk_size is not set."""
    if not chunk_size:
        return [(text, 0)]
    step = max(1, chunk_size - chunk_overlap)
    return [(text[i : i + chunk_size], i) for i in range(0, len(text), step)]


def _pool_hidden(
    hidden: list[list[float]], pooling: str, normalize: bool
) -> list[float] | list[list[float]] | None:
    """Apply pooling strategy to per-token hidden states."""
    try:
        import numpy as np  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("numpy is required for feature extraction pooling")
        return None
    arr = np.array(hidden, dtype=np.float32)
    if pooling == "cls":
        vector = arr[0]
    elif pooling == "max":
        vector = arr.max(axis=0)
    elif pooling == "none":
        return arr.tolist()  # type: ignore[no-any-return]
    else:
        vector = arr.mean(axis=0)
    if normalize:
        norm = float(np.linalg.norm(vector))
        if norm > 0:
            vector = vector / norm
    return vector.tolist()  # type: ignore[no-any-return]


class FeatureExtractionRunner(BaseRunner):
    """Dense vector embeddings via a single HuggingFace feature-extraction pipeline."""

    def __init__(
        self,
        schema: FeatureExtractionPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        ensure_torch("feature_extraction", ["custom", "detectors"])
        transformers = require_module("transformers", "feature_extraction", ["custom", "detectors"])
        truncation = schema.truncation if schema.truncation is not None else True
        tokenizer_kwargs: dict[str, Any] = {"truncation": truncation}
        if schema.max_length is not None:
            tokenizer_kwargs["max_length"] = schema.max_length
        pipeline_kwargs: dict[str, Any] = {
            "model": schema.model,
            "device": schema.device or "cpu",
            "tokenizer_kwargs": tokenizer_kwargs,
        }
        if schema.model_revision:
            pipeline_kwargs["revision"] = schema.model_revision
        self._pipe: Any = transformers.pipeline("feature-extraction", **pipeline_kwargs)

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("FeatureExtractionRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return []
        if content_type not in _TEXT_CONTENT_TYPES:
            return []
        text = content.strip()
        if not text:
            return []

        schema = self._schema
        pooling = str(schema.pooling_strategy or "mean")
        normalize = schema.normalize_embeddings if schema.normalize_embeddings is not None else True
        chunk_size: int | None = getattr(schema.chunk_size, "root", schema.chunk_size)
        chunk_overlap: int = getattr(schema.chunk_overlap, "root", schema.chunk_overlap) or 0

        results: list[DetectionResult] = []
        try:
            for chunk, offset in _chunk_text_with_offsets(text, chunk_size, chunk_overlap):
                raw: list[list[list[float]]] = self._pipe(chunk) or []
                if not raw or not raw[0]:
                    continue
                embedding = _pool_hidden(raw[0], pooling, normalize)
                if embedding is None:
                    continue
                dim: int | None
                if pooling == "none":
                    dim = (
                        len(embedding[0]) if embedding and isinstance(embedding[0], list) else None
                    )  # type: ignore[index]
                else:
                    dim = len(embedding)  # type: ignore[arg-type]
                results.append(
                    self._make_result(
                        finding_type="embedding",
                        category="CLASSIFICATION",
                        severity=Severity.info,
                        confidence=1.0,
                        matched_content=chunk[:256],
                        location=None,
                        metadata={
                            "embedding": embedding,
                            "dimension": dim,
                            "pooling_strategy": pooling,
                            "normalized": normalize,
                            "model": schema.model,
                            "chunk_offset": offset,
                            "chunk_length": len(chunk),
                        },
                    )
                )
        except Exception as exc:
            logger.error(
                "feature_extraction error (model=%s): %s", schema.model, exc, exc_info=True
            )
        return results

    def get_supported_content_types(self) -> list[str]:
        return list(_TEXT_CONTENT_TYPES)
