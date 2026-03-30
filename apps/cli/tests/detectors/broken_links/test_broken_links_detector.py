from __future__ import annotations

from unittest.mock import MagicMock

import pytest
import requests

from src.detectors.broken_links.detector import BrokenLinksDetector
from src.models.generated_single_asset_scan_results import DetectorType


def _mock_response(
    status_code: int,
    *,
    headers: dict[str, str] | None = None,
    chunks: list[bytes] | None = None,
) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.headers = headers or {}
    response.iter_content.return_value = iter(chunks or [b"x"])
    response.close.return_value = None
    return response


@pytest.mark.asyncio
async def test_broken_links_detector_reports_unreachable_and_empty_links() -> None:
    detector = BrokenLinksDetector()

    head_unreachable = _mock_response(404)
    head_empty = _mock_response(200, headers={"Content-Length": "0"})
    head_ok = _mock_response(200, headers={"Content-Length": "12"})
    detector._session.head = MagicMock(side_effect=[head_unreachable, head_empty, head_ok])

    links_payload = (
        "https://example.com/missing\nhttps://example.com/empty\nhttps://example.com/ok\n"
    )

    findings = await detector.detect(links_payload, "application/x.asset-links")

    assert len(findings) == 2
    assert all(f.detector_type == DetectorType.BROKEN_LINKS for f in findings)
    assert findings[0].finding_type == "unreachable"
    assert findings[0].matched_content == "https://example.com/missing"
    assert findings[0].severity.value == "low"
    assert findings[1].finding_type == "empty_content"
    assert findings[1].matched_content == "https://example.com/empty"


@pytest.mark.asyncio
async def test_broken_links_detector_falls_back_to_get_when_head_unsupported() -> None:
    detector = BrokenLinksDetector()

    head_unsupported = _mock_response(405)
    get_empty = _mock_response(200, headers={"Content-Length": "0"}, chunks=[])

    detector._session.head = MagicMock(return_value=head_unsupported)
    detector._session.get = MagicMock(return_value=get_empty)

    findings = await detector.detect(
        "https://example.com/no-body",
        "application/x.asset-links",
    )

    assert len(findings) == 1
    assert findings[0].finding_type == "empty_content"
    assert findings[0].matched_content == "https://example.com/no-body"


@pytest.mark.asyncio
async def test_broken_links_detector_handles_request_exception() -> None:
    detector = BrokenLinksDetector()
    detector._session.head = MagicMock(side_effect=requests.RequestException("network down"))

    findings = await detector.detect(
        "https://example.com/fail",
        "application/x.asset-links",
    )

    assert len(findings) == 1
    assert findings[0].finding_type == "unreachable"


@pytest.mark.asyncio
async def test_broken_links_detector_ignores_non_http_lines() -> None:
    detector = BrokenLinksDetector()
    head_ok = _mock_response(200, headers={"Content-Length": "10"})
    detector._session.head = MagicMock(return_value=head_ok)

    findings = await detector.detect(
        "not-a-url\nurl_sha256:abc123\nhttps://example.com/ok\n",
        "application/x.asset-links",
    )

    assert findings == []
    detector._session.head.assert_called_once_with(
        "https://example.com/ok",
        allow_redirects=True,
        timeout=detector._REQUEST_TIMEOUT_SECONDS,
    )
