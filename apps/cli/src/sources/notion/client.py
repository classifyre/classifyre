from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

NOTION_API_BASE = "https://api.notion.com/v1"


class NotionClient:
    """Minimal REST client for the Notion API (no SDK).

    Models the retry/rate-limit behaviour of ``AtlassianCloudClient`` and adds
    Notion-specific cursor pagination helpers. File downloads use signed URLs
    that are not on ``api.notion.com`` and must be fetched without the bearer
    header, so ``get_bytes`` defaults to an unauthenticated request.
    """

    def __init__(
        self,
        *,
        token: str,
        notion_version: str = "2025-09-03",
        request_timeout_seconds: float = 30,
        max_retries: int = 3,
        rate_limit_delay_seconds: float = 0,
    ) -> None:
        self.request_timeout_seconds = max(float(request_timeout_seconds), 1.0)
        self.max_retries = max(int(max_retries), 0)
        self.rate_limit_delay_seconds = max(float(rate_limit_delay_seconds), 0.0)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Notion-Version": notion_version,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    def close(self) -> None:
        self.session.close()

    def _build_url(self, path_or_url: str) -> str:
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            return path_or_url
        if not path_or_url.startswith("/"):
            path_or_url = f"/{path_or_url}"
        return f"{NOTION_API_BASE}{path_or_url}"

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        stream: bool = False,
        authed: bool = True,
    ) -> requests.Response:
        url = self._build_url(path_or_url)
        attempts = 0
        max_attempts = self.max_retries + 1

        while attempts < max_attempts:
            attempts += 1
            if authed:
                response = self.session.request(
                    method,
                    url,
                    params=params,
                    json=json,
                    timeout=self.request_timeout_seconds,
                    stream=stream,
                )
            else:
                # Signed file URLs reject the Notion bearer header; use a bare request.
                response = requests.request(
                    method,
                    url,
                    params=params,
                    json=json,
                    timeout=self.request_timeout_seconds,
                    stream=stream,
                )

            if response.status_code == 429 and attempts < max_attempts:
                retry_after_header = response.headers.get("Retry-After")
                retry_after = 1
                if retry_after_header:
                    try:
                        retry_after = max(int(float(retry_after_header)), 1)
                    except ValueError:
                        retry_after = 1
                logger.warning("Notion rate limit hit for %s. Retrying in %ss", url, retry_after)
                time.sleep(retry_after)
                continue

            if response.status_code >= 500 and attempts < max_attempts:
                sleep_seconds = min(2 ** (attempts - 1), 8)
                logger.warning(
                    "Notion server error %s for %s. Retrying in %ss",
                    response.status_code,
                    url,
                    sleep_seconds,
                )
                time.sleep(sleep_seconds)
                continue

            if self.rate_limit_delay_seconds > 0:
                time.sleep(self.rate_limit_delay_seconds)
            return response

        return response

    def get_json(
        self,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = self._request("GET", path_or_url, params=params)
        response.raise_for_status()
        return self._json_object(response, path_or_url)

    def post_json(
        self,
        path_or_url: str,
        *,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = self._request("POST", path_or_url, json=body or {})
        response.raise_for_status()
        return self._json_object(response, path_or_url)

    @staticmethod
    def _json_object(response: requests.Response, path_or_url: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError(f"Notion API returned non-JSON response for {path_or_url}") from exc
        if not isinstance(payload, dict):
            raise RuntimeError(f"Expected JSON object response for {path_or_url}")
        return payload

    def get_bytes(self, url: str, *, authed: bool = False) -> tuple[bytes, str]:
        response = self._request("GET", url, stream=True, authed=authed)
        response.raise_for_status()
        chunks = []
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                chunks.append(chunk)
        mime = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        return b"".join(chunks), mime

    def get_page(self, page_id: str) -> dict[str, Any]:
        return self.get_json(f"/pages/{page_id}")

    def get_block(self, block_id: str) -> dict[str, Any]:
        return self.get_json(f"/blocks/{block_id}")

    def get_data_source(self, data_source_id: str) -> dict[str, Any]:
        return self.get_json(f"/data_sources/{data_source_id}")

    def _iter_paginated(
        self,
        *,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            if method == "POST":
                request_body = dict(body or {})
                request_body["page_size"] = 100
                if cursor:
                    request_body["start_cursor"] = cursor
                payload = self.post_json(path, body=request_body)
            else:
                request_params = dict(params or {})
                request_params["page_size"] = 100
                if cursor:
                    request_params["start_cursor"] = cursor
                payload = self.get_json(path, params=request_params)

            page_items = payload.get("results", [])
            if isinstance(page_items, list):
                for item in page_items:
                    if isinstance(item, dict):
                        results.append(item)

            if not payload.get("has_more"):
                break
            next_cursor = payload.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor:
                break
            cursor = next_cursor
        return results

    def iter_search(self, object_type: str, *, query: str | None = None) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"filter": {"property": "object", "value": object_type}}
        if query:
            body["query"] = query
        return self._iter_paginated(method="POST", path="/search", body=body)

    def iter_block_children(self, block_id: str) -> list[dict[str, Any]]:
        return self._iter_paginated(method="GET", path=f"/blocks/{block_id}/children")

    def iter_data_source_rows(self, data_source_id: str) -> list[dict[str, Any]]:
        return self._iter_paginated(method="POST", path=f"/data_sources/{data_source_id}/query")

    def iter_comments(self, block_id: str) -> list[dict[str, Any]]:
        return self._iter_paginated(method="GET", path="/comments", params={"block_id": block_id})

    def iter_page_property(self, page_id: str, property_id: str) -> list[dict[str, Any]]:
        return self._iter_paginated(method="GET", path=f"/pages/{page_id}/properties/{property_id}")
