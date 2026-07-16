"""Intrinsic, content-addressed text embeddings shared by ingestion and queries."""

from __future__ import annotations

import hashlib
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Any

MODEL_NAME = os.environ.get(
    "CLASSIFYRE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)
MODEL_REVISION = os.environ.get(
    "CLASSIFYRE_EMBEDDING_REVISION", "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
)
MODEL_DIM = 384
_WHITESPACE = re.compile(r"\s+")


def normalize_embedding_text(*parts: str | None) -> str:
    return _WHITESPACE.sub(" ", " ".join(part for part in parts if part)).strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize_embedding_text(text).encode("utf-8")).hexdigest()


def chunk_text_with_offsets(
    text: str, *, max_chars: int = 1200, overlap_chars: int = 200
) -> list[tuple[str, int, int]]:
    """Produce deterministic, overlapping chunks without splitting words when possible."""
    normalized = normalize_embedding_text(text)
    if not normalized:
        return []
    chunks: list[tuple[str, int, int]] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        if end < len(normalized):
            boundary = normalized.rfind(" ", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        value = normalized[start:end].strip()
        if value:
            actual_start = normalized.find(value, start, end + 1)
            chunks.append((value, actual_start, len(value)))
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap_chars)
    return chunks


@dataclass
class EmbeddingArtifact:
    chunks: list[dict[str, Any]] = field(default_factory=list)
    contents: dict[str, str] = field(default_factory=dict)

    def add_page(self, text: str, page: int) -> None:
        for value, offset, length in chunk_text_with_offsets(text):
            digest = content_hash(value)
            self.contents.setdefault(digest, value)
            self.chunks.append(
                {
                    "ordinal": len(self.chunks),
                    "page": page,
                    "charOffset": offset,
                    "charLength": length,
                    "text": value,
                    "contentHash": digest,
                }
            )

    def add_finding(self, finding: Any) -> None:
        value = normalize_embedding_text(
            getattr(finding, "context_before", None),
            getattr(finding, "matched_content", None),
            getattr(finding, "context_after", None),
        )
        if value:
            self.contents.setdefault(content_hash(value), value)


class LocalEmbedder:
    """Lazy model holder. The same class is used by scans and the query server."""

    def __init__(self) -> None:
        self._model: Any | None = None
        self._load_error: Exception | None = None
        self._lock = threading.RLock()

    def _ensure_model(self) -> Any:
        with self._lock:
            if self._model is not None:
                return self._model
            if self._load_error is not None:
                raise RuntimeError("Embedding model failed to load") from self._load_error
            try:
                from sentence_transformers import SentenceTransformer

                # CPU inference is deterministic across desktop/server hosts and
                # avoids concurrent MPS initialization crashes on Apple Silicon.
                self._model = SentenceTransformer(
                    MODEL_NAME, revision=MODEL_REVISION, device="cpu"
                )
                return self._model
            except Exception as exc:
                self._load_error = exc
                raise

    def encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        with self._lock:
            vectors = self._ensure_model().encode(
                texts,
                batch_size=32,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        return [[float(value) for value in vector] for vector in vectors]


local_embedder = LocalEmbedder()
