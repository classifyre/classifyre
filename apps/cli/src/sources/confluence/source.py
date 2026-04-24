import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from ...models.generated_input import (
    ConfluenceInput,
    ConfluenceOptional,
    ConfluenceOptionalConnection,
    ConfluenceOptionalContent,
    ConfluenceOptionalScope,
    SamplingStrategy,
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
from ..atlassian_common import (
    AtlassianCloudClient,
    dedupe_preserve_order,
    deterministic_sample,
    extract_urls_from_text,
    is_tabular_mime_type,
    looks_like_file_asset,
    normalize_atlassian_base_url,
    parse_atlassian_document,
    parse_datetime,
)
from ..base import BaseSource

logger = logging.getLogger(__name__)

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


class ConfluenceSource(BaseSource):
    source_type = "confluence"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = ConfluenceInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self.base_url = normalize_atlassian_base_url(
            str(self.config.required.base_url),
            strip_wiki=True,
        )
        self.api_base = f"{self.base_url}/wiki/api/v2"

        connection = self._connection_options()
        self.client = AtlassianCloudClient(
            base_url=self.base_url,
            account_email=str(self.config.required.account_email),
            api_token=self.config.masked.api_token,
            request_timeout_seconds=float(connection.request_timeout_seconds or 30),
            max_retries=int(connection.max_retries or 3),
            rate_limit_delay_seconds=float(connection.rate_limit_delay_seconds or 0),
        )

        content_options = self._content_options()
        self.include_footer_comments = content_options.include_footer_comments is not False
        self.include_inline_comments = content_options.include_inline_comments is not False
        self.include_attachments = content_options.include_attachments is not False
        self.include_linked_file_assets = content_options.include_linked_file_assets is not False
        self.attachment_max_bytes = int(content_options.attachment_max_bytes or 5_242_880)

        self._seen_asset_hashes: set[str] = set()
        self._hash_to_url: dict[str, str] = {}
        self._page_content_cache: dict[str, tuple[str, str]] = {}
        self._asset_content_cache: dict[str, tuple[str, str]] = {}
        self._attachment_download_url_by_hash: dict[str, str] = {}

    def _optional(self) -> ConfluenceOptional:
        if self.config.optional:
            return self.config.optional
        return ConfluenceOptional()

    def _connection_options(self) -> ConfluenceOptionalConnection:
        optional = self._optional()
        if optional.connection:
            return optional.connection
        return ConfluenceOptionalConnection()

    def _scope_options(self) -> ConfluenceOptionalScope:
        optional = self._optional()
        if optional.scope:
            return optional.scope
        return ConfluenceOptionalScope()

    def _content_options(self) -> ConfluenceOptionalContent:
        optional = self._optional()
        if optional.content:
            return optional.content
        return ConfluenceOptionalContent()

    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            self.client.get_json("/wiki/api/v2/spaces", params={"limit": 1})
            result["status"] = "SUCCESS"
            result["message"] = "Successfully connected to Confluence Cloud API."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Confluence Cloud API: {exc}"
        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._reset_runtime_state()

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        page_refs = self._discover_page_refs()
        sampled_refs = self._sample_page_refs(page_refs)

        pending_batch: list[SingleAssetScanResults] = []
        for page_ref in sampled_refs:
            if self._aborted:
                break

            assets = self._extract_page_assets(page_ref)
            for asset in assets:
                if not self._add_asset_if_new(pending_batch, asset):
                    continue
                while len(pending_batch) >= self.BATCH_SIZE:
                    to_emit = pending_batch[: self.BATCH_SIZE]
                    pending_batch = pending_batch[self.BATCH_SIZE :]
                    if pipeline is not None:
                        to_emit = await pipeline.process(to_emit)
                    if to_emit:
                        yield to_emit

        if pending_batch:
            to_emit = pending_batch
            if pipeline is not None:
                to_emit = await pipeline.process(to_emit)
            if to_emit:
                yield to_emit

    def _reset_runtime_state(self) -> None:
        self._seen_asset_hashes = set()
        self._hash_to_url = {}
        self._page_content_cache = {}
        self._asset_content_cache = {}
        self._attachment_download_url_by_hash = {}

    def _discover_page_refs(self) -> list[dict[str, Any]]:
        refs: list[dict[str, Any]] = []
        spaces = self._fetch_spaces()
        for space in spaces:
            if self._aborted:
                break
            space_id = str(space.get("id") or "")
            if not space_id:
                continue
            page_results = self.client.iter_confluence_results(
                f"/wiki/api/v2/spaces/{space_id}/pages",
                params={"limit": 250, "body-format": "storage"},
            )
            for page in page_results:
                page_id = str(page.get("id") or "")
                if not page_id:
                    continue
                refs.append(
                    {
                        "space_id": space_id,
                        "space": space,
                        "page_id": page_id,
                        "title": page.get("title"),
                        "created_at": page.get("createdAt"),
                        "version_created_at": (
                            page.get("version", {}).get("createdAt")
                            if isinstance(page.get("version"), dict)
                            else None
                        ),
                    }
                )
        return refs

    def _fetch_spaces(self) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": 250}
        spaces_filter = self._scope_options().spaces
        if spaces_filter:
            if spaces_filter.ids:
                params["ids"] = ",".join(str(v) for v in spaces_filter.ids)
            if spaces_filter.keys:
                params["keys"] = ",".join(str(v) for v in spaces_filter.keys)
            if spaces_filter.type:
                params["type"] = str(spaces_filter.type.value)
            if spaces_filter.status:
                params["status"] = str(spaces_filter.status.value)
            if spaces_filter.labels:
                params["labels"] = ",".join(str(v) for v in spaces_filter.labels)
        return self.client.iter_confluence_results("/wiki/api/v2/spaces", params=params)

    def _sample_page_refs(self, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sampling = self.config.sampling
        if sampling.strategy == SamplingStrategy.ALL:
            return refs

        limit = int(sampling.rows_per_page or 100)
        if limit >= len(refs):
            return refs

        if sampling.strategy == SamplingStrategy.RANDOM:
            return deterministic_sample(refs, limit)

        refs_sorted = sorted(
            refs,
            key=lambda ref: parse_datetime(
                str(ref.get("version_created_at") or ref.get("created_at") or "")
            ),
            reverse=True,
        )
        return refs_sorted[:limit]

    def _extract_page_assets(self, ref: dict[str, Any]) -> list[SingleAssetScanResults]:
        page_id = str(ref["page_id"])
        page = self.client.get_json(
            f"/wiki/api/v2/pages/{page_id}",
            params={"body-format": "storage"},
        )

        now = datetime.now(UTC)
        title = str(page.get("title") or f"Confluence Page {page_id}")
        page_url = self._page_url(page, page_id)
        page_hash = self.generate_hash_id(page_url)
        body_storage = self._extract_storage_html(page.get("body"))
        body_text = html_to_text(body_storage)
        self._page_content_cache[page_hash] = (body_storage, body_text)

        related_assets: list[SingleAssetScanResults] = []
        related_hashes: list[str] = []

        body_links = self._extract_urls_from_html(body_storage)
        body_link_hashes = [self.generate_hash_id(link) for link in body_links]
        related_hashes.extend(body_link_hashes)

        if self.include_linked_file_assets:
            for link in body_links:
                if not looks_like_file_asset(link):
                    continue
                file_asset = self._make_linked_file_asset(link, page_hash, now)
                if file_asset:
                    related_assets.append(file_asset)
                    related_hashes.append(file_asset.hash)

        if self.include_attachments:
            attachment_assets, attachment_hashes = self._extract_attachment_assets(
                page_id, page_hash, now
            )
            related_assets.extend(attachment_assets)
            related_hashes.extend(attachment_hashes)

        comments_asset, comment_hashes = self._extract_comments_asset(page_id, page_url, now)
        if comments_asset is not None:
            related_assets.append(comments_asset)
            related_hashes.extend(comment_hashes)

        page_metadata = {
            "page_id": page_id,
            "space_id": page.get("spaceId"),
            "title": title,
            "status": page.get("status"),
            "links_count": len(related_hashes),
        }
        page_asset = SingleAssetScanResults(
            hash=page_hash,
            checksum=self.calculate_checksum(page_metadata),
            name=title,
            external_url=page_url,
            links=dedupe_preserve_order(related_hashes),
            asset_type=OutputAssetType.URL,
            source_id=self.source_id,
            created_at=parse_datetime(str(page.get("createdAt") or "")),
            updated_at=parse_datetime(
                str(
                    page.get("version", {}).get("createdAt")
                    if isinstance(page.get("version"), dict)
                    else ""
                )
            ),
            runner_id=self.runner_id,
        )

        return [page_asset, *related_assets]

    def _extract_attachment_assets(
        self,
        page_id: str,
        page_hash: str,
        now: datetime,
    ) -> tuple[list[SingleAssetScanResults], list[str]]:
        assets: list[SingleAssetScanResults] = []
        hashes: list[str] = []
        attachments = self.client.iter_confluence_results(
            f"/wiki/api/v2/pages/{page_id}/attachments",
            params={"limit": 250},
        )
        for attachment in attachments:
            attachment_url = self._attachment_url(attachment)
            if not attachment_url:
                continue

            attachment_hash = self.generate_hash_id(attachment_url)
            attachment_name = str(attachment.get("title") or f"Attachment {attachment.get('id')}")
            mime = str(attachment.get("mediaType") or "").lower()
            asset_type = self._asset_type_from_mime_or_url(mime, attachment_url)
            metadata = {
                "attachment_id": attachment.get("id"),
                "title": attachment_name,
                "media_type": mime,
                "file_size": attachment.get("fileSize"),
                "page_hash": page_hash,
            }

            download_url = self._attachment_download_url(attachment)
            if download_url:
                self._attachment_download_url_by_hash[attachment_hash] = download_url

            assets.append(
                SingleAssetScanResults(
                    hash=attachment_hash,
                    checksum=self.calculate_checksum(metadata),
                    name=attachment_name,
                    external_url=attachment_url,
                    links=[],
                    asset_type=asset_type,
                    source_id=self.source_id,
                    created_at=now,
                    updated_at=now,
                    runner_id=self.runner_id,
                )
            )
            hashes.append(attachment_hash)
        return assets, hashes

    def _extract_comments_asset(
        self,
        page_id: str,
        page_url: str,
        now: datetime,
    ) -> tuple[SingleAssetScanResults | None, list[str]]:
        comment_items: list[dict[str, Any]] = []
        if self.include_footer_comments:
            comment_items.extend(
                self.client.iter_confluence_results(
                    f"/wiki/api/v2/pages/{page_id}/footer-comments",
                    params={"limit": 250, "body-format": "storage"},
                )
            )
        if self.include_inline_comments:
            comment_items.extend(
                self.client.iter_confluence_results(
                    f"/wiki/api/v2/pages/{page_id}/inline-comments",
                    params={"limit": 250, "body-format": "storage"},
                )
            )

        if not comment_items:
            return None, []

        text_blocks: list[str] = []
        comment_urls: list[str] = []
        for comment in comment_items:
            text, urls = self._comment_text_and_urls(comment)
            if text:
                text_blocks.append(text)
            comment_urls.extend(urls)

        combined_text = "\n\n".join(text_blocks).strip()
        if not combined_text:
            return None, []

        # Keep a distinct, URL-stable comments asset identifier (fragments are stripped in URL normalization).
        comments_url = f"{page_url}?view=comments"
        comments_hash = self.generate_hash_id(comments_url)
        self._asset_content_cache[comments_hash] = (combined_text, combined_text)

        comment_link_hashes = [
            self.generate_hash_id(normalized)
            for normalized in (
                normalize_http_url(url, base_url=self.base_url)
                for url in dedupe_preserve_order(comment_urls)
            )
            if normalized
        ]

        comments_asset = SingleAssetScanResults(
            hash=comments_hash,
            checksum=self.calculate_checksum(
                {
                    "page_id": page_id,
                    "comments_count": len(comment_items),
                    "text_length": len(combined_text),
                }
            ),
            name=f"Comments for page {page_id}",
            external_url=comments_url,
            links=comment_link_hashes,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )
        return comments_asset, [comments_hash]

    def _comment_text_and_urls(self, comment: dict[str, Any]) -> tuple[str, list[str]]:
        body = comment.get("body")
        if not isinstance(body, dict):
            return "", []

        for body_key in ("storage", "view"):
            candidate = body.get(body_key)
            if isinstance(candidate, dict):
                value = candidate.get("value")
                if isinstance(value, str) and value:
                    soup = BeautifulSoup(value, "html.parser")
                    urls = list(self._extract_urls_from_html(value))
                    text = html_to_text(value)
                    if text:
                        return text, urls + extract_urls_from_text(soup.get_text(" "))

        atlas = body.get("atlas_doc_format")
        if isinstance(atlas, dict):
            return parse_atlassian_document(atlas)
        if isinstance(atlas, str):
            try:
                parsed = parse_atlassian_document(atlas)
            except Exception:
                parsed = (atlas, extract_urls_from_text(atlas))
            return parsed

        return parse_atlassian_document(body)

    def _extract_storage_html(self, body: Any) -> str:
        if not isinstance(body, dict):
            return ""
        storage = body.get("storage")
        if not isinstance(storage, dict):
            return ""
        value = storage.get("value")
        if isinstance(value, str):
            return value
        return ""

    def _extract_urls_from_html(self, html_content: str) -> list[str]:
        if not html_content:
            return []
        soup = BeautifulSoup(html_content, "html.parser")
        links: list[str] = []
        for tag in soup.find_all(["a", "img", "source"]):
            for key in ("href", "src"):
                raw = tag.get(key)
                if not isinstance(raw, str):
                    continue
                normalized = normalize_http_url(raw, base_url=self.base_url)
                if normalized:
                    links.append(normalized)
        return dedupe_preserve_order(links)

    def _page_url(self, page: dict[str, Any], page_id: str) -> str:
        links = page.get("_links")
        if isinstance(links, dict):
            webui = links.get("webui")
            if isinstance(webui, str) and webui:
                normalized = normalize_http_url(webui, base_url=self.base_url)
                if normalized:
                    return normalized
        return f"{self.base_url}/wiki/pages/{page_id}"

    def _attachment_url(self, attachment: dict[str, Any]) -> str | None:
        for key in ("downloadLink", "webuiLink"):
            value = attachment.get(key)
            if isinstance(value, str):
                normalized = normalize_http_url(value, base_url=self.base_url)
                if normalized:
                    return normalized
        links = attachment.get("_links")
        if isinstance(links, dict):
            for key in ("download", "webui"):
                value = links.get(key)
                if isinstance(value, str):
                    normalized = normalize_http_url(value, base_url=self.base_url)
                    if normalized:
                        return normalized
        return None

    def _attachment_download_url(self, attachment: dict[str, Any]) -> str | None:
        value = attachment.get("downloadLink")
        if isinstance(value, str):
            normalized = normalize_http_url(value, base_url=self.base_url)
            if normalized:
                return normalized
        links = attachment.get("_links")
        if isinstance(links, dict):
            link_value = links.get("download")
            if isinstance(link_value, str):
                normalized = normalize_http_url(link_value, base_url=self.base_url)
                if normalized:
                    return normalized
        return None

    def _make_linked_file_asset(
        self,
        url: str,
        page_hash: str,
        now: datetime,
    ) -> SingleAssetScanResults | None:
        normalized = normalize_http_url(url, base_url=self.base_url)
        if not normalized:
            return None
        linked_hash = self.generate_hash_id(normalized)
        asset_type = self._asset_type_from_mime_or_url("", normalized)
        metadata = {
            "url": normalized,
            "referenced_by": page_hash,
        }
        return SingleAssetScanResults(
            hash=linked_hash,
            checksum=self.calculate_checksum(metadata),
            name=self._display_name_from_url(normalized),
            external_url=normalized,
            links=[],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    def _display_name_from_url(self, url: str) -> str:
        parsed = urlsplit(url)
        file_name = parsed.path.rstrip("/").split("/")[-1]
        return file_name or parsed.netloc

    def _asset_type_from_mime_or_url(
        self,
        mime_type: str,
        url: str,
    ) -> OutputAssetType:
        normalized_mime = (mime_type or "").lower()
        if normalized_mime.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized_mime.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized_mime.startswith("audio/"):
            return OutputAssetType.AUDIO
        if is_tabular_mime_type(normalized_mime):
            return OutputAssetType.TABLE
        if normalized_mime in {
            "text/plain",
            "application/json",
            "application/xml",
            "text/xml",
        }:
            return OutputAssetType.TXT
        if normalized_mime == "text/html":
            return OutputAssetType.URL

        lower_path = urlsplit(url).path.lower()
        for extension, asset_type in FILE_EXTENSION_HINTS.items():
            if lower_path.endswith(extension):
                return asset_type
        return OutputAssetType.BINARY

    def _add_asset_if_new(
        self,
        assets: list[SingleAssetScanResults],
        asset: SingleAssetScanResults,
    ) -> bool:
        if asset.hash in self._seen_asset_hashes:
            return False
        self._seen_asset_hashes.add(asset.hash)
        assets.append(asset)
        return True

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        direct = self._asset_content_cache.get(asset_id)
        if direct:
            return direct

        if asset_id in self._page_content_cache:
            return self._page_content_cache[asset_id]

        normalized = normalize_http_url(asset_id, base_url=self.base_url)
        if normalized:
            asset_hash = self.generate_hash_id(normalized)
            if asset_hash in self._page_content_cache:
                return self._page_content_cache[asset_hash]
            if asset_hash in self._asset_content_cache:
                return self._asset_content_cache[asset_hash]
            asset_id = asset_hash

        download_url = self._attachment_download_url_by_hash.get(asset_id)
        if not download_url:
            mapped = self._hash_to_url.get(asset_id)
            if mapped:
                download_url = mapped
        if not download_url:
            return None

        try:
            file_bytes, declared_mime = self.client.get_bytes(download_url)
        except Exception as exc:
            logger.warning("Failed to fetch attachment content for %s: %s", download_url, exc)
            return None

        if self.attachment_max_bytes > 0 and len(file_bytes) > self.attachment_max_bytes:
            file_bytes = file_bytes[: self.attachment_max_bytes]

        parsed = parse_bytes(
            file_bytes,
            declared_mime_type=declared_mime,
            file_name=download_url,
        )

        if parsed.text_content:
            self._asset_content_cache[asset_id] = (parsed.raw_content, parsed.text_content)
            return parsed.raw_content, parsed.text_content
        return None

    def generate_hash_id(self, asset_id: str) -> str:
        normalized = normalize_http_url(asset_id, base_url=self.base_url)
        if not normalized:
            raise ValueError(f"Invalid URL for hash: {asset_id}")
        asset_hash = hash_url(normalized, base_url=self.base_url)
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
        _ = text_content
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting Confluence extraction...")
        super().abort()
        self.client.close()

    def cleanup(self) -> None:
        self.client.close()
