from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlsplit

import requests

from ...models.generated_input import (
    NotionInput,
    NotionOptional,
    NotionOptionalConnection,
    NotionOptionalContent,
    NotionOptionalScope,
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
from ...utils.file_parser import resolve_mime_type
from ...utils.hashing import hash_url, normalize_http_url
from ..atlassian_common import (
    dedupe_preserve_order,
    deterministic_sample,
    is_tabular_mime_type,
    parse_datetime,
)
from ..base import BaseSource
from .client import NotionClient

logger = logging.getLogger(__name__)

# File-ish Notion block types that carry a downloadable asset.
FILE_BLOCK_TYPES = {"image", "file", "pdf", "video", "audio"}

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
    ".ppt": OutputAssetType.BINARY,
    ".pptx": OutputAssetType.BINARY,
    ".zip": OutputAssetType.BINARY,
    ".xls": OutputAssetType.TABLE,
    ".xlsx": OutputAssetType.TABLE,
    ".parquet": OutputAssetType.TABLE,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".xml": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".md": OutputAssetType.TXT,
}


@dataclass
class _BlockContent:
    """Accumulated content collected while walking a page's block tree."""

    text_parts: list[str] = field(default_factory=list)
    mention_ids: list[str] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    # (block_id, payload) for file-ish blocks
    file_blocks: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def merge(self, other: _BlockContent) -> None:
        self.text_parts.extend(other.text_parts)
        self.mention_ids.extend(other.mention_ids)
        self.urls.extend(other.urls)
        self.file_blocks.extend(other.file_blocks)


def _rich_text_to_text(rich_text: Any) -> str:
    if not isinstance(rich_text, list):
        return ""
    parts = [rt.get("plain_text") for rt in rich_text if isinstance(rt, dict)]
    return "".join(part for part in parts if isinstance(part, str))


def _rich_text_mention_ids(rich_text: Any) -> list[str]:
    ids: list[str] = []
    if not isinstance(rich_text, list):
        return ids
    for rt in rich_text:
        if not isinstance(rt, dict) or rt.get("type") != "mention":
            continue
        mention = rt.get("mention")
        if not isinstance(mention, dict):
            continue
        mtype = mention.get("type")
        target = mention.get(mtype) if isinstance(mtype, str) else None
        if isinstance(target, dict) and isinstance(target.get("id"), str):
            ids.append(target["id"])
    return ids


def _rich_text_urls(rich_text: Any) -> list[str]:
    urls: list[str] = []
    if not isinstance(rich_text, list):
        return urls
    for rt in rich_text:
        if isinstance(rt, dict) and isinstance(rt.get("href"), str) and rt["href"]:
            urls.append(rt["href"])
    return urls


def _parent_signals(parent: Any) -> dict[str, Any]:
    """Flatten a Notion parent object into ``parent_type`` / ``parent_id`` keys."""
    if not isinstance(parent, dict):
        return {}
    ptype = parent.get("type")
    signals: dict[str, Any] = {}
    if isinstance(ptype, str):
        signals["parent_type"] = ptype
        value = parent.get(ptype)
        if isinstance(value, str) and value:
            signals["parent_id"] = value
    return signals


def _property_signals(properties: Any) -> dict[str, Any]:
    """Extract normalized ``tags`` / ``status`` from a page's properties.

    ``tags`` aggregates all multi_select option names; ``status`` is taken from
    the first ``status`` or ``select`` typed property.
    """
    if not isinstance(properties, dict):
        return {}
    tags: list[str] = []
    status: str | None = None
    for prop in properties.values():
        if not isinstance(prop, dict):
            continue
        ptype = prop.get("type")
        if ptype == "multi_select":
            options = prop.get("multi_select")
            if isinstance(options, list):
                tags.extend(
                    opt["name"]
                    for opt in options
                    if isinstance(opt, dict) and isinstance(opt.get("name"), str)
                )
        elif ptype in ("status", "select") and status is None:
            selected = prop.get(ptype)
            if isinstance(selected, dict) and isinstance(selected.get("name"), str):
                status = selected["name"]
    signals: dict[str, Any] = {}
    if tags:
        signals["tags"] = dedupe_preserve_order(tags)
    if status:
        signals["status"] = status
    return signals


