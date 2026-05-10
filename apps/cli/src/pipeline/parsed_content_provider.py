"""ContentProvider that wraps a BaseSource and applies file_parser for binary→text conversion."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

from ..models.generated_single_asset_scan_results import DetectionResult, SingleAssetScanResults
from ..sources.base import BaseSource
from ..utils.file_parser import iter_file_pages


class ParsedContentProvider:
    """
    Wraps a BaseSource, providing text pages and raw bytes to the pipeline.

    Text path: delegates to ``source.fetch_content_pages()`` first.  If the source
    returns nothing, falls back to ``source.fetch_content_bytes()`` → ``iter_file_pages()``.

    Binary path: delegates directly to ``source.fetch_content_bytes()``.
    """

    def __init__(self, source: BaseSource) -> None:
        self._source = source

    async def fetch_text_pages(self, asset_id: str) -> AsyncGenerator[str, None]:
        saw_text = False
        async for _raw, text in self._source.fetch_content_pages(asset_id):
            if text:
                saw_text = True
                yield text

        if saw_text:
            return

        result = await self._source.fetch_content_bytes(asset_id)
        if result is None:
            return

        raw_bytes, mime = result
        pages: list[str] = await asyncio.to_thread(list, iter_file_pages(raw_bytes, mime))
        for page in pages:
            yield page

    async def fetch_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        return await self._source.fetch_content_bytes(asset_id)

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        self._source.enrich_finding_location(finding, asset, text_content)

    def resolve_link_for_detection(self, link: str) -> str | None:
        return self._source.resolve_link_for_detection(link)
