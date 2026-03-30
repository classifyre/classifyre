from __future__ import annotations

import asyncio
import concurrent.futures
import gzip
import logging
import os
import re
import shutil
import subprocess
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit
from xml.etree import ElementTree

import requests

if TYPE_CHECKING:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    from crawl4ai.docker_client import Crawl4aiDockerClient
    from crawl4ai.models import CrawlResult

from ...models.generated_input import (
    SamplingStrategy,
    SitemapInput,
    SitemapOptionalAssets,
    SitemapOptionalCrawl,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.content_extraction import html_to_text
from ...utils.file_parser import parse_bytes
from ...utils.hashing import hash_url, normalize_http_url
from ..base import BaseSource

logger = logging.getLogger(__name__)

MEDIA_HINTS: dict[str, OutputAssetType] = {
    "images": OutputAssetType.IMAGE,
    "image": OutputAssetType.IMAGE,
    "videos": OutputAssetType.VIDEO,
    "video": OutputAssetType.VIDEO,
    "audios": OutputAssetType.AUDIO,
    "audio": OutputAssetType.AUDIO,
}

TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

FILE_EXTENSION_HINTS: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".svg": OutputAssetType.IMAGE,
    ".bmp": OutputAssetType.IMAGE,
    ".ico": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".mkv": OutputAssetType.VIDEO,
    ".avi": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".wav": OutputAssetType.AUDIO,
    ".aac": OutputAssetType.AUDIO,
    ".ogg": OutputAssetType.AUDIO,
    ".pdf": OutputAssetType.BINARY,
    ".doc": OutputAssetType.BINARY,
    ".docx": OutputAssetType.BINARY,
    ".xls": OutputAssetType.TABLE,
    ".xlsx": OutputAssetType.TABLE,
    ".ppt": OutputAssetType.BINARY,
    ".pptx": OutputAssetType.BINARY,
    ".zip": OutputAssetType.BINARY,
    ".rar": OutputAssetType.BINARY,
    ".7z": OutputAssetType.BINARY,
    ".tar": OutputAssetType.BINARY,
    ".gz": OutputAssetType.BINARY,
    ".parquet": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".xml": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".md": OutputAssetType.TXT,
}

_PLAYWRIGHT_INSTALL_LOCK_DIR = Path("/tmp/classifyre-playwright-install.lock")


def _unwrap_crawl_result(value: Any) -> CrawlResult | None:
    from crawl4ai.models import CrawlResult as _CrawlResult  # lazy import

    if isinstance(value, _CrawlResult):
        return value

    if isinstance(value, (list, tuple)):
        for item in value:
            if isinstance(item, _CrawlResult):
                return item
        return None

    if hasattr(value, "__iter__"):
        try:
            for item in value:
                if isinstance(item, _CrawlResult):
                    return item
        except TypeError:
            return None

    return None