def _file_url_and_external(file_obj: Any) -> tuple[str | None, bool]:
    """Return (download_url, is_external) for a Notion file-ish object."""
    if not isinstance(file_obj, dict):
        return None, False
    ftype = file_obj.get("type")
    if ftype == "external":
        external = file_obj.get("external")
        if isinstance(external, dict):
            return external.get("url"), True
        return None, True
    if ftype in ("file", "file_upload"):
        hosted = file_obj.get(ftype)
        if isinstance(hosted, dict):
            return hosted.get("url"), False
    return None, False


class NotionSource(BaseSource):
    source_type = "notion"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = NotionInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        connection = self._connection_options()
        self.client = NotionClient(
            token=self.config.masked.notion_token,
            notion_version=str(connection.notion_version or "2025-09-03"),
            request_timeout_seconds=float(connection.request_timeout_seconds or 30),
            max_retries=int(connection.max_retries or 3),
            rate_limit_delay_seconds=float(connection.rate_limit_delay_seconds or 0),
        )

        content = self._content_options()
        self.include_comments = content.include_comments is not False
        self.include_files = content.include_files is not False
        self.include_linked_pages = content.include_linked_pages is not False
        self.include_data_sources = content.include_data_sources is not False

        self._seen_asset_hashes: set[str] = set()
        self._hash_to_url: dict[str, str] = {}
        self._page_content_cache: dict[str, tuple[str, str]] = {}
        self._asset_content_cache: dict[str, tuple[str, str]] = {}
        self._external_file_url_by_hash: dict[str, str] = {}
        self._notion_signed_url_by_hash: dict[str, str] = {}
        self._file_block_id_by_hash: dict[str, str] = {}

    # ------------------------------------------------------------------ config
    def _optional(self) -> NotionOptional:
        return self.config.optional or NotionOptional()

    def _connection_options(self) -> NotionOptionalConnection:
        return self._optional().connection or NotionOptionalConnection()

    def _scope_options(self) -> NotionOptionalScope:
        return self._optional().scope or NotionOptionalScope()

    def _content_options(self) -> NotionOptionalContent:
        return self._optional().content or NotionOptionalContent()

    # -------------------------------------------------------------- connection
    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            self.client.post_json("/search", body={"page_size": 1})
            result["status"] = "SUCCESS"
            result["message"] = "Successfully connected to the Notion API."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to the Notion API: {exc}"
        return result

    # ----------------------------------------------------------------- extract
    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._reset_runtime_state()

        refs = self._sample_refs(self._discover_refs())

        pending_batch: list[SingleAssetScanResults] = []
        for ref in refs:
            if self._aborted:
                break

            if ref["kind"] == "data_source":
                assets = self._extract_data_source_assets(ref["obj"])
            else:
                assets = self._extract_page_assets(ref["obj"])

            for asset in assets:
                if not self._add_asset_if_new(pending_batch, asset):
                    continue
                while len(pending_batch) >= self.BATCH_SIZE:
                    to_emit = pending_batch[: self.BATCH_SIZE]
                    pending_batch = pending_batch[self.BATCH_SIZE :]
                    if to_emit:
                        yield to_emit

        if pending_batch:
            yield pending_batch

    def _reset_runtime_state(self) -> None:
        self._seen_asset_hashes = set()
        self._hash_to_url = {}
        self._page_content_cache = {}
        self._asset_content_cache = {}
        self._external_file_url_by_hash = {}
        self._notion_signed_url_by_hash = {}
        self._file_block_id_by_hash = {}
        self._attachment_name_by_hash = {}

    # --------------------------------------------------------------- discovery
    def _discover_refs(self) -> list[dict[str, Any]]:
        refs: list[dict[str, Any]] = []
        scope = self._scope_options()

        if scope.page_ids:
            for page_id in scope.page_ids:
                try:
                    page = self.client.get_page(page_id)
                except Exception as exc:
                    logger.warning("Failed to fetch Notion page %s: %s", page_id, exc)
                    continue
                refs.append(self._make_ref("page", page))
        else:
            for page in self.client.iter_search("page", query=scope.search_query):
                refs.append(self._make_ref("page", page))

        if self.include_data_sources:
            if scope.data_source_ids:
                for ds_id in scope.data_source_ids:
                    try:
                        data_source = self.client.get_data_source(ds_id)
                    except Exception as exc:
                        logger.warning("Failed to fetch Notion data source %s: %s", ds_id, exc)
                        continue
                    refs.append(self._make_ref("data_source", data_source))
            else:
                for data_source in self.client.iter_search("data_source", query=scope.search_query):
                    refs.append(self._make_ref("data_source", data_source))

        return refs

    @staticmethod
    def _make_ref(kind: str, obj: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": kind,
            "obj": obj,
            "edited": obj.get("last_edited_time") or obj.get("created_time") or "",
        }

    def _sorted_refs(self, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            refs,
            key=lambda ref: parse_datetime(str(ref.get("edited") or "")),
            reverse=True,
        )

    def _sample_refs(self, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sampling = self.config.sampling
        if sampling.strategy == SamplingStrategy.ALL:
            return refs

        if sampling.strategy == SamplingStrategy.AUTOMATIC:
            # Newest-first stable order; window advances each run and wraps around.
            return self.automatic_window(self._sorted_refs(refs), key="refs")

        limit = int(sampling.rows_per_page or 100)
        if limit >= len(refs):
            return refs

        if sampling.strategy == SamplingStrategy.RANDOM:
            return deterministic_sample(refs, limit)

        return self._sorted_refs(refs)[:limit]

    # ------------------------------------------------------------------- pages
    def _extract_page_assets(self, page: dict[str, Any]) -> list[SingleAssetScanResults]:
        page_id = str(page.get("id") or "")
        if not page_id:
            return []

        now = datetime.now(UTC)
        canonical_url = self._canonical_url(page_id)
        page_hash = self.generate_hash_id(canonical_url)
        external_url = self._object_url(page, page_id)
        title = self._page_title(page)

        content = self._collect_blocks(page_id)
        body_text = "\n".join(part for part in content.text_parts if part).strip()
        self._page_content_cache[page_hash] = (body_text, body_text)

        related_assets: list[SingleAssetScanResults] = []
        related_hashes: list[str] = []

        if self.include_linked_pages:
            related_hashes.extend(self._linked_page_hashes(page, page_id, content))

        if self.include_files:
            file_assets = self._collect_file_assets(page, content, canonical_url, now)
            related_assets.extend(file_assets)
            related_hashes.extend(asset.hash for asset in file_assets)

        for url in content.urls:
            normalized = normalize_http_url(url)
            if normalized:
                related_hashes.append(self.generate_hash_id(normalized))

        if self.include_comments:
            comments_asset, comment_hashes = self._extract_comments_asset(
                page_id, canonical_url, now
            )
            if comments_asset is not None:
                related_assets.append(comments_asset)
                related_hashes.extend(comment_hashes)

        metadata = {
            "page_id": page_id,
            "title": title,
            "parent": page.get("parent"),
            "links_count": len(related_hashes),
        }
        asset_metadata: dict[str, Any] = {
            "page_id": page_id,
            "title": title,
            "links_count": len(related_hashes),
        }
        asset_metadata.update(_parent_signals(page.get("parent")))
        asset_metadata.update(_property_signals(page.get("properties")))
        page_asset = SingleAssetScanResults(
            hash=page_hash,
            checksum=self.calculate_checksum(metadata),
            name=title,
            external_url=external_url,
            links=dedupe_preserve_order(related_hashes),
            asset_type=OutputAssetType.URL,
            source_id=self.source_id,
            created_at=parse_datetime(str(page.get("created_time") or "")),
            updated_at=parse_datetime(str(page.get("last_edited_time") or "")),
            runner_id=self.runner_id,
            **self.metadata_fields("page", asset_metadata),
        )

        return [page_asset, *related_assets]

    def _collect_blocks(self, block_id: str, depth: int = 0) -> _BlockContent:
        content = _BlockContent()
        if depth > 30:
            return content
        try:
            blocks = self.client.iter_block_children(block_id)
        except Exception as exc:
            logger.warning("Failed to fetch Notion block children for %s: %s", block_id, exc)
            return content

        for block in blocks:
            if self._aborted:
                break
            self._consume_block(block, content, depth)
        return content

    def _consume_block(self, block: dict[str, Any], content: _BlockContent, depth: int) -> None:
        btype = block.get("type")
        if not isinstance(btype, str):
            return
        payload = block.get(btype)
        payload = payload if isinstance(payload, dict) else {}

        rich = payload.get("rich_text")
        text = _rich_text_to_text(rich)
        if text:
            content.text_parts.append(text)
        content.mention_ids.extend(_rich_text_mention_ids(rich))
        content.urls.extend(_rich_text_urls(rich))
        content.urls.extend(_rich_text_urls(payload.get("caption")))

        if btype in FILE_BLOCK_TYPES:
            block_id = str(block.get("id") or "")
            if block_id:
                content.file_blocks.append((block_id, payload))

        if btype == "child_page":
            child_id = str(block.get("id") or "")
            if child_id:
                content.mention_ids.append(child_id)
        elif btype == "child_database":
            child_id = str(block.get("id") or "")
            if child_id:
                content.mention_ids.append(child_id)
        elif btype == "link_to_page":
            link_type = payload.get("type")
            target = payload.get(link_type) if isinstance(link_type, str) else None
            if isinstance(target, str):
                content.mention_ids.append(target)

        if block.get("has_children"):
            child_id = str(block.get("id") or "")
            if child_id:
                content.merge(self._collect_blocks(child_id, depth + 1))

    def _linked_page_hashes(
        self,
        page: dict[str, Any],
        page_id: str,
        content: _BlockContent,
    ) -> list[str]:
        ids: list[str] = []

        parent_id = self._parent_object_id(page.get("parent"))
        if parent_id:
            ids.append(parent_id)

        ids.extend(self._relation_ids_from_properties(page_id, page.get("properties")))
        ids.extend(content.mention_ids)

        return [
            self.generate_hash_id(self._canonical_url(oid)) for oid in dedupe_preserve_order(ids)
        ]

    def _relation_ids_from_properties(
        self,
        page_id: str,
        properties: Any,
    ) -> list[str]:
        ids: list[str] = []
        if not isinstance(properties, dict):
            return ids
        for prop in properties.values():
            if not isinstance(prop, dict) or prop.get("type") != "relation":
                continue
            relation = prop.get("relation")
            if isinstance(relation, list):
                ids.extend(
                    rel["id"]
                    for rel in relation
                    if isinstance(rel, dict) and isinstance(rel.get("id"), str)
                )
            if prop.get("has_more") and isinstance(prop.get("id"), str):
                try:
                    for item in self.client.iter_page_property(page_id, prop["id"]):
                        relation_item = item.get("relation") if isinstance(item, dict) else None
                        if isinstance(relation_item, dict) and isinstance(
                            relation_item.get("id"), str
                        ):
                            ids.append(relation_item["id"])
                except Exception as exc:
                    logger.warning(
                        "Failed to page Notion relation property for %s: %s", page_id, exc
                    )
        return ids

    # ------------------------------------------------------------- data source
    def _extract_data_source_assets(
        self, data_source: dict[str, Any]
    ) -> list[SingleAssetScanResults]:
        ds_id = str(data_source.get("id") or "")
        if not ds_id:
            return []

        canonical_url = self._canonical_url(ds_id)
        ds_hash = self.generate_hash_id(canonical_url)
        external_url = self._object_url(data_source, ds_id)
        name = self._object_title(data_source) or f"Notion data source {ds_id}"

        properties = data_source.get("properties")
        if not isinstance(properties, dict):
            try:
                properties = self.client.get_data_source(ds_id).get("properties")
            except Exception as exc:
                logger.warning("Failed to fetch Notion data source %s schema: %s", ds_id, exc)
                properties = None
        schema = {}
        if isinstance(properties, dict):
            schema = {
                key: value.get("type")
                for key, value in properties.items()
                if isinstance(value, dict)
            }

        row_assets: list[SingleAssetScanResults] = []
        row_hashes: list[str] = []
        sampling = self.config.sampling
        row_limit = (
            None
            if sampling.strategy == SamplingStrategy.ALL
            else int(sampling.rows_per_page or 100)
        )
        try:
            rows = self.client.iter_data_source_rows(ds_id)
        except Exception as exc:
            logger.warning("Failed to query Notion data source %s rows: %s", ds_id, exc)
            rows = []

        for index, row in enumerate(rows):
            if self._aborted:
                break
            if row_limit is not None and index >= row_limit:
                break
            row_id = str(row.get("id") or "")
            if not row_id:
                continue
            row_hashes.append(self.generate_hash_id(self._canonical_url(row_id)))
            row_assets.extend(self._extract_page_assets(row))

        metadata = {
            "data_source_id": ds_id,
            "name": name,
            "parent": data_source.get("parent"),
            "schema": schema,
            "row_count": len(row_hashes),
        }
        asset_metadata: dict[str, Any] = {
            "data_source_id": ds_id,
            "name": name,
            "row_count": len(row_hashes),
        }
        columns = [
            {"name": key, "type": str(value) if isinstance(value, str) else ""}
            for key, value in schema.items()
        ]
        if columns:
            asset_metadata["columns"] = columns
        asset_metadata.update(_parent_signals(data_source.get("parent")))
        ds_asset = SingleAssetScanResults(
            hash=ds_hash,
            checksum=self.calculate_checksum(metadata),
            name=name,
            external_url=external_url,
            links=dedupe_preserve_order(row_hashes),
            asset_type=OutputAssetType.URL,
            source_id=self.source_id,
            created_at=parse_datetime(str(data_source.get("created_time") or "")),
            updated_at=parse_datetime(str(data_source.get("last_edited_time") or "")),
            runner_id=self.runner_id,
            **self.metadata_fields("data_source", asset_metadata),
        )

        return [ds_asset, *row_assets]

    # ------------------------------------------------------------------- files
    def _collect_file_assets(
        self,
        page: dict[str, Any],
        content: _BlockContent,
        page_canonical_url: str,
        now: datetime,
    ) -> list[SingleAssetScanResults]:
        assets: list[SingleAssetScanResults] = []

        icon_asset = self._file_asset_from_object(
            page.get("icon"), page_canonical_url, now, selector="icon", name_hint="icon"
        )
        if icon_asset is not None:
            assets.append(icon_asset)

        cover_asset = self._file_asset_from_object(
            page.get("cover"), page_canonical_url, now, selector="cover", name_hint="cover"
        )
        if cover_asset is not None:
            assets.append(cover_asset)

        properties = page.get("properties")
        if isinstance(properties, dict):
            for prop_name, prop in properties.items():
                if not isinstance(prop, dict) or prop.get("type") != "files":
                    continue
                files = prop.get("files")
                if not isinstance(files, list):
                    continue
                for index, file_obj in enumerate(files):
                    name_hint = (
                        file_obj.get("name") if isinstance(file_obj, dict) else None
                    ) or f"{prop_name}-{index}"
                    asset = self._file_asset_from_object(
                        file_obj,
                        page_canonical_url,
                        now,
                        selector=f"property:{prop_name}:{index}",
                        name_hint=str(name_hint),
                    )
                    if asset is not None:
                        assets.append(asset)

        for block_id, payload in content.file_blocks:
            asset = self._file_asset_from_object(
                payload,
                page_canonical_url,
                now,
                selector=f"block:{block_id}",
                name_hint=str(payload.get("name") or "") or None,
                block_id=block_id,
            )
            if asset is not None:
                assets.append(asset)

        return assets

    def _file_asset_from_object(
        self,
        file_obj: Any,
        page_canonical_url: str,
        now: datetime,
        *,
        selector: str,
        name_hint: str | None,
        block_id: str | None = None,
    ) -> SingleAssetScanResults | None:
        if not isinstance(file_obj, dict) or file_obj.get("type") == "emoji":
            return None

        source_url, is_external = _file_url_and_external(file_obj)
        if not source_url:
            return None

        if is_external:
            stable = normalize_http_url(source_url)
            if not stable:
                return None
            file_hash = self.generate_hash_id(stable)
            self._external_file_url_by_hash[file_hash] = stable
        else:
            if block_id:
                stable = self._canonical_url(block_id)
            else:
                stable = f"{page_canonical_url}?notion_file={quote(selector, safe='')}"
            file_hash = self.generate_hash_id(stable)
            self._notion_signed_url_by_hash[file_hash] = source_url
            if block_id:
                self._file_block_id_by_hash[file_hash] = block_id

        name = name_hint or self._display_name_from_url(source_url)
        self._attachment_name_by_hash[file_hash] = name
        asset_type = self._asset_type_from_mime_or_url("", source_url)
        metadata = {
            "selector": selector,
            "name": name,
            "is_external": is_external,
        }
        return SingleAssetScanResults(
            hash=file_hash,
            checksum=self.calculate_checksum(metadata),
            name=name,
            external_url=stable,
            links=[],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields(
                "file",
                {"selector": selector, "name": name, "is_external": is_external},
            ),
        )

    # ---------------------------------------------------------------- comments
    def _extract_comments_asset(
        self,
        page_id: str,
        page_canonical_url: str,
        now: datetime,
    ) -> tuple[SingleAssetScanResults | None, list[str]]:
        try:
            comments = self.client.iter_comments(page_id)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 403:
                logger.warning(
                    "Failed to fetch Notion comments for %s: 403 Forbidden — "
                    'your integration token lacks the "Read comments" capability. '
                    "Enable it in the Notion Developer portal at "
                    "https://www.notion.so/my-integrations, "
                    "then re-authorize the integration with the workspace.",
                    page_id,
                )
            else:
                logger.warning("Failed to fetch Notion comments for %s: %s", page_id, exc)
            return None, []
        except Exception as exc:
            logger.warning("Failed to fetch Notion comments for %s: %s", page_id, exc)
            return None, []

        if not comments:
            return None, []

        text_blocks: list[str] = []
        for comment in comments:
            text = _rich_text_to_text(comment.get("rich_text"))
            if text:
                text_blocks.append(text)

        combined_text = "\n\n".join(text_blocks).strip()
        if not combined_text:
            return None, []

        comments_url = f"{page_canonical_url}?view=comments"
        comments_hash = self.generate_hash_id(comments_url)
        self._asset_content_cache[comments_hash] = (combined_text, combined_text)

        comments_asset = SingleAssetScanResults(
            hash=comments_hash,
            checksum=self.calculate_checksum(
                {
                    "page_id": page_id,
                    "comments_count": len(comments),
                    "text_length": len(combined_text),
                }
            ),
            name=f"Comments for page {page_id}",
            external_url=comments_url,
            links=[],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields(
                "comments",
                {"page_id": page_id, "comments_count": len(comments)},
            ),
        )
        return comments_asset, [comments_hash]

    # ------------------------------------------------------------ content APIs
    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        direct = self._asset_content_cache.get(asset_id)
        if direct:
            return direct
        if asset_id in self._page_content_cache:
            return self._page_content_cache[asset_id]

        bytes_result = await self.fetch_content_bytes(asset_id)
        if not bytes_result:
            return None
        file_bytes, mime = bytes_result
        parsed = self.parse_asset_bytes(
            file_bytes,
            declared_mime_type=mime,
            file_name=self._attachment_file_name(asset_id, asset_id),
        )
        if parsed.text_content:
            self._asset_content_cache[asset_id] = (parsed.raw_content, parsed.text_content)
            return parsed.raw_content, parsed.text_content
        return None

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        file_hash = self._resolve_to_hash(asset_id)

        external = self._external_file_url_by_hash.get(file_hash)
        if external:
            download_url: str | None = external
        else:
            block_id = self._file_block_id_by_hash.get(file_hash)
            download_url = None
            if block_id:
                download_url = self._fresh_block_file_url(block_id)
            if not download_url:
                download_url = self._notion_signed_url_by_hash.get(file_hash)

        if not download_url:
            return None

        try:
            file_bytes, declared_mime = self.client.get_bytes(download_url, authed=False)
        except Exception as exc:
            logger.warning("Failed to fetch Notion file bytes for %s: %s", download_url, exc)
            return None

        mime_type = resolve_mime_type(
            file_bytes,
            declared_mime_type=declared_mime,
            file_name=self._attachment_file_name(file_hash, download_url),
        )
        return file_bytes, mime_type

    def _resolve_to_hash(self, asset_id: str) -> str:
        if (
            asset_id in self._external_file_url_by_hash
            or asset_id in self._file_block_id_by_hash
            or asset_id in self._notion_signed_url_by_hash
        ):
            return asset_id
        normalized = normalize_http_url(asset_id)
        if normalized:
            return hash_url(normalized)
        return asset_id

    def _fresh_block_file_url(self, block_id: str) -> str | None:
        try:
            block = self.client.get_block(block_id)
        except Exception as exc:
            logger.warning("Failed to refresh Notion file block %s: %s", block_id, exc)
            return None
        btype = block.get("type")
        payload = block.get(btype) if isinstance(btype, str) else None
        payload = payload if isinstance(payload, dict) else {}
        source_url, _ = _file_url_and_external(payload)
        return source_url

    # ----------------------------------------------------------------- helpers
    def _canonical_url(self, object_id: str) -> str:
        return f"https://www.notion.so/{object_id.replace('-', '')}"

    def _object_url(self, obj: dict[str, Any], object_id: str) -> str:
        url = obj.get("url")
        if isinstance(url, str):
            normalized = normalize_http_url(url)
            if normalized:
                return normalized
        return self._canonical_url(object_id)

    def _page_title(self, page: dict[str, Any]) -> str:
        properties = page.get("properties")
        if isinstance(properties, dict):
            for prop in properties.values():
                if isinstance(prop, dict) and prop.get("type") == "title":
                    text = _rich_text_to_text(prop.get("title"))
                    if text:
                        return text
        return f"Notion Page {page.get('id')}"

    def _object_title(self, obj: dict[str, Any]) -> str:
        title = obj.get("title")
        if isinstance(title, list):
            text = _rich_text_to_text(title)
            if text:
                return text
        name = obj.get("name")
        if isinstance(name, str) and name:
            return name
        return ""

    def _parent_object_id(self, parent: Any) -> str | None:
        if not isinstance(parent, dict):
            return None
        ptype = parent.get("type")
        if ptype in ("page_id", "database_id", "data_source_id", "block_id"):
            value = parent.get(ptype)
            if isinstance(value, str) and value:
                return value
        return None

    def _display_name_from_url(self, url: str) -> str:
        parsed = urlsplit(url)
        file_name = parsed.path.rstrip("/").split("/")[-1]
        return file_name or parsed.netloc or url

    def _asset_type_from_mime_or_url(self, mime_type: str, url: str) -> OutputAssetType:
        normalized_mime = (mime_type or "").lower()
        if normalized_mime.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized_mime.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized_mime.startswith("audio/"):
            return OutputAssetType.AUDIO
        if is_tabular_mime_type(normalized_mime):
            return OutputAssetType.TABLE

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

    def generate_hash_id(self, asset_id: str) -> str:
        normalized = normalize_http_url(asset_id)
        if not normalized:
            raise ValueError(f"Invalid URL for hash: {asset_id}")
        asset_hash = hash_url(normalized)
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
        logger.info("Aborting Notion extraction...")
        super().abort()
        self.client.close()

    def cleanup(self) -> None:
        self.client.close()
