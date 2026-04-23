import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    JiraInput,
    JiraOptional,
    JiraOptionalConnection,
    JiraOptionalContent,
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
from ...utils.file_parser import parse_bytes
from ...utils.hashing import hash_url, normalize_http_url
from ..atlassian_common import (
    AtlassianCloudClient,
    dedupe_preserve_order,
    deterministic_sample,
    extract_urls_from_text,
    is_tabular_filename,
    is_tabular_mime_type,
    json_dumps,
    normalize_atlassian_base_url,
    parse_atlassian_document,
    parse_datetime,
)
from ..base import BaseSource

logger = logging.getLogger(__name__)


class JiraSource(BaseSource):
    source_type = "jira"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = JiraInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self.base_url = normalize_atlassian_base_url(str(self.config.required.base_url))
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
        self.include_comments = content_options.include_comments is not False
        self.include_attachments = content_options.include_attachments is not False
        self.attachment_max_bytes = int(content_options.attachment_max_bytes or 5_242_880)

        self._seen_asset_hashes: set[str] = set()
        self._hash_to_url: dict[str, str] = {}
        self._asset_content_cache: dict[str, tuple[str, str]] = {}
        self._attachment_url_by_hash: dict[str, str] = {}

    def _optional(self) -> JiraOptional:
        if self.config.optional:
            return self.config.optional
        return JiraOptional()

    def _connection_options(self) -> JiraOptionalConnection:
        optional = self._optional()
        if optional.connection:
            return optional.connection
        return JiraOptionalConnection()

    def _content_options(self) -> JiraOptionalContent:
        optional = self._optional()
        if optional.content:
            return optional.content
        return JiraOptionalContent()

    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            self.client.get_json("/rest/api/3/project/search", params={"maxResults": 1})
            result["status"] = "SUCCESS"
            result["message"] = "Successfully connected to Jira Cloud API."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Jira Cloud API: {exc}"
        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._reset_runtime_state()

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        fields = [
            "summary",
            "description",
            "issuetype",
            "status",
            "priority",
            "project",
            "created",
            "updated",
            "issuelinks",
            "attachment",
            "reporter",
            "assignee",
        ]
        effective_jql = self._effective_jql()
        issues = self.client.iter_jira_search_jql(
            jql=effective_jql,
            fields=fields,
            max_results=100,
        )
        sampled_issues = self._sample_issues(issues)

        pending_batch: list[SingleAssetScanResults] = []
        for issue in sampled_issues:
            if self._aborted:
                break
            assets = self._extract_issue_assets(issue)
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
        self._asset_content_cache = {}
        self._attachment_url_by_hash = {}

    def _effective_jql(self) -> str:
        scope = self._optional().scope
        project_keys = [
            str(v).strip() for v in (getattr(scope, "project_keys", None) or []) if str(v).strip()
        ]
        project_ids = [
            str(v).strip() for v in (getattr(scope, "project_ids", None) or []) if str(v).strip()
        ]
        scope_jql = str(getattr(scope, "jql", "") or "").strip()

        order_by = ""
        if scope_jql:
            idx = scope_jql.lower().find(" order by ")
            if idx >= 0:
                order_by = scope_jql[idx:].strip()
                scope_jql = scope_jql[:idx].strip()

        project_clauses: list[str] = []
        if project_keys:
            project_clauses.append(f"project in ({', '.join(project_keys)})")
        if project_ids:
            project_clauses.append(f"project in ({', '.join(project_ids)})")
        project_scope = " OR ".join(project_clauses)
        if project_scope:
            project_scope = f"({project_scope})"

        clauses = [clause for clause in [scope_jql, project_scope] if clause]
        if not clauses:
            base_query = "issuekey IS NOT EMPTY"
            if self.config.sampling.strategy == SamplingStrategy.LATEST:
                return f"{base_query} ORDER BY updated DESC"
            return base_query

        query = " AND ".join(f"({clause})" for clause in clauses)
        if order_by:
            return f"{query} {order_by}"
        if self.config.sampling.strategy == SamplingStrategy.LATEST:
            return f"{query} ORDER BY updated DESC"
        return query

    def _sample_issues(self, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sampling = self.config.sampling
        if sampling.strategy == SamplingStrategy.ALL:
            return issues

        limit = int(sampling.rows_per_page or 100)
        if limit >= len(issues):
            return issues

        if sampling.strategy == SamplingStrategy.RANDOM:
            return deterministic_sample(issues, limit)

        sorted_issues = sorted(
            issues,
            key=lambda issue: parse_datetime(
                str(
                    issue.get("fields", {}).get("updated")
                    if isinstance(issue.get("fields"), dict)
                    else ""
                )
            ),
            reverse=True,
        )
        return sorted_issues[:limit]

    def _extract_issue_assets(self, issue: dict[str, Any]) -> list[SingleAssetScanResults]:
        fields = issue.get("fields", {})
        if not isinstance(fields, dict):
            fields = {}

        now = datetime.now(UTC)
        issue_key = str(issue.get("key") or issue.get("id") or "")
        if not issue_key:
            return []

        issue_url = f"{self.base_url}/browse/{issue_key}"
        issue_hash = self.generate_hash_id(issue_url)
        summary = str(fields.get("summary") or issue_key)

        description_text, description_urls = self._text_and_urls_from_adf(fields.get("description"))
        comment_asset, comment_hashes, comment_urls = self._comments_asset(
            issue_key, issue_url, now
        )
        attachment_assets, attachment_hashes = self._attachment_assets(issue, issue_hash, now)
        linked_issue_hashes = self._linked_issue_hashes(fields.get("issuelinks"))

        all_url_hashes = [
            self.generate_hash_id(url)
            for url in (
                normalize_http_url(value, base_url=self.base_url)
                for value in [*description_urls, *comment_urls]
            )
            if url
        ]

        issue_links = dedupe_preserve_order(
            [*linked_issue_hashes, *attachment_hashes, *comment_hashes, *all_url_hashes]
        )

        issue_metadata = {
            "issue_key": issue_key,
            "summary": summary,
            "status": fields.get("status"),
            "priority": fields.get("priority"),
            "project": fields.get("project"),
            "updated": fields.get("updated"),
            "attachments_count": len(attachment_hashes),
            "links_count": len(issue_links),
        }

        issue_text_lines = [
            f"key={issue_key}",
            f"summary={summary}",
            f"status={self._value_name(fields.get('status'))}",
            f"issue_type={self._value_name(fields.get('issuetype'))}",
            f"priority={self._value_name(fields.get('priority'))}",
            "",
            description_text,
        ]
        issue_text = "\n".join(line for line in issue_text_lines if line).strip()
        self._asset_content_cache[issue_hash] = (json_dumps(issue_metadata), issue_text)

        issue_asset = SingleAssetScanResults(
            hash=issue_hash,
            checksum=self.calculate_checksum(issue_metadata),
            name=f"{issue_key}: {summary}",
            external_url=issue_url,
            links=issue_links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=parse_datetime(str(fields.get("created") or "")),
            updated_at=parse_datetime(str(fields.get("updated") or "")),
            runner_id=self.runner_id,
        )

        assets: list[SingleAssetScanResults] = [issue_asset]
        if comment_asset:
            assets.append(comment_asset)
        assets.extend(attachment_assets)
        return assets

    def _comments_asset(
        self,
        issue_key: str,
        issue_url: str,
        now: datetime,
    ) -> tuple[SingleAssetScanResults | None, list[str], list[str]]:
        if not self.include_comments:
            return None, [], []

        comments = self._fetch_issue_comments(issue_key)
        if not comments:
            return None, [], []

        text_blocks: list[str] = []
        urls: list[str] = []
        for comment in comments:
            body = comment.get("body")
            text, body_urls = self._text_and_urls_from_adf(body)
            if text:
                text_blocks.append(text)
            urls.extend(body_urls)

        combined_text = "\n\n".join(block for block in text_blocks if block).strip()
        if not combined_text:
            return None, [], urls

        # Keep a distinct, URL-stable comments asset identifier (fragments are stripped in URL normalization).
        comments_url = f"{issue_url}?view=comments"
        comments_hash = self.generate_hash_id(comments_url)

        comment_link_hashes = [
            self.generate_hash_id(normalized)
            for normalized in (
                normalize_http_url(url, base_url=self.base_url)
                for url in dedupe_preserve_order(urls)
            )
            if normalized
        ]
        self._asset_content_cache[comments_hash] = (combined_text, combined_text)

        asset = SingleAssetScanResults(
            hash=comments_hash,
            checksum=self.calculate_checksum(
                {
                    "issue_key": issue_key,
                    "comments_count": len(comments),
                    "text_length": len(combined_text),
                }
            ),
            name=f"Comments for issue {issue_key}",
            external_url=comments_url,
            links=comment_link_hashes,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )
        return asset, [comments_hash], urls

    def _fetch_issue_comments(self, issue_key: str) -> list[dict[str, Any]]:
        all_comments: list[dict[str, Any]] = []
        start_at = 0
        while True:
            payload = self.client.get_json(
                f"/rest/api/3/issue/{issue_key}/comment",
                params={"startAt": start_at, "maxResults": 100, "orderBy": "created"},
            )
            comments = payload.get("comments", [])
            if isinstance(comments, list):
                all_comments.extend([comment for comment in comments if isinstance(comment, dict)])

            max_results = int(payload.get("maxResults") or 0)
            total = int(payload.get("total") or len(all_comments))
            start_at += max_results if max_results > 0 else len(comments)
            if start_at >= total or not comments:
                break
        return all_comments

    def _attachment_assets(
        self,
        issue: dict[str, Any],
        issue_hash: str,
        now: datetime,
    ) -> tuple[list[SingleAssetScanResults], list[str]]:
        if not self.include_attachments:
            return [], []
        fields = issue.get("fields", {})
        if not isinstance(fields, dict):
            return [], []

        assets: list[SingleAssetScanResults] = []
        hashes: list[str] = []
        attachments = fields.get("attachment")
        if not isinstance(attachments, list):
            return assets, hashes

        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            content_url = attachment.get("content")
            if not isinstance(content_url, str):
                continue
            normalized_url = normalize_http_url(content_url, base_url=self.base_url)
            if not normalized_url:
                continue

            attachment_hash = self.generate_hash_id(normalized_url)
            self._attachment_url_by_hash[attachment_hash] = normalized_url
            mime = str(attachment.get("mimeType") or "").lower()
            filename = str(attachment.get("filename") or f"attachment-{attachment.get('id')}")
            metadata = {
                "issue_hash": issue_hash,
                "attachment_id": attachment.get("id"),
                "mime_type": mime,
                "size": attachment.get("size"),
                "filename": filename,
            }
            assets.append(
                SingleAssetScanResults(
                    hash=attachment_hash,
                    checksum=self.calculate_checksum(metadata),
                    name=filename,
                    external_url=normalized_url,
                    links=[],
                    asset_type=self._asset_type_from_mime_or_name(mime, filename),
                    source_id=self.source_id,
                    created_at=now,
                    updated_at=now,
                    runner_id=self.runner_id,
                )
            )
            hashes.append(attachment_hash)
        return assets, hashes

    def _linked_issue_hashes(self, links: Any) -> list[str]:
        if not isinstance(links, list):
            return []
        hashes: list[str] = []
        for link in links:
            if not isinstance(link, dict):
                continue
            for side in ("inwardIssue", "outwardIssue"):
                issue_obj = link.get(side)
                if not isinstance(issue_obj, dict):
                    continue
                issue_key = issue_obj.get("key")
                if not isinstance(issue_key, str):
                    continue
                linked_url = f"{self.base_url}/browse/{issue_key}"
                hashes.append(self.generate_hash_id(linked_url))
        return dedupe_preserve_order(hashes)

    def _text_and_urls_from_adf(self, value: Any) -> tuple[str, list[str]]:
        if isinstance(value, str):
            return value, extract_urls_from_text(value)
        text, urls = parse_atlassian_document(value)
        return text, dedupe_preserve_order(urls + extract_urls_from_text(text))

    def _value_name(self, value: Any) -> str:
        if isinstance(value, dict):
            name = value.get("name")
            if isinstance(name, str):
                return name
        return str(value or "")

    def _asset_type_from_mime_or_name(
        self,
        mime_type: str,
        file_name: str,
    ) -> OutputAssetType:
        mime_asset_type = self._asset_type_from_mime(mime_type)
        if mime_asset_type != OutputAssetType.BINARY:
            return mime_asset_type
        if is_tabular_filename(file_name):
            return OutputAssetType.TABLE
        return mime_asset_type

    def _asset_type_from_mime(self, mime_type: str) -> OutputAssetType:
        normalized = mime_type.lower()
        if normalized.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized.startswith("audio/"):
            return OutputAssetType.AUDIO
        if is_tabular_mime_type(normalized):
            return OutputAssetType.TABLE
        if normalized in {
            "text/plain",
            "application/json",
            "application/xml",
            "text/xml",
        }:
            return OutputAssetType.TXT
        if normalized == "text/html":
            return OutputAssetType.URL
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
        cached = self._asset_content_cache.get(asset_id)
        if cached:
            return cached

        normalized = normalize_http_url(asset_id, base_url=self.base_url)
        if normalized:
            asset_hash = self.generate_hash_id(normalized)
            cached = self._asset_content_cache.get(asset_hash)
            if cached:
                return cached
            asset_id = asset_hash

        attachment_url = self._attachment_url_by_hash.get(asset_id) or self._hash_to_url.get(
            asset_id
        )
        if not attachment_url:
            return None

        try:
            file_bytes, declared_mime = self.client.get_bytes(attachment_url)
        except Exception as exc:
            logger.warning("Failed to fetch Jira attachment %s: %s", attachment_url, exc)
            return None

        if self.attachment_max_bytes > 0 and len(file_bytes) > self.attachment_max_bytes:
            file_bytes = file_bytes[: self.attachment_max_bytes]

        parsed = parse_bytes(
            file_bytes,
            declared_mime_type=declared_mime,
            file_name=attachment_url,
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
        logger.info("Aborting Jira extraction...")
        super().abort()
        self.client.close()

    def cleanup(self) -> None:
        self.client.close()
