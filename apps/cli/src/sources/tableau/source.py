from __future__ import annotations

import json
import logging
import random
from collections.abc import AsyncGenerator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin

from requests.adapters import HTTPAdapter
from urllib3 import Retry

from ...models.generated_input import (
    SamplingConfig,
    SamplingStrategy,
    TableauInput,
    TableauMaskedPersonalAccessToken,
    TableauMaskedUsernamePassword,
    TableauOptionalConnection,
    TableauOptionalExtraction,
    TableauOptionalScope,
    TableauRequiredPersonalAccessToken,
    TableauRequiredUsernamePassword,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_RETRIABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]


@dataclass(frozen=True)
class TableauAssetRef:
    raw_id: str
    kind: str
    site: str
    project_name: str | None
    asset_id: str
    name: str
    external_url: str
    metadata: dict[str, Any]
    linked_raw_ids: list[str]
    created_at: datetime
    updated_at: datetime


class TableauSource(BaseSource):
    source_type = "tableau"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = TableauInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._tsc = require_module(
            module_name="tableauserverclient",
            source_name="Tableau",
            uv_groups=["tableau"],
            detail="The Tableau connector is optional.",
        )
        self._asset_lookup: dict[str, TableauAssetRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._owner_cache: dict[str, dict[str, Any]] = {}

        self._validate_auth_configuration()

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, TableauRequiredUsernamePassword):
            if not isinstance(masked, TableauMaskedUsernamePassword):
                raise ValueError(
                    "TABLEAU USERNAME_PASSWORD auth requires masked.username and masked.password"
                )
            return

        if isinstance(required, TableauRequiredPersonalAccessToken):
            if not isinstance(masked, TableauMaskedPersonalAccessToken):
                raise ValueError("TABLEAU PERSONAL_ACCESS_TOKEN auth requires masked.token_value")
            return

        raise ValueError("Unsupported TABLEAU auth configuration")

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> TableauOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return TableauOptionalConnection()

    def _scope_options(self) -> TableauOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return TableauOptionalScope()

    def _extraction_options(self) -> TableauOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return TableauOptionalExtraction()

    def _connect_uri(self) -> str:
        return str(self.config.required.connect_uri).rstrip("/")

    def _site(self) -> str:
        return self.config.required.site

    def _site_for_display(self) -> str:
        site = self._site().strip()
        return site if site else "default"

    def _timeout_seconds(self) -> int:
        timeout = self._connection_options().timeout_seconds
        return int(timeout or 30)

    def _request_options(self, page_number: int):
        request_options = self._tsc.RequestOptions()
        request_options.page_size = 100
        request_options.page_number = page_number
        # Compatibility across tableauserverclient versions.
        request_options.pagesize = 100
        request_options.pagenumber = page_number
        return request_options

    def _build_auth(self) -> Any:
        required = self.config.required
        masked = self.config.masked
        site = self._site()

        if isinstance(required, TableauRequiredUsernamePassword):
            if not isinstance(masked, TableauMaskedUsernamePassword):
                raise ValueError(
                    "TABLEAU USERNAME_PASSWORD auth requires masked.username and masked.password"
                )
            return self._tsc.TableauAuth(
                username=masked.username,
                password=masked.password,
                site_id=site,
            )

        if isinstance(required, TableauRequiredPersonalAccessToken):
            if not isinstance(masked, TableauMaskedPersonalAccessToken):
                raise ValueError("TABLEAU PERSONAL_ACCESS_TOKEN auth requires masked.token_value")
            return self._tsc.PersonalAccessTokenAuth(
                required.token_name,
                masked.token_value,
                site,
            )

        raise ValueError("Unsupported TABLEAU auth configuration")

    def _build_server(self) -> Any:
        connection_options = self._connection_options()
        ssl_verify = connection_options.ssl_verify
        http_options: dict[str, Any] = {
            "verify": bool(ssl_verify) if not isinstance(ssl_verify, str) else ssl_verify,
            "timeout": self._timeout_seconds(),
        }

        server = self._tsc.Server(
            self._connect_uri(),
            use_server_version=True,
            http_options=http_options,
        )

        if hasattr(server, "_session"):
            server._session.trust_env = bool(connection_options.session_trust_env)

            adapter = HTTPAdapter(
                max_retries=Retry(
                    total=int(connection_options.max_retries or 3),
                    backoff_factor=1,
                    status_forcelist=_RETRIABLE_STATUS_CODES,
                )
            )
            server._session.mount("http://", adapter)
            server._session.mount("https://", adapter)

        return server

    @contextmanager
    def _signed_in_server(self):
        server = self._build_server()
        auth = self._build_auth()
        server.auth.sign_in(auth)
        try:
            yield server
        finally:
            try:
                server.auth.sign_out()
            except Exception:
                logger.debug("Failed to sign out Tableau session cleanly", exc_info=True)

    def _paged_items(self, endpoint: Any) -> list[Any]:
        pager = getattr(self._tsc, "Pager", None)
        if pager is not None:
            try:
                return list(pager(endpoint))
            except Exception:
                logger.debug("Tableau Pager fallback to manual pagination", exc_info=True)

        items: list[Any] = []
        page_number = 1
        while True:
            request_options = self._request_options(page_number)
            response = endpoint.get(request_options)
            if not isinstance(response, tuple) or len(response) != 2:
                if isinstance(response, list):
                    items.extend(response)
                break

            page_items, pagination = response
            if page_items:
                items.extend(page_items)

            total = int(
                getattr(
                    pagination,
                    "total_available",
                    getattr(pagination, "totalAvailable", len(items)),
                )
            )
            page_size = int(
                getattr(
                    pagination,
                    "page_size",
                    getattr(pagination, "pagesize", len(page_items) or 1),
                )
            )
            current_page = int(
                getattr(
                    pagination,
                    "page_number",
                    getattr(pagination, "pagenumber", page_number),
                )
            )
            if current_page * page_size >= total:
                break

            page_number = current_page + 1

        return items

    def _project_allowlist(self) -> set[str]:
        configured = self._scope_options().project_names or []
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _workbook_allowlist(self) -> set[str]:
        configured = self._scope_options().workbook_names or []
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _datasource_allowlist(self) -> set[str]:
        configured = self._scope_options().datasource_names or []
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _project_allowed(self, project_name: str) -> bool:
        allowlist = self._project_allowlist()
        if not allowlist:
            return True
        return project_name.strip().lower() in allowlist

    def _workbook_allowed(self, workbook_name: str) -> bool:
        allowlist = self._workbook_allowlist()
        if not allowlist:
            return True
        return workbook_name.strip().lower() in allowlist

    def _datasource_allowed(self, datasource_name: str) -> bool:
        allowlist = self._datasource_allowlist()
        if not allowlist:
            return True
        return datasource_name.strip().lower() in allowlist

    def _coerce_external_url(self, value: Any, fallback: str) -> str:
        candidate = str(value or "").strip()
        if not candidate:
            return fallback
        if candidate.startswith("http://") or candidate.startswith("https://"):
            return candidate
        return urljoin(f"{self._connect_uri()}/", candidate)

    def _parse_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=UTC)

        if isinstance(value, str):
            cleaned = value.strip()
            if not cleaned:
                return None
            normalized = cleaned.replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
            except ValueError:
                return None
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)

        return None

    def _project_raw_id(self, project_id: str) -> str:
        return f"{self._site_for_display()}_#_project_#_{project_id}"

    def _workbook_raw_id(self, workbook_id: str) -> str:
        return f"{self._site_for_display()}_#_workbook_#_{workbook_id}"

    def _datasource_raw_id(self, datasource_id: str) -> str:
        return f"{self._site_for_display()}_#_datasource_#_{datasource_id}"

    def _project_fallback_url(self, project_id: str) -> str:
        return f"{self._connect_uri()}/#/site/{self._site_for_display()}/projects/{project_id}"

    def _workbook_fallback_url(self, workbook_id: str) -> str:
        return f"{self._connect_uri()}/#/site/{self._site_for_display()}/workbooks/{workbook_id}"

    def _datasource_fallback_url(self, datasource_id: str) -> str:
        return (
            f"{self._connect_uri()}/#/site/{self._site_for_display()}/datasources/{datasource_id}"
        )

    def _resolve_owner_metadata(self, server: Any, owner_id: str | None) -> dict[str, Any] | None:
        if not owner_id:
            return None
        if owner_id in self._owner_cache:
            return self._owner_cache[owner_id]

        try:
            user = server.users.get_by_id(owner_id)
        except Exception:
            logger.debug("Unable to resolve Tableau owner for %s", owner_id, exc_info=True)
            self._owner_cache[owner_id] = {"id": owner_id}
            return self._owner_cache[owner_id]

        owner = {
            "id": owner_id,
            "name": str(getattr(user, "name", "") or "").strip() or None,
            "full_name": str(getattr(user, "full_name", "") or "").strip() or None,
            "email": str(getattr(user, "email", "") or "").strip() or None,
        }
        self._owner_cache[owner_id] = owner
        return owner

    def _extract_tags(self, endpoint: Any, item: Any) -> list[str]:
        if not bool(self._extraction_options().ingest_tags):
            return []

        try:
            endpoint.populate_tags(item)
        except Exception:
            logger.debug("Unable to populate Tableau tags for %s", item, exc_info=True)

        tags: list[str] = []
        for tag in getattr(item, "tags", []) or []:
            label = str(getattr(tag, "name", "") or "").strip()
            if label:
                tags.append(label)
        return tags

    def _to_asset_ref(
        self,
        *,
        raw_id: str,
        kind: str,
        asset_id: str,
        name: str,
        project_name: str | None,
        external_url: str,
        metadata: dict[str, Any],
        linked_raw_ids: list[str] | None = None,
    ) -> TableauAssetRef:
        created_at = self._parse_datetime(metadata.get("created_at")) or datetime.now(UTC)
        updated_at = self._parse_datetime(metadata.get("updated_at")) or created_at
        return TableauAssetRef(
            raw_id=raw_id,
            kind=kind,
            site=self._site_for_display(),
            project_name=project_name,
            asset_id=asset_id,
            name=name,
            external_url=external_url,
            metadata=metadata,
            linked_raw_ids=list(linked_raw_ids or []),
            created_at=created_at,
            updated_at=updated_at,
        )

    def _discover_assets(self) -> list[TableauAssetRef]:
        refs: list[TableauAssetRef] = []
        scope = self._scope_options()
        extraction = self._extraction_options()

        with self._signed_in_server() as server:
            projects = self._paged_items(server.projects)
            project_raw_by_id: dict[str, str] = {}
            project_name_by_id: dict[str, str] = {}

            for project in projects:
                if self._aborted:
                    break

                project_id = str(getattr(project, "id", "") or "").strip()
                project_name = str(getattr(project, "name", "") or "").strip()
                if not project_id or not project_name:
                    continue
                if not self._project_allowed(project_name):
                    continue

                raw_id = self._project_raw_id(project_id)
                project_raw_by_id[project_id] = raw_id
                project_name_by_id[project_id] = project_name
                refs.append(
                    self._to_asset_ref(
                        raw_id=raw_id,
                        kind="project",
                        asset_id=project_id,
                        name=project_name,
                        project_name=project_name,
                        external_url=self._project_fallback_url(project_id),
                        metadata={
                            "site": self._site_for_display(),
                            "project_id": project_id,
                            "project_name": project_name,
                        },
                    )
                )

            include_workbooks = scope.include_workbooks is not False
            if include_workbooks:
                for workbook in self._paged_items(server.workbooks):
                    if self._aborted:
                        break

                    workbook_id = str(getattr(workbook, "id", "") or "").strip()
                    workbook_name = str(getattr(workbook, "name", "") or "").strip()
                    if (
                        not workbook_id
                        or not workbook_name
                        or not self._workbook_allowed(workbook_name)
                    ):
                        continue

                    project_id = str(getattr(workbook, "project_id", "") or "").strip()
                    project_name = str(getattr(workbook, "project_name", "") or "").strip() or None
                    if project_name and not self._project_allowed(project_name):
                        continue
                    if project_id and not project_name:
                        project_name = project_name_by_id.get(project_id)

                    tags = self._extract_tags(server.workbooks, workbook)
                    owner_id = str(getattr(workbook, "owner_id", "") or "").strip() or None

                    metadata: dict[str, Any] = {
                        "site": self._site_for_display(),
                        "project_id": project_id or None,
                        "project_name": project_name,
                        "created_at": getattr(workbook, "created_at", None),
                        "updated_at": getattr(workbook, "updated_at", None),
                    }
                    if extraction.ingest_tags:
                        metadata["tags"] = tags
                    if extraction.ingest_owner:
                        metadata["owner"] = self._resolve_owner_metadata(server, owner_id)
                    if extraction.extract_usage_stats:
                        metadata["usage"] = {
                            "total_views": int(getattr(workbook, "total_views", 0) or 0)
                        }

                    linked: list[str] = []
                    if project_id and project_id in project_raw_by_id:
                        linked.append(project_raw_by_id[project_id])

                    refs.append(
                        self._to_asset_ref(
                            raw_id=self._workbook_raw_id(workbook_id),
                            kind="workbook",
                            asset_id=workbook_id,
                            name=workbook_name,
                            project_name=project_name,
                            external_url=self._coerce_external_url(
                                getattr(workbook, "webpage_url", None),
                                self._workbook_fallback_url(workbook_id),
                            ),
                            metadata=metadata,
                            linked_raw_ids=linked,
                        )
                    )

            include_datasources = scope.include_datasources is not False
            if include_datasources:
                for datasource in self._paged_items(server.datasources):
                    if self._aborted:
                        break

                    datasource_id = str(getattr(datasource, "id", "") or "").strip()
                    datasource_name = str(getattr(datasource, "name", "") or "").strip()
                    if (
                        not datasource_id
                        or not datasource_name
                        or not self._datasource_allowed(datasource_name)
                    ):
                        continue

                    project_id = str(getattr(datasource, "project_id", "") or "").strip()
                    project_name = (
                        str(getattr(datasource, "project_name", "") or "").strip() or None
                    )
                    if project_name and not self._project_allowed(project_name):
                        continue
                    if project_id and not project_name:
                        project_name = project_name_by_id.get(project_id)

                    tags = self._extract_tags(server.datasources, datasource)
                    owner_id = str(getattr(datasource, "owner_id", "") or "").strip() or None

                    metadata = {
                        "site": self._site_for_display(),
                        "project_id": project_id or None,
                        "project_name": project_name,
                        "created_at": getattr(datasource, "created_at", None),
                        "updated_at": getattr(datasource, "updated_at", None),
                    }
                    if extraction.ingest_tags:
                        metadata["tags"] = tags
                    if extraction.ingest_owner:
                        metadata["owner"] = self._resolve_owner_metadata(server, owner_id)
                    if extraction.extract_usage_stats:
                        metadata["usage"] = {
                            "total_views": int(getattr(datasource, "total_views", 0) or 0)
                        }

                    linked = []
                    if project_id and project_id in project_raw_by_id:
                        linked.append(project_raw_by_id[project_id])

                    refs.append(
                        self._to_asset_ref(
                            raw_id=self._datasource_raw_id(datasource_id),
                            kind="datasource",
                            asset_id=datasource_id,
                            name=datasource_name,
                            project_name=project_name,
                            external_url=self._coerce_external_url(
                                getattr(datasource, "webpage_url", None),
                                self._datasource_fallback_url(datasource_id),
                            ),
                            metadata=metadata,
                            linked_raw_ids=linked,
                        )
                    )

        refs.sort(key=lambda ref: (ref.kind, ref.name.lower(), ref.asset_id))
        return refs

    def _sampling_sort_datetime(self, ref: TableauAssetRef, field_name: str) -> datetime | None:
        candidates = [
            ref.metadata.get(field_name),
            ref.metadata.get(field_name.lower()),
            ref.metadata.get(field_name.upper()),
            ref.metadata.get("updated_at"),
            ref.metadata.get("created_at"),
        ]
        for candidate in candidates:
            parsed = self._parse_datetime(candidate)
            if parsed is not None:
                return parsed
        return None

    def _sample_refs(self, refs: list[TableauAssetRef]) -> list[TableauAssetRef]:
        sampling = self._sampling()
        if sampling.strategy == SamplingStrategy.ALL:
            return refs

        limit = int(sampling.rows_per_page or 100)
        if limit >= len(refs):
            return refs

        if sampling.strategy == SamplingStrategy.RANDOM:
            generator = random.Random(0)
            sampled_indexes = sorted(generator.sample(range(len(refs)), k=limit))
            return [refs[index] for index in sampled_indexes]

        order_field = sampling.order_by_column or "updated_at"
        values = [self._sampling_sort_datetime(ref, order_field) for ref in refs]
        has_order_values = any(value is not None for value in values)

        if not has_order_values and sampling.fallback_to_random is not False:
            generator = random.Random(0)
            sampled_indexes = sorted(generator.sample(range(len(refs)), k=limit))
            return [refs[index] for index in sampled_indexes]

        scored: list[tuple[bool, datetime, TableauAssetRef]] = []
        for ref, parsed in zip(refs, values, strict=False):
            effective = parsed or ref.updated_at
            scored.append((parsed is not None, effective, ref))

        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return [item[2] for item in scored[:limit]]

    def _asset_from_ref(
        self,
        ref: TableauAssetRef,
        *,
        links: list[str],
    ) -> SingleAssetScanResults:
        asset_hash = self.generate_hash_id(ref.raw_id)
        checksum_payload = {
            "kind": ref.kind,
            "site": ref.site,
            "project_name": ref.project_name,
            "asset_id": ref.asset_id,
            "name": ref.name,
            "metadata": ref.metadata,
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_payload),
            name=f"{ref.site} / {ref.kind} / {ref.name}",
            external_url=self.ensure_location(ref.external_url, fallback=self._connect_uri()),
            links=links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=ref.created_at,
            updated_at=ref.updated_at,
            runner_id=self.runner_id,
        )

    def _auth_mode(self) -> str:
        mode = self.config.required.auth_mode
        return mode.value if hasattr(mode, "value") else str(mode)

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Tableau...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            with self._signed_in_server() as server:
                projects = self._paged_items(server.projects)
                result["status"] = "SUCCESS"
                result["message"] = (
                    f"Successfully connected to Tableau using {self._auth_mode()}. "
                    f"Reachable projects: {len(projects)}."
                )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Tableau: {exc}"

        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        refs = self._sample_refs(self._discover_assets())
        hash_by_raw = {ref.raw_id: self.generate_hash_id(ref.raw_id) for ref in refs}

        batch: list[SingleAssetScanResults] = []
        for ref in refs:
            if self._aborted:
                return

            asset_hash = hash_by_raw[ref.raw_id]
            self._asset_lookup[asset_hash] = ref

            linked_hashes = [
                hash_by_raw[linked_raw_id]
                for linked_raw_id in ref.linked_raw_ids
                if linked_raw_id in hash_by_raw
            ]
            batch.append(self._asset_from_ref(ref, links=linked_hashes))

            if len(batch) >= self.BATCH_SIZE:
                if pipeline:
                    batch = await pipeline.process(batch)
                yield batch
                batch = []

        if batch:
            if pipeline:
                batch = await pipeline.process(batch)
            yield batch

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self._asset_type_value(), asset_id)

    def _format_asset_content(self, ref: TableauAssetRef) -> tuple[str, str]:
        sampling = self._sampling()
        lines = [
            f"site={ref.site}",
            f"kind={ref.kind}",
            f"name={ref.name}",
            f"project_name={ref.project_name or ''}",
            f"sampling_strategy={sampling.strategy}",
            "",
        ]

        tags = ref.metadata.get("tags")
        if isinstance(tags, list) and tags:
            lines.append(f"tags={', '.join(str(tag) for tag in tags)}")

        owner = ref.metadata.get("owner")
        if isinstance(owner, dict):
            owner_name = owner.get("name") or owner.get("email") or owner.get("id")
            if owner_name:
                lines.append(f"owner={owner_name}")

        usage = ref.metadata.get("usage")
        if isinstance(usage, dict):
            total_views = usage.get("total_views")
            if total_views is not None:
                lines.append(f"total_views={total_views}")

        text_content = "\n".join(lines)
        raw_content = json.dumps(
            {
                "kind": ref.kind,
                "site": ref.site,
                "project_name": ref.project_name,
                "asset_id": ref.asset_id,
                "name": ref.name,
                "metadata": ref.metadata,
            },
            ensure_ascii=False,
            default=str,
        )
        return raw_content, text_content

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        ref = self._asset_lookup.get(asset_id)
        if ref is None:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

            if decoded.startswith("TABLEAU_#_"):
                decoded = decoded[len("TABLEAU_#_") :]

            for known_ref in self._asset_lookup.values():
                if known_ref.raw_id == decoded:
                    ref = known_ref
                    break

        if ref is None:
            return None

        content = self._format_asset_content(ref)
        self._content_cache[asset_id] = content
        return content

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        _ = text_content
        ref = self._asset_lookup.get(asset.hash)
        if not ref:
            return

        project_prefix = f"{ref.project_name}/" if ref.project_name else ""
        finding.location = Location(path=f"{ref.site}/{project_prefix}{ref.kind}/{ref.name}")

    def abort(self) -> None:
        logger.info("Aborting Tableau extraction...")
        super().abort()

    def cleanup(self) -> None:
        self._content_cache.clear()
        self._asset_lookup.clear()
        self._owner_cache.clear()
