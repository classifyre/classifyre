import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    SamplingStrategy,
    ServiceDeskInput,
    ServiceDeskOptional,
    ServiceDeskOptionalConnection,
    ServiceDeskOptionalContent,
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


class ServiceDeskSource(BaseSource):
    source_type = "servicedesk"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = ServiceDeskInput.model_validate(recipe)
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

    def _optional(self) -> ServiceDeskOptional:
        if self.config.optional:
            return self.config.optional
        return ServiceDeskOptional()

    def _connection_options(self) -> ServiceDeskOptionalConnection:
        optional = self._optional()
        if optional.connection:
            return optional.connection
        return ServiceDeskOptionalConnection()

    def _content_options(self) -> ServiceDeskOptionalContent:
        optional = self._optional()
        if optional.content:
            return optional.content
        return ServiceDeskOptionalContent()

    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            self.client.get_json(
                "/rest/servicedeskapi/servicedesk", params={"start": 0, "limit": 1}
            )
            result["status"] = "SUCCESS"
            result["message"] = "Successfully connected to Jira Service Management API."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Jira Service Management API: {exc}"
        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._reset_runtime_state()

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        requests = self._fetch_requests()
        sampled_requests = self._sample_requests(requests)

        pending_batch: list[SingleAssetScanResults] = []
        for request in sampled_requests:
            if self._aborted:
                break
            assets = self._extract_request_assets(request)
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

    def _fetch_requests(self) -> list[dict[str, Any]]:
        scope = self._optional().scope
        base_filters: dict[str, Any] = {}
        if scope:
            if scope.search_term:
                base_filters["searchTerm"] = str(scope.search_term)
            if scope.request_status:
                base_filters["requestStatus"] = str(scope.request_status)
            if scope.request_ownership:
                ownership = [
                    str(value).strip() for value in scope.request_ownership if str(value).strip()
                ]
                if ownership:
                    base_filters["requestOwnership"] = ownership
            if scope.organization_id is not None:
                base_filters["organizationId"] = int(scope.organization_id)

        service_desk_ids = [int(value) for value in (scope.service_desk_ids or [])] if scope else []
        request_type_ids = [int(value) for value in (scope.request_type_ids or [])] if scope else []

        result_by_key: dict[str, dict[str, Any]] = {}

        for filters in self._request_filter_combinations(
            base_filters, service_desk_ids, request_type_ids
        ):
            for item in self.client.iter_servicedesk_values(
                "/rest/servicedeskapi/request",
                params=filters,
                limit=50,
            ):
                key = str(item.get("issueKey") or item.get("issueId") or "")
                if key:
                    result_by_key[key] = item

        return list(result_by_key.values())

    def _request_filter_combinations(
        self,
        base_filters: dict[str, Any],
        service_desk_ids: list[int],
        request_type_ids: list[int],
    ) -> list[dict[str, Any]]:
        combinations: list[dict[str, Any]] = []
        if service_desk_ids and request_type_ids:
            for service_desk_id in service_desk_ids:
                for request_type_id in request_type_ids:
                    combinations.append(
                        {
                            **base_filters,
                            "serviceDeskId": service_desk_id,
                            "requestTypeId": request_type_id,
                        }
                    )
        elif service_desk_ids:
            for service_desk_id in service_desk_ids:
                combinations.append({**base_filters, "serviceDeskId": service_desk_id})
        elif request_type_ids:
            for request_type_id in request_type_ids:
                combinations.append({**base_filters, "requestTypeId": request_type_id})
        else:
            combinations.append(dict(base_filters))
        return combinations

    def _sample_requests(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sampling = self.config.sampling
        if sampling.strategy == SamplingStrategy.ALL:
            return requests

        limit = int(sampling.limit or 100)
        if limit >= len(requests):
            return requests

        if sampling.strategy == SamplingStrategy.RANDOM:
            return deterministic_sample(requests, limit)

        sorted_requests = sorted(
            requests,
            key=self._request_sort_timestamp,
            reverse=True,
        )
        return sorted_requests[:limit]

    def _request_sort_timestamp(self, request: dict[str, Any]) -> datetime:
        current_status = request.get("currentStatus")
        if isinstance(current_status, dict):
            status_date = current_status.get("statusDate")
            parsed = self._parse_date_dto(status_date)
            if parsed:
                return parsed
        return self._parse_date_dto(request.get("createdDate")) or datetime.now(UTC)

    def _extract_request_assets(self, request: dict[str, Any]) -> list[SingleAssetScanResults]:
        now = datetime.now(UTC)
        issue_key = str(request.get("issueKey") or request.get("issueId") or "")
        if not issue_key:
            return []

        request_url = self._request_external_url(request, issue_key)
        request_hash = self.generate_hash_id(request_url)
        summary = str(request.get("summary") or issue_key)

        body_text, body_urls = self._request_body_text_and_urls(request)
        comment_asset, comment_hashes, comment_urls = self._comments_asset(
            issue_key, request_url, now
        )
        attachment_assets, attachment_hashes = self._attachment_assets(issue_key, request_hash, now)

        all_url_hashes = [
            self.generate_hash_id(url)
            for url in (
                normalize_http_url(value, base_url=self.base_url)
                for value in [*body_urls, *comment_urls]
            )
            if url
        ]

        request_links = dedupe_preserve_order(
            [*comment_hashes, *attachment_hashes, *all_url_hashes]
        )

        request_metadata = {
            "issue_key": issue_key,
            "summary": summary,
            "current_status": self._status_name(request),
            "request_type": self._name_from_obj(request.get("requestType")),
            "service_desk": self._name_from_obj(request.get("serviceDesk")),
            "attachments_count": len(attachment_hashes),
            "links_count": len(request_links),
        }

        request_text_lines = [
            f"key={issue_key}",
            f"summary={summary}",
            f"status={self._status_name(request)}",
            f"service_desk={self._name_from_obj(request.get('serviceDesk'))}",
            f"request_type={self._name_from_obj(request.get('requestType'))}",
            "",
            body_text,
        ]
        request_text = "\n".join(line for line in request_text_lines if line).strip()
        self._asset_content_cache[request_hash] = (json_dumps(request_metadata), request_text)

        request_asset = SingleAssetScanResults(
            hash=request_hash,
            checksum=self.calculate_checksum(request_metadata),
            name=f"{issue_key}: {summary}",
            external_url=request_url,
            links=request_links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=self._parse_date_dto(request.get("createdDate")) or now,
            updated_at=self._request_sort_timestamp(request),
            runner_id=self.runner_id,
        )

        assets: list[SingleAssetScanResults] = [request_asset]
        if comment_asset:
            assets.append(comment_asset)
        assets.extend(attachment_assets)
        return assets

    def _request_external_url(self, request: dict[str, Any], issue_key: str) -> str:
        links = request.get("_links")
        if isinstance(links, dict):
            web_url = links.get("web")
            if isinstance(web_url, str):
                normalized = normalize_http_url(web_url, base_url=self.base_url)
                if normalized:
                    return normalized
        return f"{self.base_url}/browse/{issue_key}"

    def _request_body_text_and_urls(self, request: dict[str, Any]) -> tuple[str, list[str]]:
        lines: list[str] = []
        urls: list[str] = []
        field_values = request.get("requestFieldValues")
        if not isinstance(field_values, list):
            return "", []
        for field in field_values:
            if not isinstance(field, dict):
                continue
            label = str(field.get("label") or field.get("fieldId") or "field")
            value_text, value_urls = self._text_and_urls(field.get("value"))
            rendered_text, rendered_urls = self._text_and_urls(field.get("renderedValue"))
            content = value_text or rendered_text
            if content:
                lines.append(f"{label}: {content}")
            urls.extend(value_urls)
            urls.extend(rendered_urls)
        return "\n".join(lines), dedupe_preserve_order(urls)

    def _comments_asset(
        self,
        issue_key: str,
        request_url: str,
        now: datetime,
    ) -> tuple[SingleAssetScanResults | None, list[str], list[str]]:
        if not self.include_comments:
            return None, [], []

        comments = self.client.iter_servicedesk_values(
            f"/rest/servicedeskapi/request/{issue_key}/comment",
            limit=50,
        )
        if not comments:
            return None, [], []

        text_blocks: list[str] = []
        urls: list[str] = []
        for comment in comments:
            body = comment.get("body")
            if isinstance(body, str) and body.strip():
                text_blocks.append(body.strip())
                urls.extend(extract_urls_from_text(body))

        combined_text = "\n\n".join(block for block in text_blocks if block).strip()
        if not combined_text:
            return None, [], dedupe_preserve_order(urls)

        comments_url = f"{request_url}?view=comments"
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
            name=f"Comments for request {issue_key}",
            external_url=comments_url,
            links=comment_link_hashes,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )
        return asset, [comments_hash], urls

    def _attachment_assets(
        self,
        issue_key: str,
        request_hash: str,
        now: datetime,
    ) -> tuple[list[SingleAssetScanResults], list[str]]:
        if not self.include_attachments:
            return [], []

        attachments = self.client.iter_servicedesk_values(
            f"/rest/servicedeskapi/request/{issue_key}/attachment",
            limit=50,
        )
        assets: list[SingleAssetScanResults] = []
        hashes: list[str] = []
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            links = attachment.get("_links")
            content_url = links.get("content") if isinstance(links, dict) else None
            if not isinstance(content_url, str):
                continue
            normalized_url = normalize_http_url(content_url, base_url=self.base_url)
            if not normalized_url:
                continue

            attachment_hash = self.generate_hash_id(normalized_url)
            self._attachment_url_by_hash[attachment_hash] = normalized_url
            mime = str(attachment.get("mimeType") or "").lower()
            filename = str(attachment.get("filename") or "attachment")
            metadata = {
                "request_hash": request_hash,
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

    def _name_from_obj(self, value: Any) -> str:
        if isinstance(value, dict):
            name = value.get("name")
            if isinstance(name, str):
                return name
        return ""

    def _status_name(self, request: dict[str, Any]) -> str:
        current_status = request.get("currentStatus")
        if isinstance(current_status, dict):
            status = current_status.get("status")
            if isinstance(status, str):
                return status
        return ""

    def _parse_date_dto(self, value: Any) -> datetime | None:
        if isinstance(value, str):
            return parse_datetime(value)
        if isinstance(value, dict):
            for key in ("iso8601", "jira", "friendly"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return parse_datetime(candidate)
        return None

    def _text_and_urls(self, value: Any) -> tuple[str, list[str]]:
        if isinstance(value, str):
            return value, extract_urls_from_text(value)
        text, urls = parse_atlassian_document(value)
        return text, dedupe_preserve_order(urls + extract_urls_from_text(text))

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
            logger.warning("Failed to fetch Service Desk attachment %s: %s", attachment_url, exc)
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
        logger.info("Aborting Service Desk extraction...")
        super().abort()
        self.client.close()

    def cleanup(self) -> None:
        self.client.close()
