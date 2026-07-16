"""Extracted text chunks sent to the API for asynchronous semantic indexing."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_WHITESPACE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


def chunk_text_with_offsets(
    text: str, *, max_chars: int = 1200, overlap_chars: int = 200
) -> list[tuple[str, int, int]]:
    normalized = normalize_text(text)
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
class TextArtifact:
    chunks: list[dict[str, Any]] = field(default_factory=list)

    def add_page(self, text: str, page: int) -> None:
        for value, offset, length in chunk_text_with_offsets(text):
            self.chunks.append(
                {
                    "ordinal": len(self.chunks),
                    "page": page,
                    "charOffset": offset,
                    "charLength": length,
                    "text": value,
                }
            )