def _auto_install_playwright_enabled() -> bool:
    fallback = os.environ.get("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "1")
    value = os.environ.get("CLASSIFYRE_CLI_AUTO_INSTALL_PLAYWRIGHT", fallback).strip().lower()
    return value not in {"0", "false", "no"}


def _playwright_browsers_path() -> Path:
    configured = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / ".cache" / "ms-playwright"


def _has_playwright_chromium() -> bool:
    browsers_path = _playwright_browsers_path()
    for candidate in browsers_path.glob("chromium-*/chrome-linux/chrome"):
        if candidate.is_file():
            return True
    return False


def _acquire_playwright_install_lock(timeout_seconds: int) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            _PLAYWRIGHT_INSTALL_LOCK_DIR.mkdir(parents=True, exist_ok=False)
            return True
        except FileExistsError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(1)


def _release_playwright_install_lock() -> None:
    try:
        _PLAYWRIGHT_INSTALL_LOCK_DIR.rmdir()
    except FileNotFoundError:
        return
    except OSError:
        logger.debug(
            "Could not remove Playwright lock directory %s",
            _PLAYWRIGHT_INSTALL_LOCK_DIR,
        )


def _find_playwright_binary() -> str | None:
    """Return the playwright executable path, checking both PATH and the current venv."""
    found = shutil.which("playwright")
    if found:
        return found
    # Fallback: look next to the running Python interpreter (covers venvs where
    # the venv bin/ dir is not on PATH).
    import sys as _sys

    venv_bin = Path(_sys.executable).parent
    candidate = venv_bin / "playwright"
    if candidate.is_file():
        return str(candidate)
    return None


def _install_playwright_chromium() -> None:
    if _has_playwright_chromium():
        return

    if not _auto_install_playwright_enabled():
        raise RuntimeError(
            "Playwright Chromium is not installed. "
            "Set CLASSIFYRE_CLI_AUTO_INSTALL_PLAYWRIGHT=1 or run `playwright install chromium`."
        )

    lock_timeout = int(os.environ.get("CLASSIFYRE_PLAYWRIGHT_LOCK_TIMEOUT_SECONDS", "300"))
    install_timeout = int(os.environ.get("CLASSIFYRE_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS", "1800"))

    if not _acquire_playwright_install_lock(lock_timeout):
        if _has_playwright_chromium():
            return
        raise RuntimeError("Timed out waiting for Playwright Chromium installation lock.")

    try:
        if _has_playwright_chromium():
            return

        playwright_binary = _find_playwright_binary()
        if not playwright_binary:
            raise RuntimeError("Could not find the `playwright` executable in PATH or venv.")

        command = [playwright_binary, "install", "chromium"]
        install_with_deps = os.environ.get(
            "CLASSIFYRE_PLAYWRIGHT_INSTALL_WITH_DEPS", "0"
        ).strip().lower() in {"1", "true", "yes"}
        if install_with_deps:
            command = [playwright_binary, "install", "--with-deps", "chromium"]

        logger.info("Installing Playwright Chromium on demand...")
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=install_timeout,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            raise RuntimeError(f"Playwright installation failed: {detail}")

        logger.info("Playwright Chromium installed successfully")
    finally:
        _release_playwright_install_lock()


class _ExternalCrawlClient:
    def __init__(
        self,
        *,
        base_url: str,
        browser_config: BrowserConfig,
        crawler_config: CrawlerRunConfig,
        timeout_seconds: float,
    ):
        self.base_url = base_url
        self.browser_config = browser_config
        self.crawler_config = crawler_config
        self.timeout_seconds = timeout_seconds
        self.client: Crawl4aiDockerClient | None = None

    async def __aenter__(self) -> _ExternalCrawlClient:
        from crawl4ai.docker_client import Crawl4aiDockerClient  # lazy import

        self.client = Crawl4aiDockerClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            verbose=False,
        )
        await self.client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.client is not None:
            await self.client.__aexit__(exc_type, exc, tb)
            self.client = None

    async def crawl_url(self, url: str) -> CrawlResult | None:
        if self.client is None:
            raise RuntimeError("External crawl client is not initialized")

        result = await self.client.crawl(
            urls=[url],
            browser_config=self.browser_config,
            crawler_config=self.crawler_config,
        )
        return _unwrap_crawl_result(result)


class _InternalCrawlClient:
    def __init__(
        self,
        *,
        browser_config: BrowserConfig,
        crawler_config: CrawlerRunConfig,
    ):
        self.browser_config = browser_config
        self.crawler_config = crawler_config
        self.crawler: AsyncWebCrawler | None = None

    async def __aenter__(self) -> _InternalCrawlClient:
        from crawl4ai import AsyncWebCrawler  # lazy import

        self.crawler = AsyncWebCrawler(config=self.browser_config)
        await self.crawler.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.crawler is not None:
            await self.crawler.__aexit__(exc_type, exc, tb)
            self.crawler = None

    async def crawl_url(self, url: str) -> CrawlResult | None:
        if self.crawler is None:
            raise RuntimeError("Internal crawl client is not initialized")

        result = await self.crawler.arun(url=url, config=self.crawler_config)
        return _unwrap_crawl_result(result)


