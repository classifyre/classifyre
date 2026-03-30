from __future__ import annotations

import json
import logging
import random
import re
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests

from ..utils.hashing import normalize_http_url

logger = logging.getLogger(__name__)

URL_RE = re.compile(r"https?://[\w\-._~:/?#\[\]@!$&'()*+,;=%]+", re.IGNORECASE)

TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

TABULAR_FILE_EXTENSIONS = {
    ".csv",
    ".tsv",
    ".xls",
    ".xlsx",
    ".parquet",
}


def normalize_atlassian_base_url(url: str, *, strip_wiki: bool = False) -> str:
    normalized = normalize_http_url(url)
    if not normalized:
        raise ValueError(f"Invalid Atlassian base URL: {url}")

    parsed = urlsplit(normalized)
    path = parsed.path.rstrip("/")
    if strip_wiki and path.endswith("/wiki"):
        path = path[: -len("/wiki")]
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def parse_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.now(UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique_values.append(value)
    return unique_values


def deterministic_sample(items: list[Any], limit: int) -> list[Any]:
    if limit >= len(items):
        return items
    generator = random.Random(0)
    indexes = sorted(generator.sample(range(len(items)), k=limit))
    return [items[i] for i in indexes]


def extract_urls_from_text(text: str) -> list[str]:
    if not text:
        return []
    return dedupe_preserve_order([match.group(0) for match in URL_RE.finditer(text)])


def is_tabular_mime_type(mime_type: str) -> bool:
    normalized = mime_type.split(";", 1)[0].strip().lower()
    return normalized in TABULAR_MIME_TYPES


def is_tabular_filename(file_name: str) -> bool:
    path = urlsplit(file_name).path.lower()
    return any(path.endswith(extension) for extension in TABULAR_FILE_EXTENSIONS)


class AtlassianCloudClient:
    def __init__(
        self,
        *,
        base_url: str,
        account_email: str,
        api_token: str,
        request_timeout_seconds: float = 30,
        max_retries: int = 3,
        rate_limit_delay_seconds: float = 0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.request_timeout_seconds = max(float(request_timeout_seconds), 1.0)
        self.max_retries = max(int(max_retries), 0)
        self.rate_limit_delay_seconds = max(float(rate_limit_delay_seconds), 0.0)
        self.session = requests.Session()
        self.session.auth = (account_email, api_token)
        self.session.headers.update(
            {
                "Accept": "application/json",
            }
        )

    def close(self) -> None:
        self.session.close()

    def build_url(self, path_or_url: str) -> str:
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            return path_or_url
        if not path_or_url.startswith("/"):
            path_or_url = f"/{path_or_url}"
        return f"{self.base_url}{path_or_url}"

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        stream: bool = False,
    ) -> requests.Response:
        url = self.build_url(path_or_url)
        attempts = 0
        max_attempts = self.max_retries + 1

        while attempts < max_attempts:
            attempts += 1
            response = self.session.request(
                method,
                url,
                params=params,
                headers=headers,
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
                logger.warning("Atlassian rate limit hit for %s. Retrying in %ss", url, retry_after)
                time.sleep(retry_after)
                continue

            if response.status_code >= 500 and attempts < max_attempts:
                sleep_seconds = min(2 ** (attempts - 1), 8)
                logger.warning(
                    "Atlassian server error %s for %s. Retrying in %ss",
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
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Atlassian API returned non-JSON response for {path_or_url}"
            ) from exc
        if not isinstance(payload, dict):
            raise RuntimeError(f"Expected JSON object response for {path_or_url}")
        return payload

    def get_bytes(self, path_or_url: str) -> tuple[bytes, str]:
        response = self._request("GET", path_or_url, stream=True)
        response.raise_for_status()
        chunks = []
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                chunks.append(chunk)
        mime = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        return b"".join(chunks), mime

    def iter_confluence_results(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        url = path
        next_params = dict(params or {})
        results: list[dict[str, Any]] = []
        while True:
            payload = self.get_json(url, params=next_params)
            page_items = payload.get("results", [])
            if isinstance(page_items, list):
                for item in page_items:
                    if isinstance(item, dict):
                        results.append(item)

            links = payload.get("_links", {})
            next_link = links.get("next") if isinstance(links, dict) else None
            if not isinstance(next_link, str) or not next_link:
                break
            url = urljoin(self.base_url + "/", next_link)
            next_params = None
        return results

    def iter_jira_search_jql(
        self,
        *,
        jql: str,
        fields: list[str],
        max_results: int = 100,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        next_page_token: str | None = None
        while True:
            params: dict[str, Any] = {
                "jql": jql,
                "maxResults": max_results,
                "fields": ",".join(fields),
            }
            if next_page_token:
                params["nextPageToken"] = next_page_token
            payload = self.get_json("/rest/api/3/search/jql", params=params)
            issues = payload.get("issues", [])
            if isinstance(issues, list):
                for issue in issues:
                    if isinstance(issue, dict):
                        results.append(issue)

            if payload.get("isLast") is True:
                break
            if "nextPageToken" not in payload:
                break
            token = payload.get("nextPageToken")
            if not token:
                break
            next_page_token = str(token)
        return results

    def iter_servicedesk_values(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        start = 0
        base_params = dict(params or {})
        page_limit = max(int(limit), 1)

        while True:
            request_params = dict(base_params)
            request_params["start"] = start
            request_params["limit"] = page_limit
            payload = self.get_json(path, params=request_params)

            values = payload.get("values", [])
            if isinstance(values, list):
                for item in values:
                    if isinstance(item, dict):
                        results.append(item)

            is_last = payload.get("isLastPage")
            if is_last is True:
                break

            size = payload.get("size")
            try:
                size_int = int(size)
            except (TypeError, ValueError):
                size_int = len(values) if isinstance(values, list) else 0
            if size_int <= 0:
                break
            start += size_int
        return results


def parse_atlassian_document(value: Any) -> tuple[str, list[str]]:
    text_parts: list[str] = []
    url_candidates: list[str] = []

    def visit(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, str):
            text_parts.append(node)
            url_candidates.extend(extract_urls_from_text(node))
            return
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if isinstance(node, dict):
            attrs = node.get("attrs")
            if isinstance(attrs, dict):
                for key in ("url", "href"):
                    attr_value = attrs.get(key)
                    if isinstance(attr_value, str):
                        url_candidates.append(attr_value)
            if "text" in node:
                visit(node.get("text"))
            if "content" in node:
                visit(node.get("content"))
            for key, val in node.items():
                if key in {"attrs", "text", "content"}:
                    continue
                if isinstance(val, (dict, list, str)):
                    visit(val)
            return

    visit(value)
    return "\n".join(part for part in text_parts if part), dedupe_preserve_order(url_candidates)


def looks_like_file_asset(url: str) -> bool:
    path = urlsplit(url).path.lower()
    file_extensions = (
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".bmp",
        ".ico",
        ".mp4",
        ".webm",
        ".mov",
        ".mkv",
        ".avi",
        ".mp3",
        ".wav",
        ".aac",
        ".ogg",
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
        ".json",
        ".xml",
        ".txt",
        ".csv",
        ".md",
    )
    return path.endswith(file_extensions)


def json_dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)
