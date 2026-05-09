"""Feature-extraction detector — produces dense vector embeddings via HuggingFace transformers."""

import logging
from types import ModuleType
from typing import Any

from ...models.generated_detectors import (
    DetectorConfig,
    FeatureExtractionDetectorConfig,
    Severity,
)
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module

logger = logging.getLogger(__name__)


class FeatureExtractionDetector(BaseDetector):
    """
    Generates dense vector embeddings from text using the HuggingFace transformers
    ``feature-extraction`` pipeline.

    Each detected asset produces one finding whose ``metadata["embedding"]`` contains
    the pooled, optionally L2-normalised float vector.  Downstream consumers can index
    these vectors in a vector database for semantic search, RAG, clustering, and
    anomaly detection.

    Supported pooling strategies:
    - ``mean`` (default) — average of all token hidden states (best for most tasks)
    - ``cls`` — first [CLS] token representation
    - ``max`` — element-wise maximum across token axis
    - ``none`` — return all per-token vectors as a nested list
    """

    detector_type = "feature_extraction"
    detector_name = "feature_extraction"

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self.pipeline: Any | None = None
        self._transformers: ModuleType | None = None

        self._cfg: FeatureExtractionDetectorConfig = (
            config
            if isinstance(config, FeatureExtractionDetectorConfig)
            else FeatureExtractionDetectorConfig()
        )
        self._model_id: str | None = self._cfg.model
        self._model_revision: str | None = self._cfg.model_revision
        self._device: str = self._cfg.device or "cpu"
        self._pooling: str = self._cfg.pooling_strategy or "mean"
        self._normalize: bool = (
            self._cfg.normalize_embeddings if self._cfg.normalize_embeddings is not None else True
        )
        self._truncation: bool = self._cfg.truncation if self._cfg.truncation is not None else True
        self._max_length: int | None = self._cfg.max_length

        if self._model_id is None:
            raise MissingDependencyError(
                "feature_extraction",
                ["content", "detectors"],
                "FeatureExtractionDetector requires 'model' to be set in config",
            )

        ensure_torch("feature_extraction", ["content", "detectors"])
        self._transformers = require_module(
            "transformers", "feature_extraction", ["content", "detectors"]
        )

        tokenizer_kwargs: dict[str, Any] = {"truncation": self._truncation}
        if self._max_length is not None:
            tokenizer_kwargs["max_length"] = self._max_length

        pipeline_kwargs: dict[str, Any] = {
            "model": self._model_id,
            "device": self._device,
            "tokenizer_kwargs": tokenizer_kwargs,
        }
        if self._model_revision:
            pipeline_kwargs["revision"] = self._model_revision

        self.pipeline = self._transformers.pipeline("feature-extraction", **pipeline_kwargs)
        logger.debug(
            "Initialized feature-extraction pipeline: model=%s device=%s pooling=%s normalize=%s",
            self._model_id,
            self._device,
            self._pooling,
            self._normalize,
        )

    def _pool(self, hidden: list[list[float]]) -> list[float] | list[list[float]]:
        """Apply pooling strategy to per-token hidden states."""
        import numpy as np

        arr = np.array(hidden, dtype=np.float32)  # shape: (tokens, hidden_dim)

        if self._pooling == "cls":
            vector = arr[0]
        elif self._pooling == "max":
            vector = arr.max(axis=0)
        elif self._pooling == "none":
            return arr.tolist()  # type: ignore[no-any-return]
        else:  # mean (default)
            vector = arr.mean(axis=0)

        if self._normalize:
            norm = float(np.linalg.norm(vector))
            if norm > 0:
                vector = vector / norm

        return vector.tolist()  # type: ignore[no-any-return]

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        if isinstance(content, bytes):
            return []
        if content_type not in self.get_supported_content_types():
            return []
        if not content or not content.strip():
            return []

        try:
            raw: list[list[list[float]]] = self.pipeline(content, truncation=True) or []

            # pipeline returns [batch, tokens, hidden_dim]; we always pass one text
            if not raw or not raw[0]:
                return []

            hidden: list[list[float]] = raw[0]
            embedding = self._pool(hidden)

            dim: int | None
            if self._pooling == "none":
                dim = len(embedding[0]) if embedding and isinstance(embedding[0], list) else None  # type: ignore[arg-type]
            else:
                dim = len(embedding)  # type: ignore[arg-type]

            finding = DetectionResult(
                detector_type=DetectorType.FEATURE_EXTRACTION,
                finding_type="embedding",
                category="CLASSIFICATION",
                severity=Severity.info,
                confidence=1.0,
                matched_content=content[:256],
                location=None,
                metadata={
                    "embedding": embedding,
                    "dimension": dim,
                    "pooling_strategy": self._pooling,
                    "normalized": self._normalize,
                    "model": self._model_id,
                },
            )

            if self._cfg.max_findings and self._cfg.max_findings < 1:
                return []
            return [finding]

        except Exception as exc:
            logger.error("feature_extraction error: %s", exc, exc_info=True)
            return []

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
        ]

    def requires_gpu(self) -> bool:
        return False