@dataclass
class _ResourceSnapshot:
    url: str
    mime_type: str
    raw_content: str
    text_content: str
    file_size_bytes: int
    parse_error: str | None = None


class SitemapSource(BaseSource):
    source_type = "sitemap"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = SitemapInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        sitemap_url = normalize_http_url(str(self.config.required.sitemap_url))
        if not sitemap_url:
            raise ValueError("required.sitemap_url must be a valid HTTP(S) URL")
        self.sitemap_url = sitemap_url

        parsed_sitemap = urlsplit(self.sitemap_url)
        self.site_base_url = f"{parsed_sitemap.scheme}://{parsed_sitemap.netloc}"

        crawl_options = self._crawl_options()
        asset_options = self._asset_options()

        self.execution_mode = self._resolve_execution_mode()
        self.remote_crawler_url = self._resolve_remote_crawler_url()
        self.request_timeout_seconds = float(crawl_options.request_timeout_seconds or 30)
        self.max_nested_sitemaps = int(crawl_options.max_nested_sitemaps or 100)
        self.max_related_assets_per_page = int(asset_options.max_related_assets_per_page or 40)
        self.max_asset_bytes = int(asset_options.max_asset_bytes or 5_242_880)
        self.include_external_links = bool(asset_options.include_external_links)
        self.fetch_related_assets = asset_options.fetch_related_assets is not False
        self.crawl_page_timeout_ms = int(crawl_options.crawl_page_timeout_ms or 120_000)
        self.user_agent = (
            crawl_options.user_agent
            or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": self.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
            }
        )

        self._page_content_cache: dict[str, tuple[str, str]] = {}
        self._resource_content_cache: dict[str, tuple[str, str]] = {}
        self._hash_to_url: dict[str, str] = {}
        self._seen_asset_hashes: set[str] = set()

        logger.info(
            "Initialized sitemap source for %s (mode=%s)",
            self.site_base_url,
            self.execution_mode,
        )

    def _crawl_options(self) -> SitemapOptionalCrawl:
        if self.config.optional and self.config.optional.crawl:
            return self.config.optional.crawl
        return SitemapOptionalCrawl()

    def _asset_options(self) -> SitemapOptionalAssets:
        if self.config.optional and self.config.optional.assets:
            return self.config.optional.assets
        return SitemapOptionalAssets()

    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            # Connection test uses HTTP only — no browser or playwright required.
            # We just verify the sitemap is reachable and contains at least one URL.
            urls = self._collect_sitemap_urls(limit=1)
            if not urls:
                result["status"] = "FAILURE"
                result["message"] = f"No URLs found in sitemap {self.sitemap_url}"
                return result

            result["status"] = "SUCCESS"
            result["message"] = f"Sitemap reachable. Found URL: {urls[0]}"

        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)

        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._reset_runtime_state()

        sampling = self.config.sampling
        limit: int | None = (
            None if sampling.strategy == SamplingStrategy.ALL else (sampling.limit or 100)
        )
        page_urls = self._collect_sitemap_urls(sampling.strategy, limit)
        if not page_urls:
            logger.warning("No sitemap URLs found for extraction")
            return

        pipeline = None
        if self.config.detectors and any(d.enabled for d in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            logger.info("Running detector pipeline per streamed sitemap batch...")
            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        pending_batch: list[SingleAssetScanResults] = []
        now = datetime.now(UTC)

        async with self._build_crawl_client() as crawler:
            for idx, page_url in enumerate(page_urls, start=1):
                if self._aborted:
                    break

                try:
                    crawl_result = await crawler.crawl_url(page_url)
                except Exception as exc:
                    logger.error("Failed to crawl %s: %s", page_url, exc)
                    continue

                if crawl_result is None:
                    logger.warning("Crawl returned no result for %s", page_url)
                    continue

                if not crawl_result.success:
                    logger.warning(
                        "Crawl failed for %s: %s",
                        page_url,
                        crawl_result.error_message,
                    )
                    continue

                page_asset, related_assets = self._transform_crawl_result_to_assets(
                    crawl_result,
                    now,
                )
                page_new_assets: list[SingleAssetScanResults] = []
                self._add_asset_if_new(page_new_assets, page_asset)
                for related_asset in related_assets:
                    self._add_asset_if_new(page_new_assets, related_asset)

                for asset in page_new_assets:
                    pending_batch.append(asset)
                    while len(pending_batch) >= self.BATCH_SIZE:
                        to_emit = pending_batch[: self.BATCH_SIZE]
                        pending_batch = pending_batch[self.BATCH_SIZE :]
                        if pipeline is not None:
                            to_emit = await pipeline.process(to_emit)
                        if to_emit:
                            yield to_emit

                logger.info(
                    "Crawled page %s/%s: %s (related assets: %s)",
                    idx,
                    len(page_urls),
                    page_asset.hash,
                    len(related_assets),
                )

        if pending_batch:
            to_emit = pending_batch
            if pipeline is not None:
                to_emit = await pipeline.process(to_emit)
            if to_emit:
                yield to_emit

    def _reset_runtime_state(self) -> None:
        self._page_content_cache = {}
        self._resource_content_cache = {}
        self._hash_to_url = {}
        self._seen_asset_hashes = set()

    def _run_async(self, coro: Any) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()

    def _build_crawl_client(self) -> _ExternalCrawlClient | _InternalCrawlClient:
        from crawl4ai import BrowserConfig, CacheMode, CrawlerRunConfig  # lazy import

        browser_config = BrowserConfig(
            headless=True,
            user_agent=self.user_agent,
            verbose=False,
            # Required when running in containers with dropped capabilities:
            # Chromium's default sandbox requires privileges not available in k8s pods.
            extra_args=["--no-sandbox", "--disable-dev-shm-usage"],
        )

        crawler_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            page_timeout=self.crawl_page_timeout_ms,
            verbose=False,
            exclude_social_media_domains=[
                "facebook.com",
                "twitter.com",
                "x.com",
                "linkedin.com",
                "instagram.com",
                "pinterest.com",
                "tiktok.com",
                "snapchat.com",
                "reddit.com",
            ],
        )

        if self.execution_mode == "internal":
            _install_playwright_chromium()
            return _InternalCrawlClient(
                browser_config=browser_config,
                crawler_config=crawler_config,
            )

        return _ExternalCrawlClient(
            base_url=self.remote_crawler_url,
            browser_config=browser_config,
            crawler_config=crawler_config,
            timeout_seconds=self.request_timeout_seconds,
        )

    def _resolve_execution_mode(self) -> str:
        value = os.getenv("SITEMAP_CRAWLER_MODE", "internal").strip().lower()
        if value in {"internal", "external"}:
            return value

        logger.warning(
            "Invalid SITEMAP_CRAWLER_MODE=%r; defaulting to internal",
            value,
        )
        return "internal"

    def _resolve_remote_crawler_url(self) -> str:
        url = os.getenv("SITEMAP_CRAWLER_ENDPOINT", "http://localhost:11235").strip()
        normalized = normalize_http_url(url)
        if not normalized:
            logger.warning(
                "Invalid SITEMAP_CRAWLER_ENDPOINT=%r; using http://localhost:11235",
                url,
            )
            return "http://localhost:11235"
        return normalized

    def _collect_sitemap_urls(
        self,
        strategy: SamplingStrategy = SamplingStrategy.RANDOM,
        limit: int | None = None,
    ) -> list[str]:
        import random as _random

        sitemap_queue = [self.sitemap_url]
        visited_sitemaps: set[str] = set()
        seen_pages: set[str] = set()
        # For LATEST: collect (url, lastmod) pairs; for others collect urls directly
        collected_with_dates: list[tuple[str, str | None]] = []

        while sitemap_queue:
            if len(visited_sitemaps) >= self.max_nested_sitemaps:
                logger.warning(
                    "Reached max_nested_sitemaps=%s while traversing %s",
                    self.max_nested_sitemaps,
                    self.sitemap_url,
                )
                break

            sitemap_url = sitemap_queue.pop(0)
            normalized_sitemap = normalize_http_url(
                sitemap_url,
                base_url=self.site_base_url,
            )
            if not normalized_sitemap:
                continue
            if normalized_sitemap in visited_sitemaps:
                continue

            visited_sitemaps.add(normalized_sitemap)

            try:
                xml_bytes = self._fetch_sitemap_bytes(normalized_sitemap)
            except Exception as exc:
                logger.error("Failed to fetch sitemap %s: %s", normalized_sitemap, exc)
                continue

            nested_sitemaps, page_entries = self._parse_sitemap_bytes(
                xml_bytes,
                normalized_sitemap,
            )

            for nested in nested_sitemaps:
                if nested not in visited_sitemaps:
                    sitemap_queue.append(nested)

            for page_url, lastmod in page_entries:
                normalized_page = normalize_http_url(
                    page_url,
                    base_url=self.site_base_url,
                )
                if not normalized_page or normalized_page in seen_pages:
                    continue

                seen_pages.add(normalized_page)
                collected_with_dates.append((normalized_page, lastmod))

                # For RANDOM/ALL with no ordering needed, we can short-circuit
                # on limit only if we don't need to sort (ALL has no limit).
                if (
                    limit
                    and strategy == SamplingStrategy.RANDOM
                    and len(collected_with_dates) >= limit * 10
                ):
                    # Collected enough candidates for random sampling
                    break

        if strategy == SamplingStrategy.LATEST:
            # Sort by lastmod descending; entries without dates go to the end
            def _sort_key(entry: tuple[str, str | None]) -> str:
                return entry[1] or ""

            collected_with_dates.sort(key=_sort_key, reverse=True)
        elif strategy == SamplingStrategy.RANDOM:
            _random.shuffle(collected_with_dates)

        urls = [url for url, _ in collected_with_dates]
        if limit is not None:
            return urls[:limit]
        return urls

    def _fetch_sitemap_bytes(self, sitemap_url: str) -> bytes:
        response = self.session.get(
            sitemap_url,
            timeout=self.request_timeout_seconds,
        )
        response.raise_for_status()
        content = response.content

        is_gzip = sitemap_url.endswith(".gz") or content[:2] == b"\x1f\x8b"
        if is_gzip:
            try:
                return gzip.decompress(content)
            except Exception as exc:
                raise RuntimeError(f"Failed to decompress sitemap {sitemap_url}: {exc}") from exc

        return content

    def _parse_sitemap_bytes(
        self,
        xml_bytes: bytes,
        sitemap_url: str,
    ) -> tuple[list[str], list[tuple[str, str | None]]]:
        """Return (nested_sitemap_urls, [(page_url, lastmod_or_None)]) from sitemap XML."""
        try:
            root = ElementTree.fromstring(xml_bytes)
        except ElementTree.ParseError as exc:
            raise RuntimeError(f"Invalid sitemap XML at {sitemap_url}: {exc}") from exc

        root_name = self._xml_local_name(root.tag)
        nested_sitemaps: list[str] = []
        page_entries: list[tuple[str, str | None]] = []

        if root_name == "sitemapindex":
            loc_nodes = root.findall(".//{*}sitemap/{*}loc")
            for loc in loc_nodes:
                if loc.text:
                    normalized = normalize_http_url(
                        loc.text.strip(),
                        base_url=sitemap_url,
                    )
                    if normalized:
                        nested_sitemaps.append(normalized)
            return nested_sitemaps, page_entries

        url_nodes = root.findall(".//{*}url")
        if url_nodes:
            for url_node in url_nodes:
                loc_node = url_node.find("{*}loc")
                if loc_node is None:
                    loc_node = url_node.find("loc")
                if loc_node is None or not loc_node.text:
                    continue
                normalized = normalize_http_url(loc_node.text.strip(), base_url=sitemap_url)
                if not normalized:
                    continue
                lastmod_node = url_node.find("{*}lastmod")
                if lastmod_node is None:
                    lastmod_node = url_node.find("lastmod")
                lastmod = (
                    lastmod_node.text.strip()
                    if lastmod_node is not None and lastmod_node.text
                    else None
                )
                page_entries.append((normalized, lastmod))
        else:
            # Fallback: bare <loc> nodes without enclosing <url>
            for loc in root.findall(".//{*}loc"):
                if loc.text:
                    normalized = normalize_http_url(loc.text.strip(), base_url=sitemap_url)
                    if normalized:
                        page_entries.append((normalized, None))

        return nested_sitemaps, page_entries

    def _xml_local_name(self, tag: str) -> str:
        if "}" in tag:
            return tag.split("}", 1)[1]
        return tag

    def _transform_crawl_result_to_assets(
        self,
        crawl_result: CrawlResult,
        now: datetime,
    ) -> tuple[SingleAssetScanResults, list[SingleAssetScanResults]]:
        page_url = normalize_http_url(
            crawl_result.redirected_url or crawl_result.url,
            base_url=self.site_base_url,
        )
        if not page_url:
            raise ValueError(f"Invalid crawled URL: {crawl_result.url}")

        page_hash = self.generate_hash_id(page_url)

        html_content = crawl_result.cleaned_html or crawl_result.html or ""
        markdown_text = self._extract_markdown_text(crawl_result)
        text_content = markdown_text or html_to_text(html_content)
        self._page_content_cache[page_hash] = (html_content, text_content)

        related_assets, related_hashes = self._build_related_assets(
            crawl_result,
            page_url=page_url,
            page_hash=page_hash,
            now=now,
        )

        title = self._resolve_page_title(crawl_result, page_url)
        metadata = {
            "url": page_url,
            "title": title,
            "status_code": crawl_result.status_code,
            "related_assets": len(related_assets),
            "related_links": len(related_hashes),
        }

        page_asset = SingleAssetScanResults(
            hash=page_hash,
            checksum=self.calculate_checksum(metadata),
            name=title,
            external_url=page_url,
            links=related_hashes,
            asset_type=OutputAssetType.URL,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

        return page_asset, related_assets

    def _extract_markdown_text(self, crawl_result: CrawlResult) -> str:
        markdown = getattr(crawl_result, "markdown", None)
        if markdown is None:
            return ""

        for attr in ("raw_markdown", "markdown_with_citations", "references_markdown"):
            value = getattr(markdown, attr, None)
            if isinstance(value, str) and value.strip():
                return value
        return ""

    def _resolve_page_title(self, crawl_result: CrawlResult, page_url: str) -> str:
        metadata = crawl_result.metadata or {}
        candidate = metadata.get("title") if isinstance(metadata, dict) else None
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

        html_content = crawl_result.cleaned_html or crawl_result.html or ""
        match = re.search(r"<title>(.*?)</title>", html_content, flags=re.IGNORECASE | re.DOTALL)
        if match and match.group(1).strip():
            return match.group(1).strip()

        parsed = urlsplit(page_url)
        slug = parsed.path.rstrip("/").split("/")[-1]
        return slug or parsed.netloc

    def _build_related_assets(
        self,
        crawl_result: CrawlResult,
        *,
        page_url: str,
        page_hash: str,
        now: datetime,
    ) -> tuple[list[SingleAssetScanResults], list[str]]:
        resource_candidates, lineage_urls = self._extract_related_urls(
            crawl_result,
            page_url=page_url,
        )

        related_assets: list[SingleAssetScanResults] = []

        if self.fetch_related_assets:
            for resource_url, hint in resource_candidates[: self.max_related_assets_per_page]:
                asset = self._build_resource_asset(
                    resource_url,
                    hint=hint,
                    page_hash=page_hash,
                    now=now,
                )
                if asset is not None:
                    related_assets.append(asset)

        lineage_hashes = self._unique_preserve_order(
            [
                self.generate_hash_id(url)
                for url in lineage_urls
                if normalize_http_url(url, base_url=self.site_base_url)
            ]
        )

        return related_assets, lineage_hashes

    def _extract_related_urls(
        self,
        crawl_result: CrawlResult,
        *,
        page_url: str,
    ) -> tuple[list[tuple[str, OutputAssetType | None]], list[str]]:
        candidates: dict[str, OutputAssetType | None] = {}
        lineage_urls: list[str] = []

        media = crawl_result.media or {}
        for media_kind, items in media.items():
            hint = MEDIA_HINTS.get(media_kind.lower())
            if not isinstance(items, list):
                continue
            for item in items:
                url = self._extract_candidate_url(item, base_url=page_url)
                if not url:
                    continue
                candidates.setdefault(url, hint)
                lineage_urls.append(url)

        links = crawl_result.links or {}
        for bucket, items in links.items():
            if not isinstance(items, list):
                continue

            is_external_bucket = bucket.lower() == "external"
            if is_external_bucket and not self.include_external_links:
                continue

            for item in items:
                url = self._extract_candidate_url(item, base_url=page_url)
                if not url:
                    continue

                lineage_urls.append(url)
                if self._looks_like_file_asset(url):
                    candidates.setdefault(url, self._hint_from_extension(url))

        candidate_list = list(candidates.items())
        unique_lineage = self._unique_preserve_order(lineage_urls)
        return candidate_list, unique_lineage

    def _extract_candidate_url(self, item: Any, *, base_url: str) -> str | None:
        if isinstance(item, str):
            return normalize_http_url(item, base_url=base_url)

        if not isinstance(item, dict):
            return None

        for key in ("src", "href", "url"):
            value = item.get(key)
            if isinstance(value, str):
                normalized = normalize_http_url(value, base_url=base_url)
                if normalized:
                    return normalized

        return None

    def _looks_like_file_asset(self, url: str) -> bool:
        path = urlsplit(url).path.lower()
        for extension in FILE_EXTENSION_HINTS:
            if path.endswith(extension):
                return True
        return False

    def _hint_from_extension(self, url: str) -> OutputAssetType | None:
        path = urlsplit(url).path.lower()
        for extension, hint in FILE_EXTENSION_HINTS.items():
            if path.endswith(extension):
                return hint
        return None

    def _build_resource_asset(
        self,
        resource_url: str,
        *,
        hint: OutputAssetType | None,
        page_hash: str,
        now: datetime,
    ) -> SingleAssetScanResults | None:
        normalized = normalize_http_url(resource_url, base_url=self.site_base_url)
        if not normalized:
            return None

        resource_hash = self.generate_hash_id(normalized)

        snapshot = self._download_resource_snapshot(normalized)
        asset_type = hint or self._asset_type_from_mime(snapshot.mime_type)

        if asset_type == OutputAssetType.URL:
            return None

        self._resource_content_cache[resource_hash] = (
            snapshot.raw_content,
            snapshot.text_content,
        )

        metadata = {
            "url": normalized,
            "mime_type": snapshot.mime_type,
            "file_size_bytes": snapshot.file_size_bytes,
            "parse_error": snapshot.parse_error,
            "referenced_by": page_hash,
        }

        return SingleAssetScanResults(
            hash=resource_hash,
            checksum=self.calculate_checksum(metadata),
            name=self._resource_display_name(normalized),
            external_url=normalized,
            links=[],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    def _resource_display_name(self, resource_url: str) -> str:
        parsed = urlsplit(resource_url)
        file_name = parsed.path.rstrip("/").split("/")[-1]
        return file_name or parsed.netloc

    def _download_resource_snapshot(self, url: str) -> _ResourceSnapshot:
        try:
            response = self.session.get(
                url,
                timeout=self.request_timeout_seconds,
                stream=True,
            )
            response.raise_for_status()

            chunks: list[bytes] = []
            total_bytes = 0
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue

                next_size = total_bytes + len(chunk)
                if next_size > self.max_asset_bytes:
                    remain = self.max_asset_bytes - total_bytes
                    if remain > 0:
                        chunks.append(chunk[:remain])
                        total_bytes += remain
                    break

                chunks.append(chunk)
                total_bytes = next_size

            file_bytes = b"".join(chunks)
            declared_mime = response.headers.get("Content-Type", "")
            parsed = parse_bytes(
                file_bytes,
                declared_mime_type=declared_mime,
                file_name=url,
            )

            return _ResourceSnapshot(
                url=url,
                mime_type=parsed.mime_type,
                raw_content=parsed.raw_content,
                text_content=parsed.text_content,
                file_size_bytes=total_bytes,
                parse_error=parsed.parse_error,
            )

        except Exception as exc:
            logger.warning("Failed to download resource %s: %s", url, exc)
            return _ResourceSnapshot(
                url=url,
                mime_type="application/octet-stream",
                raw_content="",
                text_content="",
                file_size_bytes=0,
                parse_error=str(exc),
            )

    def _asset_type_from_mime(self, mime_type: str) -> OutputAssetType:
        normalized = (mime_type or "").lower()
        if normalized.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized.startswith("audio/"):
            return OutputAssetType.AUDIO
        if normalized in TABULAR_MIME_TYPES:
            return OutputAssetType.TABLE
        if normalized in ("text/html", "application/xhtml+xml"):
            return OutputAssetType.URL
        if normalized.startswith("text/") or normalized in {
            "application/json",
            "application/xml",
            "text/xml",
        }:
            return OutputAssetType.TXT
        if normalized:
            return OutputAssetType.BINARY
        return OutputAssetType.OTHER

    def _add_asset_if_new(
        self,
        assets: list[SingleAssetScanResults],
        asset: SingleAssetScanResults,
    ) -> None:
        if asset.hash in self._seen_asset_hashes:
            return
        self._seen_asset_hashes.add(asset.hash)
        assets.append(asset)

    def _unique_preserve_order(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        unique_values: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            unique_values.append(value)
        return unique_values

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        normalized = normalize_http_url(asset_id, base_url=self.site_base_url)
        if not normalized:
            return None

        asset_hash = self.generate_hash_id(normalized)

        if asset_hash in self._page_content_cache:
            return self._page_content_cache[asset_hash]

        if asset_hash in self._resource_content_cache:
            return self._resource_content_cache[asset_hash]

        snapshot = self._download_resource_snapshot(normalized)
        if snapshot.text_content:
            cached = (snapshot.raw_content, snapshot.text_content)
            self._resource_content_cache[asset_hash] = cached
            return cached

        return None

    def generate_hash_id(self, asset_id: str) -> str:
        normalized = normalize_http_url(asset_id, base_url=self.site_base_url)
        if not normalized:
            raise ValueError(f"Invalid URL for hash: {asset_id}")

        asset_hash = hash_url(normalized, base_url=self.site_base_url)
        self._hash_to_url[asset_hash] = normalized
        return asset_hash

    def resolve_link_for_detection(self, link: str) -> str | None:
        mapped = self._hash_to_url.get(link)
        if mapped:
            return mapped
        return normalize_http_url(link)

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting sitemap extraction...")
        super().abort()
        if hasattr(self, "session"):
            self.session.close()

    def cleanup(self) -> None:
        if hasattr(self, "session"):
            self.session.close()
