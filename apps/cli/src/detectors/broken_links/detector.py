"""Broken links detector for URL reachability and empty responses."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from dataclasses import dataclass

import requests

from ...models.generated_detectors import BrokenLinksDetectorConfig, DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType
from ...utils.hashing import normalize_http_url
from ..base import BaseDetector

logger = logging.getLogger(__name__)


@dataclass
class LinkScanResult:
    url: str
    line: int
    start: int
    end: int
    finding_type: str
    confidence: float
    metadata: dict[str, object]


class BrokenLinksDetector(BaseDetector):
    """
    Detector for broken links and empty link targets.

    Input content is expected to be newline-delimited URLs
    (one URL per line), passed with `application/x.asset-links`.
    """

    detector_type = "broken_links"
    detector_name = "broken_links"

    _REQUEST_TIMEOUT_SECONDS = 8
    _MAX_CONCURRENCY = 12
    _USER_AGENT = "classifyre-broken-links-detector/1.0"

    def __init__(
        self,
        config: DetectorConfig | BrokenLinksDetectorConfig | None = None,
    ) -> None:
        # BrokenLinks config is intentionally minimal; keep base defaults.
        if isinstance(config, DetectorConfig):
            super().__init__(config)
        else:
            super().__init__(DetectorConfig())
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": self._USER_AGENT})

    async def detect(
        self, content: str, content_type: str = "application/x.asset-links"
    ) -> list[DetectionResult]:
        if content_type not in self.get_supported_content_types():
            return []

        links = self._extract_links(content)
        if not links:
            return []

        semaphore = asyncio.Semaphore(self._MAX_CONCURRENCY)

        async def check_link(url: str, line: int, start: int, end: int) -> LinkScanResult | None:
            async with semaphore:
                return await asyncio.to_thread(
                    self._scan_link,
                    url,
                    line,
                    start,
                    end,
                )

        tasks = [
            check_link(url=url, line=line, start=start, end=end) for url, line, start, end in links
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        findings: list[DetectionResult] = []
        for result in results:
            if isinstance(result, Exception):
                logger.debug("Broken links detector task failed: %s", result)
                continue
            if result is None:
                continue

            findings.append(
                DetectionResult(
                    detector_type=DetectorType.BROKEN_LINKS,
                    finding_type=result.finding_type,
                    category="link_integrity",
                    severity=Severity.low,
                    confidence=result.confidence,
                    matched_content=result.url,
                    location=None,
                    metadata=result.metadata,
                )
            )

        max_findings = getattr(self.config, "max_findings", None)
        if isinstance(max_findings, int) and max_findings > 0:
            findings = findings[:max_findings]

        return findings

    def get_supported_content_types(self) -> list[str]:
        return ["application/x.asset-links"]

    def _extract_links(self, content: str) -> list[tuple[str, int, int, int]]:
        links: list[tuple[str, int, int, int]] = []
        seen: set[str] = set()
        offset = 0
        for line_number, raw_line in enumerate(content.splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                offset += len(raw_line) + 1
                continue

            normalized = normalize_http_url(line)
            if not normalized:
                offset += len(raw_line) + 1
                continue

            if normalized in seen:
                offset += len(raw_line) + 1
                continue

            seen.add(normalized)
            stripped_index = raw_line.find(line)
            start = offset + (stripped_index if stripped_index >= 0 else 0)
            end = start + len(line)
            links.append((normalized, line_number, start, end))
            offset += len(raw_line) + 1

        return links

    def _scan_link(
        self,
        url: str,
        line: int,
        start: int,
        end: int,
    ) -> LinkScanResult | None:
        head_response: requests.Response | None = None
        try:
            head_response = self._session.head(
                url,
                allow_redirects=True,
                timeout=self._REQUEST_TIMEOUT_SECONDS,
            )
            status_code = head_response.status_code

            if status_code in {405, 501}:
                return self._scan_with_get(url, line, start, end, "head_not_supported")

            if status_code >= 400:
                return LinkScanResult(
                    url=url,
                    line=line,
                    start=start,
                    end=end,
                    finding_type="unreachable",
                    confidence=0.95,
                    metadata={"status_code": status_code, "reason": "http_error"},
                )

            content_length = self._parse_content_length(head_response.headers)
            if content_length == 0:
                return LinkScanResult(
                    url=url,
                    line=line,
                    start=start,
                    end=end,
                    finding_type="empty_content",
                    confidence=0.9,
                    metadata={"status_code": status_code, "reason": "empty_head_content_length"},
                )

            # Some servers omit Content-Length, so perform a lightweight GET check.
            if content_length is None:
                return self._scan_with_get(url, line, start, end, "missing_content_length")

            return None
        except requests.RequestException as exc:
            return LinkScanResult(
                url=url,
                line=line,
                start=start,
                end=end,
                finding_type="unreachable",
                confidence=0.95,
                metadata={"reason": "request_exception", "error": str(exc)},
            )
        finally:
            if head_response is not None:
                head_response.close()

    def _scan_with_get(
        self,
        url: str,
        line: int,
        start: int,
        end: int,
        reason: str,
    ) -> LinkScanResult | None:
        get_response: requests.Response | None = None
        try:
            get_response = self._session.get(
                url,
                allow_redirects=True,
                timeout=self._REQUEST_TIMEOUT_SECONDS,
                stream=True,
            )
            status_code = get_response.status_code
            if status_code >= 400:
                return LinkScanResult(
                    url=url,
                    line=line,
                    start=start,
                    end=end,
                    finding_type="unreachable",
                    confidence=0.95,
                    metadata={"status_code": status_code, "reason": reason},
                )

            content_length = self._parse_content_length(get_response.headers)
            if content_length == 0:
                return LinkScanResult(
                    url=url,
                    line=line,
                    start=start,
                    end=end,
                    finding_type="empty_content",
                    confidence=0.9,
                    metadata={"status_code": status_code, "reason": reason},
                )

            has_payload = self._response_has_payload(get_response.iter_content(chunk_size=1))
            if not has_payload:
                return LinkScanResult(
                    url=url,
                    line=line,
                    start=start,
                    end=end,
                    finding_type="empty_content",
                    confidence=0.9,
                    metadata={"status_code": status_code, "reason": "empty_body"},
                )
            return None
        except requests.RequestException as exc:
            return LinkScanResult(
                url=url,
                line=line,
                start=start,
                end=end,
                finding_type="unreachable",
                confidence=0.95,
                metadata={"reason": reason, "error": str(exc)},
            )
        finally:
            if get_response is not None:
                get_response.close()

    def _parse_content_length(self, headers: dict[str, object]) -> int | None:
        raw_length = headers.get("Content-Length")
        if raw_length is None:
            return None
        try:
            return int(str(raw_length))
        except (TypeError, ValueError):
            return None

    def _response_has_payload(self, chunks: Iterable[bytes]) -> bool:
        for chunk in chunks:
            if chunk:
                return True
        return False
