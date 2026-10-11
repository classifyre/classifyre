"""Extracted text chunks sent to the API for asynchronous semantic indexing.

Since the API can embed pictures and sound as well, an artifact also carries
the media prepared from the asset (see ``media_artifact``). The name is kept:
it is still one asset's contribution to the semantic index.
"""

from __future__ import annotations

import base64
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
    media: list[dict[str, Any]] = field(default_factory=list)

    def add_media(self, modality: str, mime_type: str, data: bytes) -> None:
        """Attach one prepared picture or clip, numbered from 1 per modality."""
        position = sum(1 for item in self.media if item["modality"] == modality) + 1
        self.media.append(
            {
                "modality": modality,
                "mimeType": mime_type,
                "page": position,
                "data": base64.b64encode(data).decode("ascii"),
            }
        )

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
