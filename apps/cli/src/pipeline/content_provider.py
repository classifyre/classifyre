"""Protocol for content access — decouples the pipeline from source internals."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Protocol, runtime_checkable

from ..models.generated_single_asset_scan_results import DetectionResult, SingleAssetScanResults


@runtime_checkable
class ContentProvider(Protocol):
    """Minimal contract the pipeline needs to fetch content and enrich findings."""

    async def fetch_text_pages(self, asset_id: str) -> AsyncGenerator[str, None]: ...

    async def fetch_bytes(self, asset_id: str) -> tuple[bytes, str] | None: ...

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None: ...

    def resolve_link_for_detection(self, link: str) -> str | None: ...
