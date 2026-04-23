import logging
import re
from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup

from ...models.generated_input import SamplingStrategy, WordPressInput, WordPressOptionalContent
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.hashing import hash_url, normalize_http_url, unhash_id
from ..base import BaseSource

logger = logging.getLogger(__name__)
HTML_TAG_RE = re.compile("<.*?>")


class WordPressSource(BaseSource):
    source_type = "wordpress"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = WordPressInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self.site_base_url = str(self.config.required.url).rstrip("/")
        self.api_base = f"{self.site_base_url}/wp-json/wp/v2"

        self._url_to_wp_id: dict[str, str] = {}
        self._hash_to_url: dict[str, str] = {}
        self._seen_asset_hashes: set[str] = set()

        self.session = requests.Session()

        if self.config.masked.username and self.config.masked.application_password:
            self.session.auth = (
                self.config.masked.username,
                self.config.masked.application_password,
            )

        logger.info(f"Initialized WordPress source for {self.config.required.url}")

    def _content_options(self) -> WordPressOptionalContent:
        if self.config.optional and self.config.optional.content:
            return self.config.optional.content
        return WordPressOptionalContent()

    def test_connection(self) -> dict[str, Any]:
        """Test connectivity to WordPress REST API."""
        logger.info(f"Testing connection to WordPress at {self.config.required.url}...")

        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            response = self.session.get(
                f"{self.api_base}/posts", params={"per_page": 1}, timeout=10
            )
            if response.status_code == 200:
                result["status"] = "SUCCESS"
                result["message"] = "Successfully connected to WordPress REST API."
                logger.info("Connection test successful")
            elif response.status_code in (401, 403):
                result["status"] = "SUCCESS"
                result["message"] = (
                    "WordPress REST API is reachable, but authentication is required for "
                    "private content."
                )
                logger.info("Connection test successful (authentication required)")
            else:
                result["status"] = "FAILURE"
                result["message"] = (
                    f"Unexpected status from WordPress REST API: {response.status_code}"
                )
                logger.error(result["message"])
        except requests.exceptions.RequestException as e:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect: {e!s}"
            logger.error(f"Connection test failed: {e}")

        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        """Extract posts and pages from WordPress."""
        if self._aborted:
            return

        logger.info("Extracting metadata from WordPress...")

        self._url_to_wp_id = {}
        self._hash_to_url = {}
        self._seen_asset_hashes = set()

        pipeline = None
        if self.config.detectors and any(d.enabled for d in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            logger.info("Running detector pipeline per streamed WordPress batch...")
            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        pending_batch: list[SingleAssetScanResults] = []
        content_options = self._content_options()
        sampling = self.config.sampling
        limit: int | None = (
            None if sampling.strategy == SamplingStrategy.ALL else int(sampling.rows_per_page or 100)
        )
        total_items_extracted = 0

        if content_options.fetch_posts is not False:
            posts_count = 0
            posts_assets = 0
            for assets_chunk, items_count in self._stream_content_type(
                "posts",
                limit - total_items_extracted if limit else None,
                sampling.strategy,
            ):
                posts_count += items_count
                total_items_extracted += items_count
                posts_assets += len(assets_chunk)

                for asset in assets_chunk:
                    pending_batch.append(asset)
                    while len(pending_batch) >= self.BATCH_SIZE:
                        to_emit = pending_batch[: self.BATCH_SIZE]
                        pending_batch = pending_batch[self.BATCH_SIZE :]
                        if pipeline is not None:
                            to_emit = await pipeline.process(to_emit)
                        if to_emit:
                            yield to_emit

            logger.info(f"Extracted {posts_count} posts into {posts_assets} assets")

        if content_options.fetch_pages is not False and (
            not limit or total_items_extracted < limit
        ):
            pages_count = 0
            pages_assets = 0
            for assets_chunk, items_count in self._stream_content_type(
                "pages",
                limit - total_items_extracted if limit else None,
                sampling.strategy,
            ):
                pages_count += items_count
                total_items_extracted += items_count
                pages_assets += len(assets_chunk)

                for asset in assets_chunk:
                    pending_batch.append(asset)
                    while len(pending_batch) >= self.BATCH_SIZE:
                        to_emit = pending_batch[: self.BATCH_SIZE]
                        pending_batch = pending_batch[self.BATCH_SIZE :]
                        if pipeline is not None:
                            to_emit = await pipeline.process(to_emit)
                        if to_emit:
                            yield to_emit

            logger.info(f"Extracted {pages_count} pages into {pages_assets} assets")

        if pending_batch:
            to_emit = pending_batch
            if pipeline is not None:
                to_emit = await pipeline.process(to_emit)
            if to_emit:
                yield to_emit

        logger.info("Total extracted WordPress items: %s", total_items_extracted)

    def _stream_content_type(
        self,
        content_type: str,
        limit: int | None,
        strategy: SamplingStrategy = SamplingStrategy.LATEST,
    ) -> Generator[tuple[list[SingleAssetScanResults], int], None, None]:
        """Stream transformed assets for a content type while paginating the API."""
        endpoint = f"{self.api_base}/{content_type}"
        items_extracted = 0
        page = 1
        per_page = 100

        while True:
            if self._aborted or (limit and items_extracted >= limit):
                break

            current_per_page = per_page
            if limit:
                current_per_page = min(per_page, limit - items_extracted)

            params: dict[str, Any] = {
                "per_page": current_per_page,
                "page": page,
                "_embed": "author,wp:term",
            }

            # For LATEST strategy, request newest items first; RANDOM is not directly
            # supported by WP API so we default to modified date ordering
            if strategy == SamplingStrategy.LATEST:
                params["orderby"] = "modified"
                params["order"] = "desc"

            content_options = self._content_options()
            if content_options.post_status:
                params["status"] = ",".join(content_options.post_status)

            try:
                response = self.session.get(endpoint, params=params, timeout=30)
                response.raise_for_status()

                items = response.json()
                if not items:
                    break

                total_items = int(response.headers.get("X-WP-Total", 0))
                total_pages = int(response.headers.get("X-WP-TotalPages", 1))

                logger.info(
                    f"Fetching {content_type} page {page}/{total_pages} "
                    f"({len(items)} items, total: {total_items})"
                )

                page_assets: list[SingleAssetScanResults] = []
                page_items_extracted = 0
                for item in items:
                    if self._aborted or (limit and items_extracted >= limit):
                        break

                    try:
                        page_asset, image_assets = self._transform_item_to_assets(
                            item, content_type
                        )
                        self._add_asset_if_new(page_assets, page_asset)
                        for image_asset in image_assets:
                            self._add_asset_if_new(page_assets, image_asset)
                        items_extracted += 1
                        page_items_extracted += 1
                    except Exception as e:
                        logger.error(
                            f"Failed to transform {content_type} item {item.get('id')}: {e}"
                        )
                        continue

                if page_items_extracted > 0:
                    yield page_assets, page_items_extracted

                if page >= total_pages or len(items) < current_per_page:
                    break

                page += 1

            except requests.exceptions.RequestException as e:
                logger.error(f"Failed to fetch {content_type} page {page}: {e}")
                break

    def _fetch_content_type(
        self, content_type: str, limit: int | None
    ) -> tuple[list[SingleAssetScanResults], int]:
        """Compatibility helper used by tests; collects stream into memory."""
        results: list[SingleAssetScanResults] = []
        items_extracted = 0

        for assets, extracted_count in self._stream_content_type(
            content_type, limit, self.config.sampling.strategy
        ):
            results.extend(assets)
            items_extracted += extracted_count
        return results, items_extracted

    def _add_asset_if_new(
        self, results: list[SingleAssetScanResults], asset: SingleAssetScanResults
    ) -> None:
        if asset.hash in self._seen_asset_hashes:
            return
        self._seen_asset_hashes.add(asset.hash)
        results.append(asset)

    def _parse_wordpress_date(self, date_str: str | None) -> str | None:
        """Parse WordPress date and ensure it has timezone info."""
        if not date_str:
            return None

        if "+" in date_str or date_str.endswith("Z"):
            return date_str

        return f"{date_str}+00:00"

    def _parse_datetime(self, date_str: str | None) -> datetime:
        if not date_str:
            return datetime.now(UTC)
        normalized = date_str.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return datetime.now(UTC)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed

    def _transform_item(self, item: dict[str, Any], content_type: str) -> SingleAssetScanResults:
        """Transform WordPress item to a page URL asset."""
        page_asset, _ = self._transform_item_to_assets(item, content_type)
        return page_asset

    def _transform_item_to_assets(
        self, item: dict[str, Any], content_type: str
    ) -> tuple[SingleAssetScanResults, list[SingleAssetScanResults]]:
        wp_id_value = item.get("id")
        wp_id = str(wp_id_value) if wp_id_value is not None else ""
        slug = str(item.get("slug") or "")

        page_url = self._build_item_url(item, slug, wp_id)
        page_hash = self.generate_hash_id(page_url)

        if wp_id:
            self._url_to_wp_id[page_hash] = wp_id
            self._url_to_wp_id[page_url] = wp_id

        title_obj = item.get("title", {})
        title = title_obj.get("rendered", "") if isinstance(title_obj, dict) else str(title_obj)
        title = self._strip_html(title) or f"WordPress {content_type.rstrip('s')} {wp_id}"

        excerpt_obj = item.get("excerpt", {})
        excerpt = excerpt_obj.get("rendered", "") if isinstance(excerpt_obj, dict) else ""
        excerpt = self._strip_html(excerpt)[:200]

        content_obj = item.get("content", {})
        html_content = content_obj.get("rendered", "") if isinstance(content_obj, dict) else ""

        image_urls, link_urls = self._extract_related_urls(html_content)
        image_hashes = [self.generate_hash_id(url) for url in image_urls]
        link_hashes = [self.generate_hash_id(url) for url in link_urls]
        page_links = self._unique_preserve_order([*image_hashes, *link_hashes])

        created_at_str = self._parse_wordpress_date(item.get("date_gmt", item.get("date")))
        updated_at_str = self._parse_wordpress_date(item.get("modified_gmt", item.get("modified")))
        created_dt = self._parse_datetime(created_at_str)
        updated_dt = self._parse_datetime(updated_at_str)

        metadata = {
            "wp_id": wp_id,
            "title": title,
            "slug": slug,
            "status": item.get("status"),
            "modified": updated_dt.isoformat(),
            "excerpt": excerpt[:100] if excerpt else None,
            "images_count": len(image_urls),
            "links_count": len(link_urls),
        }

        page_asset = SingleAssetScanResults(
            hash=page_hash,
            checksum=self.calculate_checksum(metadata),
            name=title,
            external_url=page_url,
            links=page_links,
            asset_type=OutputAssetType.URL,
            source_id=self.source_id,
            created_at=created_dt,
            updated_at=updated_dt,
            runner_id=self.runner_id,
        )

        image_assets = [
            self._make_image_asset(
                image_url=image_url,
                image_hash=image_hash,
                page_hash=page_hash,
                created_at=created_dt,
                updated_at=updated_dt,
            )
            for image_url, image_hash in zip(image_urls, image_hashes, strict=False)
        ]

        return page_asset, image_assets

    def _build_item_url(self, item: dict[str, Any], slug: str, wp_id: str) -> str:
        link = item.get("link")
        if isinstance(link, str) and link.strip():
            return link

        if slug:
            return f"{self.site_base_url}/{slug.lstrip('/')}"

        if wp_id:
            return f"{self.site_base_url}/?p={wp_id}"

        return self.site_base_url

    def _extract_related_urls(self, html_content: str) -> tuple[list[str], list[str]]:
        if not html_content:
            return [], []

        soup = BeautifulSoup(html_content, "html.parser")
        image_urls: list[str] = []
        link_urls: list[str] = []

        for image in soup.find_all("img"):
            src = image.get("src")
            if isinstance(src, str):
                normalized = self._normalize_external_url(src)
                if normalized:
                    image_urls.append(normalized)

        for anchor in soup.find_all("a"):
            href = anchor.get("href")
            if isinstance(href, str):
                normalized = self._normalize_external_url(href)
                if normalized:
                    link_urls.append(normalized)

        return (
            self._unique_preserve_order(image_urls),
            self._unique_preserve_order(link_urls),
        )

    def _normalize_external_url(self, raw_url: str) -> str | None:
        return normalize_http_url(raw_url, base_url=self.site_base_url)

    def _make_image_asset(
        self,
        *,
        image_url: str,
        image_hash: str,
        page_hash: str,
        created_at: datetime,
        updated_at: datetime,
    ) -> SingleAssetScanResults:
        image_name = self._image_name_from_url(image_url)
        metadata = {
            "url": image_url,
            "referenced_by": page_hash,
        }

        return SingleAssetScanResults(
            hash=image_hash,
            checksum=self.calculate_checksum(metadata),
            name=image_name,
            external_url=image_url,
            links=[],
            asset_type=OutputAssetType.IMAGE,
            source_id=self.source_id,
            created_at=created_at,
            updated_at=updated_at,
            runner_id=self.runner_id,
        )

    def _image_name_from_url(self, image_url: str) -> str:
        parsed = urlsplit(image_url)
        file_name = parsed.path.rstrip("/").split("/")[-1]
        return f"Image: {file_name}" if file_name else f"Image: {image_url}"

    def _unique_preserve_order(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        unique_values: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            unique_values.append(value)
        return unique_values

    def _strip_html(self, html: str) -> str:
        """Strip HTML tags from string."""
        return re.sub(HTML_TAG_RE, "", html).strip()

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        """
        Fetch full content for a WordPress URL asset (for detector scanning).
        """
        try:
            from ...utils.content_extraction import html_to_text

            logger.info(f"Fetching content for WordPress asset {asset_id}")

            html_content: str | None = None
            wp_id = self._resolve_wordpress_item_id(asset_id)

            if wp_id:
                html_content = self._fetch_content_by_wp_id(wp_id)

            if not html_content:
                normalized_url = normalize_http_url(asset_id, base_url=self.site_base_url)
                if normalized_url:
                    html_content = self._fetch_content_by_url(normalized_url)

            if not html_content:
                logger.warning(f"No content found for asset {asset_id}")
                return None

            text_content = html_to_text(html_content)
            logger.debug(
                f"Fetched {len(html_content)} bytes of HTML, "
                f"extracted {len(text_content)} bytes of text"
            )
            return html_content, text_content

        except Exception as e:
            logger.error(f"Failed to fetch content for WordPress asset {asset_id}: {e}")
            return None

    def _resolve_wordpress_item_id(self, asset_id: str) -> str | None:
        normalized = normalize_http_url(asset_id, base_url=self.site_base_url)
        if normalized and normalized in self._url_to_wp_id:
            return self._url_to_wp_id[normalized]
        if asset_id in self._url_to_wp_id:
            return self._url_to_wp_id[asset_id]

        try:
            decoded = unhash_id(asset_id)
        except Exception:
            return None

        parts = decoded.split("_#_")
        for part in reversed(parts):
            if part.isdigit():
                return part
        return None

    def _fetch_content_by_wp_id(self, wp_id: str) -> str | None:
        response = None
        for endpoint in ["posts", "pages"]:
            try:
                url = f"{self.api_base}/{endpoint}/{wp_id}"
                response = self.session.get(url, timeout=10)
                response.raise_for_status()
                break
            except requests.exceptions.RequestException:
                continue

        if not response or not response.ok:
            return None

        data = response.json()
        content_obj = data.get("content", {})
        html_content = content_obj.get("rendered", "")
        if not isinstance(html_content, str) or not html_content:
            return None

        return html_content

    def _fetch_content_by_url(self, url: str) -> str | None:
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException:
            return None

        content_type = response.headers.get("Content-Type", "").lower()
        if content_type.startswith("image/"):
            return None
        if "html" in content_type or not content_type:
            return response.text
        return None

    def generate_hash_id(self, asset_id: str) -> str:
        """Generate a stable hash ID for URL-like assets and keep reverse lookup for detectors."""
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
        """Signal the source to stop extraction."""
        logger.info("Aborting WordPress extraction...")
        super().abort()
        if hasattr(self, "session"):
            self.session.close()

    def cleanup(self) -> None:
        """Clean up resources."""
        if hasattr(self, "session"):
            self.session.close()
