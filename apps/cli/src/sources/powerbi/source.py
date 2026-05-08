from __future__ import annotations

import json
import logging
import random
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from ...models.generated_input import (
    PowerBIInput,
    PowerBIMaskedAccessToken,
    PowerBIMaskedClientSecret,
    PowerBIOptionalConnection,
    PowerBIOptionalExtraction,
    PowerBIOptionalScope,
    PowerBIRequiredAccessToken,
    PowerBIRequiredServicePrincipal,
    SamplingConfig,
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
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PowerBIAssetRef:
    raw_id: str
    kind: str
    workspace_id: str
    workspace_name: str
    asset_id: str
    name: str
    external_url: str
    metadata: dict[str, Any]
    linked_raw_ids: list[str]
    created_at: datetime
    updated_at: datetime


class PowerBISource(BaseSource):
    source_type = "powerbi"

    API_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
    DEFAULT_AUTHORITY_URL = "https://login.microsoftonline.com"
    DEFAULT_API_BASE_URL = "https://api.powerbi.com/v1.0/myorg"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = PowerBIInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self.session = requests.Session()
        self._access_token: str | None = None
        self._access_token_expiry: datetime | None = None

        self._asset_lookup: dict[str, PowerBIAssetRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> PowerBIOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return PowerBIOptionalConnection()

    def _scope_options(self) -> PowerBIOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return PowerBIOptionalScope()

    def _extraction_options(self) -> PowerBIOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return PowerBIOptionalExtraction()

    def _is_service_principal_mode(self) -> bool:
        return isinstance(self.config.required, PowerBIRequiredServicePrincipal)

    def _is_access_token_mode(self) -> bool:
        return isinstance(self.config.required, PowerBIRequiredAccessToken)

    def _masked_client_secret(self) -> str:
        masked = self.config.masked
        if not isinstance(masked, PowerBIMaskedClientSecret):
            raise ValueError("POWERBI SERVICE_PRINCIPAL auth requires masked.client_secret")
        return masked.client_secret

    def _masked_access_token(self) -> str:
        masked = self.config.masked
        if not isinstance(masked, PowerBIMaskedAccessToken):
            raise ValueError("POWERBI ACCESS_TOKEN auth requires masked.access_token")
        return masked.access_token

    def _authority_url(self) -> str:
        configured = self._connection_options().authority_url
        base = str(configured) if configured is not None else self.DEFAULT_AUTHORITY_URL
        return base.rstrip("/")

    def _api_base_url(self) -> str:
        configured = self._connection_options().api_base_url
        base = str(configured) if configured is not None else self.DEFAULT_API_BASE_URL
        return base.rstrip("/")

    def _timeout_seconds(self) -> int:
        timeout = self._connection_options().timeout_seconds
        return int(timeout or 30)

    def _token_endpoint(self) -> str:
        required = self.config.required
        if not isinstance(required, PowerBIRequiredServicePrincipal):
            raise ValueError("Token endpoint is available only for SERVICE_PRINCIPAL mode")
        return f"{self._authority_url()}/{required.tenant_id}/oauth2/v2.0/token"

    def _normalize_bearer_token(self, token: str) -> str:
        cleaned = token.strip()
        if cleaned.lower().startswith("bearer "):
            return cleaned
        return f"Bearer {cleaned}"

    def _is_access_token_expired(self) -> bool:
        if self._access_token_expiry is None:
            return True
        return self._access_token_expiry <= datetime.now(UTC)

    def _acquire_service_principal_token(self) -> str:
        required = self.config.required
        if not isinstance(required, PowerBIRequiredServicePrincipal):
            raise ValueError("SERVICE_PRINCIPAL auth mode is required")

        payload = {
            "grant_type": "client_credentials",
            "client_id": required.client_id,
            "client_secret": self._masked_client_secret(),
            "scope": self.API_SCOPE,
        }

        response = self.session.post(
            self._token_endpoint(),
            data=payload,
            timeout=self._timeout_seconds(),
        )
        response.raise_for_status()

        body = response.json()
        token = body.get("access_token")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("PowerBI token response did not include access_token")

        expires_in = int(body.get("expires_in", 3600))
        safety_seconds = 300
        valid_for = max(expires_in - safety_seconds, 0)
        self._access_token_expiry = datetime.now(UTC) + timedelta(seconds=valid_for)

        return self._normalize_bearer_token(token)

    def _access_token_value(self) -> str:
        if self._is_access_token_mode():
            return self._normalize_bearer_token(self._masked_access_token())

        if self._access_token and not self._is_access_token_expired():
            return self._access_token

        self._access_token = self._acquire_service_principal_token()
        return self._access_token

    def _request_json(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = (
            path_or_url
            if path_or_url.startswith("http://") or path_or_url.startswith("https://")
            else f"{self._api_base_url()}/{path_or_url.lstrip('/')}"
        )

        headers = {
            "Authorization": self._access_token_value(),
            "Accept": "application/json",
        }

        try:
            response = self.session.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json_payload,
                timeout=self._timeout_seconds(),
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise RuntimeError(f"PowerBI request failed for {url}: {exc}") from exc

        if response.status_code == 204 or not response.text.strip():
            return {}

        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(f"PowerBI returned invalid JSON for {url}") from exc

    def _paged_values(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        collected: list[dict[str, Any]] = []

        next_url: str | None = path
        next_params = params
        while next_url:
            payload = self._request_json("get", next_url, params=next_params)
            values = payload.get("value", [])
            if isinstance(values, list):
                for item in values:
                    if isinstance(item, dict):
                        collected.append(item)

            potential_next = payload.get("@odata.nextLink")
            next_url = potential_next if isinstance(potential_next, str) else None
            next_params = None

        return collected

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

    def _workspace_allowlist_ids(self) -> set[str]:
        configured = self._scope_options().workspace_ids or []
        return {item.strip() for item in configured if item and item.strip()}

    def _workspace_allowlist_names(self) -> set[str]:
        configured = self._scope_options().workspace_names or []
        return {item.strip().lower() for item in configured if item and item.strip()}

    def _workspace_allowed(self, workspace: dict[str, Any]) -> bool:
        workspace_id = str(workspace.get("id") or "").strip()
        workspace_name = str(workspace.get("name") or "").strip()
        workspace_type = str(workspace.get("type") or "").strip().lower()

        allow_ids = self._workspace_allowlist_ids()
        allow_names = self._workspace_allowlist_names()

        if allow_ids and workspace_id not in allow_ids:
            return False
        if allow_names and workspace_name.lower() not in allow_names:
            return False

        include_personal = bool(self._scope_options().include_personal_workspaces)
        if not include_personal:
            if workspace_type in {"personal", "personalgroup"}:
                return False
            if workspace_name.lower() in {"my workspace"}:
                return False

        return bool(workspace_id)

    def _coerce_url(self, value: Any, fallback: str) -> str:
        candidate = str(value or "").strip()
        return candidate if candidate else fallback

    def _workspace_raw_id(self, workspace_id: str) -> str:
        return f"{workspace_id}_#_workspace"

    def _dataset_raw_id(self, workspace_id: str, dataset_id: str) -> str:
        return f"{workspace_id}_#_dataset_#_{dataset_id}"

    def _report_raw_id(self, workspace_id: str, report_id: str) -> str:
        return f"{workspace_id}_#_report_#_{report_id}"

    def _dashboard_raw_id(self, workspace_id: str, dashboard_id: str) -> str:
        return f"{workspace_id}_#_dashboard_#_{dashboard_id}"

    def _workspace_external_url(self, workspace_id: str) -> str:
        return f"https://app.powerbi.com/groups/{workspace_id}/list"

    def _dataset_external_url(self, workspace_id: str, dataset_id: str) -> str:
        return f"https://app.powerbi.com/groups/{workspace_id}/datasets/{dataset_id}/details"

    def _report_external_url(self, workspace_id: str, report_id: str) -> str:
        return f"https://app.powerbi.com/groups/{workspace_id}/reports/{report_id}"

    def _dashboard_external_url(self, workspace_id: str, dashboard_id: str) -> str:
        return f"https://app.powerbi.com/groups/{workspace_id}/dashboards/{dashboard_id}"

    def _list_workspaces(self) -> list[dict[str, Any]]:
        workspaces = self._paged_values("groups", params={"$top": 5000})
        return [workspace for workspace in workspaces if self._workspace_allowed(workspace)]

    def _list_datasets(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._paged_values(f"groups/{workspace_id}/datasets", params={"$top": 5000})

    def _list_reports(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._paged_values(f"groups/{workspace_id}/reports", params={"$top": 5000})

    def _list_dashboards(self, workspace_id: str) -> list[dict[str, Any]]:
        return self._paged_values(f"groups/{workspace_id}/dashboards", params={"$top": 5000})

    def _list_dataset_tables(
        self,
        workspace_id: str,
        dataset_id: str,
    ) -> list[dict[str, Any]]:
        try:
            return self._paged_values(
                f"groups/{workspace_id}/datasets/{dataset_id}/tables",
                params={"$top": 5000},
            )
        except Exception as exc:
            logger.debug(
                "Failed to list tables for dataset %s in workspace %s: %s",
                dataset_id,
                workspace_id,
                exc,
            )
            return []

    def _to_asset_ref(
        self,
        *,
        raw_id: str,
        kind: str,
        workspace_id: str,
        workspace_name: str,
        asset_id: str,
        name: str,
        external_url: str,
        metadata: dict[str, Any],
        linked_raw_ids: list[str] | None = None,
    ) -> PowerBIAssetRef:
        created_at = self._parse_datetime(metadata.get("createdDateTime")) or datetime.now(UTC)
        updated_at = (
            self._parse_datetime(metadata.get("modifiedDateTime"))
            or self._parse_datetime(metadata.get("lastUpdate"))
            or created_at
        )

        return PowerBIAssetRef(
            raw_id=raw_id,
            kind=kind,
            workspace_id=workspace_id,
            workspace_name=workspace_name,
            asset_id=asset_id,
            name=name,
            external_url=external_url,
            metadata=metadata,
            linked_raw_ids=list(linked_raw_ids or []),
            created_at=created_at,
            updated_at=updated_at,
        )

    def _discover_assets(self) -> list[PowerBIAssetRef]:
        extraction = self._extraction_options()
        refs: list[PowerBIAssetRef] = []

        for workspace in self._list_workspaces():
            if self._aborted:
                break

            workspace_id = str(workspace.get("id") or "").strip()
            workspace_name = str(workspace.get("name") or workspace_id)
            if not workspace_id:
                continue

            workspace_raw_id = self._workspace_raw_id(workspace_id)
            if extraction.extract_workspaces_to_containers is not False:
                refs.append(
                    self._to_asset_ref(
                        raw_id=workspace_raw_id,
                        kind="workspace",
                        workspace_id=workspace_id,
                        workspace_name=workspace_name,
                        asset_id=workspace_id,
                        name=workspace_name,
                        external_url=self._workspace_external_url(workspace_id),
                        metadata={
                            "workspace": workspace,
                            "extract_workspaces_to_containers": bool(
                                extraction.extract_workspaces_to_containers
                            ),
                        },
                    )
                )

            datasets = self._list_datasets(workspace_id)
            dataset_raw_by_id: dict[str, str] = {}
            extract_schema = extraction.extract_dataset_schema is not False

            for dataset in datasets:
                dataset_id = str(dataset.get("id") or "").strip()
                if not dataset_id:
                    continue

                dataset_raw_id = self._dataset_raw_id(workspace_id, dataset_id)
                dataset_raw_by_id[dataset_id] = dataset_raw_id

                metadata: dict[str, Any] = {
                    "workspace": {
                        "id": workspace_id,
                        "name": workspace_name,
                    },
                    "dataset": dataset,
                    "extract_datasets_to_containers": bool(
                        extraction.extract_datasets_to_containers
                    ),
                }
                if extract_schema:
                    tables = self._list_dataset_tables(workspace_id, dataset_id)
                    if tables:
                        metadata["tables"] = tables

                refs.append(
                    self._to_asset_ref(
                        raw_id=dataset_raw_id,
                        kind="dataset",
                        workspace_id=workspace_id,
                        workspace_name=workspace_name,
                        asset_id=dataset_id,
                        name=str(dataset.get("name") or dataset_id),
                        external_url=self._coerce_url(
                            dataset.get("webUrl"),
                            self._dataset_external_url(workspace_id, dataset_id),
                        ),
                        metadata=metadata,
                        linked_raw_ids=[workspace_raw_id],
                    )
                )

            if extraction.extract_reports is not False:
                for report in self._list_reports(workspace_id):
                    report_id = str(report.get("id") or "").strip()
                    if not report_id:
                        continue

                    raw_id = self._report_raw_id(workspace_id, report_id)
                    linked_raw_ids = [workspace_raw_id]
                    dataset_id = str(report.get("datasetId") or "").strip()
                    if dataset_id and dataset_id in dataset_raw_by_id:
                        linked_raw_ids.append(dataset_raw_by_id[dataset_id])

                    refs.append(
                        self._to_asset_ref(
                            raw_id=raw_id,
                            kind="report",
                            workspace_id=workspace_id,
                            workspace_name=workspace_name,
                            asset_id=report_id,
                            name=str(report.get("name") or report_id),
                            external_url=self._coerce_url(
                                report.get("webUrl"),
                                self._report_external_url(workspace_id, report_id),
                            ),
                            metadata={
                                "workspace": {
                                    "id": workspace_id,
                                    "name": workspace_name,
                                },
                                "report": report,
                            },
                            linked_raw_ids=linked_raw_ids,
                        )
                    )

            if extraction.extract_dashboards is not False:
                for dashboard in self._list_dashboards(workspace_id):
                    dashboard_id = str(dashboard.get("id") or "").strip()
                    if not dashboard_id:
                        continue

                    raw_id = self._dashboard_raw_id(workspace_id, dashboard_id)
                    refs.append(
                        self._to_asset_ref(
                            raw_id=raw_id,
                            kind="dashboard",
                            workspace_id=workspace_id,
                            workspace_name=workspace_name,
                            asset_id=dashboard_id,
                            name=str(
                                dashboard.get("displayName")
                                or dashboard.get("name")
                                or dashboard_id
                            ),
                            external_url=self._coerce_url(
                                dashboard.get("webUrl"),
                                self._dashboard_external_url(workspace_id, dashboard_id),
                            ),
                            metadata={
                                "workspace": {
                                    "id": workspace_id,
                                    "name": workspace_name,
                                },
                                "dashboard": dashboard,
                            },
                            linked_raw_ids=[workspace_raw_id],
                        )
                    )

        return refs

    def _sampling_sort_datetime(self, ref: PowerBIAssetRef, field_name: str) -> datetime | None:
        candidates = [
            ref.metadata.get(field_name),
            ref.metadata.get("report", {}).get(field_name),
            ref.metadata.get("dataset", {}).get(field_name),
            ref.metadata.get("dashboard", {}).get(field_name),
            ref.metadata.get("workspace", {}).get(field_name),
        ]
        for value in candidates:
            parsed = self._parse_datetime(value)
            if parsed is not None:
                return parsed
        return None

    def _sample_refs(self, refs: list[PowerBIAssetRef]) -> list[PowerBIAssetRef]:
        sampling = self._sampling()
        if sampling.strategy == SamplingStrategy.ALL:
            return refs

        if sampling.strategy == SamplingStrategy.RANDOM:
            limit = int(sampling.rows_per_page or 100)
            if limit >= len(refs):
                return refs
            generator = random.Random(0)
            sampled_indexes = sorted(generator.sample(range(len(refs)), k=limit))
            return [refs[index] for index in sampled_indexes]

        order_field = sampling.order_by_column or "modifiedDateTime"
        values = [self._sampling_sort_datetime(ref, order_field) for ref in refs]
        has_order_values = any(value is not None for value in values)

        if not has_order_values and sampling.fallback_to_random is not False:
            generator = random.Random(0)
            limit = int(sampling.rows_per_page or 100)
            sampled_indexes = sorted(generator.sample(range(len(refs)), k=limit))
            return [refs[index] for index in sampled_indexes]

        scored: list[tuple[bool, datetime, PowerBIAssetRef]] = []
        for ref, parsed in zip(refs, values, strict=False):
            effective = parsed or ref.updated_at
            scored.append((parsed is not None, effective, ref))

        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        limit = int(sampling.rows_per_page or 100)
        return [item[2] for item in scored[:limit]]

    def _asset_from_ref(
        self,
        ref: PowerBIAssetRef,
        *,
        links: list[str],
    ) -> SingleAssetScanResults:
        asset_hash = self.generate_hash_id(ref.raw_id)
        checksum_payload = {
            "kind": ref.kind,
            "workspace_id": ref.workspace_id,
            "workspace_name": ref.workspace_name,
            "asset_id": ref.asset_id,
            "name": ref.name,
            "metadata": ref.metadata,
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_payload),
            name=f"{ref.workspace_name} / {ref.kind} / {ref.name}",
            external_url=self.ensure_location(
                ref.external_url,
                fallback=self._workspace_external_url(ref.workspace_id),
            ),
            links=links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=ref.created_at,
            updated_at=ref.updated_at,
            runner_id=self.runner_id,
        )

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to PowerBI...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            workspaces = self._list_workspaces()
            auth_mode = "SERVICE_PRINCIPAL" if self._is_service_principal_mode() else "ACCESS_TOKEN"
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to PowerBI using {auth_mode}. "
                f"Reachable workspaces: {len(workspaces)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to PowerBI: {exc}"

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
                    async for processed in pipeline.process_stream(batch):
                        yield [processed]
                else:
                    yield batch
                batch = []

        if batch:
            if pipeline:
                async for processed in pipeline.process_stream(batch):
                    yield [processed]
            else:
                yield batch

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self._asset_type_value(), asset_id)

    def _format_asset_content(self, ref: PowerBIAssetRef) -> tuple[str, str]:
        sampling = self._sampling()
        lines: list[str] = [
            f"workspace={ref.workspace_name}",
            f"workspace_id={ref.workspace_id}",
            f"kind={ref.kind}",
            f"name={ref.name}",
            f"sampling_strategy={sampling.strategy}",
            "",
        ]

        if ref.kind == "dataset":
            tables = ref.metadata.get("tables")
            if isinstance(tables, list) and tables:
                lines.append(f"dataset_tables={len(tables)}")
                for table in tables[:20]:
                    if not isinstance(table, dict):
                        continue
                    table_name = str(table.get("name") or "")
                    columns = table.get("columns", [])
                    column_names = [
                        str(column.get("name"))
                        for column in columns
                        if isinstance(column, dict) and column.get("name")
                    ]
                    rendered_columns = ", ".join(column_names[:20])
                    lines.append(f"table={table_name}; columns={rendered_columns}")

        if ref.kind == "report":
            dataset_id = ref.metadata.get("report", {}).get("datasetId")
            if dataset_id:
                lines.append(f"dataset_id={dataset_id}")

        text_content = "\n".join(lines)
        raw_content = json.dumps(
            {
                "kind": ref.kind,
                "workspace_id": ref.workspace_id,
                "workspace_name": ref.workspace_name,
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

            if decoded.startswith("POWERBI_#_"):
                decoded = decoded[len("POWERBI_#_") :]

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

        finding.location = Location(path=f"{ref.workspace_name}/{ref.kind}/{ref.name}")

    def abort(self) -> None:
        logger.info("Aborting PowerBI extraction...")
        super().abort()

    def cleanup(self) -> None:
        try:
            self.session.close()
        except Exception:
            logger.debug("Failed to close PowerBI session cleanly", exc_info=True)
