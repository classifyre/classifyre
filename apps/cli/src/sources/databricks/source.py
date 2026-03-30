from __future__ import annotations

import json
import logging
from collections import deque
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import requests

from ...models.generated_input import (
    DatabricksInput,
    DatabricksMaskedPat,
    DatabricksMaskedServicePrincipal,
    DatabricksOptionalConnection,
    DatabricksOptionalExtraction,
    DatabricksOptionalScope,
    DatabricksRequiredPat,
    DatabricksRequiredServicePrincipal,
    SamplingConfig,
    SamplingStrategy,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    SingleAssetScanResults,
)
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource
from ..dependencies import require_module
from ..tabular_utils import build_tabular_location, format_tabular_sample_content

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_CATALOGS = {"system"}
_DEFAULT_EXCLUDED_SCHEMAS = {"information_schema"}


@dataclass(frozen=True)
class TableRef:
    catalog: str
    schema: str
    table: str
    object_type: str


@dataclass(frozen=True)
class NotebookRef:
    path: str
    object_id: str | None
    language: str | None
    created_at_ms: int | None
    modified_at_ms: int | None


@dataclass(frozen=True)
class PipelineRef:
    pipeline_id: str
    name: str
    state: str | None


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    if max_chars <= 3:
        return value[:max_chars]
    return f"{value[: max_chars - 3]}..."


class DatabricksSource(BaseSource):
    source_type = "databricks"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = DatabricksInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._databricks_sql = require_module(
            module_name="databricks.sql",
            source_name="Databricks",
            uv_groups=["databricks"],
            detail="The Databricks SQL connector is optional.",
        )

        self._validate_auth_configuration()

        self.session = requests.Session()
        self._access_token: str | None = None
        self._access_token_expiry: datetime | None = None

        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, DatabricksRequiredPat):
            if not isinstance(masked, DatabricksMaskedPat):
                raise ValueError("DATABRICKS PAT_TOKEN auth requires masked.token")
            return

        if isinstance(required, DatabricksRequiredServicePrincipal):
            if not isinstance(masked, DatabricksMaskedServicePrincipal):
                raise ValueError("DATABRICKS SERVICE_PRINCIPAL auth requires masked.client_secret")
            return

        raise ValueError("Unsupported DATABRICKS auth configuration")

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> DatabricksOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return DatabricksOptionalConnection()

    def _scope_options(self) -> DatabricksOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return DatabricksOptionalScope()

    def _extraction_options(self) -> DatabricksOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return DatabricksOptionalExtraction()

    def _workspace_url(self) -> str:
        return str(self.config.required.workspace_url).rstrip("/")

    def _workspace_host(self) -> str:
        parsed = urlparse(self._workspace_url())
        return parsed.netloc

    def _warehouse_id(self) -> str:
        return self.config.required.warehouse_id

    def _timeout_seconds(self) -> int:
        timeout = self._connection_options().timeout_seconds
        return int(timeout or 30)

    def _statement_timeout_seconds(self) -> int:
        timeout = self._connection_options().statement_timeout_seconds
        return int(timeout or 60)

    def _is_pat_mode(self) -> bool:
        return isinstance(self.config.required, DatabricksRequiredPat)

    def _masked_pat_token(self) -> str:
        masked = self.config.masked
        if not isinstance(masked, DatabricksMaskedPat):
            raise ValueError("DATABRICKS PAT_TOKEN auth requires masked.token")
        return masked.token

    def _service_principal_credentials(self) -> tuple[str, str]:
        required = self.config.required
        masked = self.config.masked
        if not isinstance(required, DatabricksRequiredServicePrincipal):
            raise ValueError("SERVICE_PRINCIPAL auth mode is required")
        if not isinstance(masked, DatabricksMaskedServicePrincipal):
            raise ValueError("DATABRICKS SERVICE_PRINCIPAL auth requires masked.client_secret")
        return required.client_id, masked.client_secret

    def _is_access_token_expired(self) -> bool:
        if self._access_token_expiry is None:
            return True
        return self._access_token_expiry <= datetime.now(UTC)

    def _acquire_service_principal_token(self) -> str:
        client_id, client_secret = self._service_principal_credentials()

        response = self.session.post(
            f"{self._workspace_url()}/oidc/v1/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "all-apis",
            },
            timeout=self._timeout_seconds(),
        )
        response.raise_for_status()

        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("Databricks token response did not include access_token")

        expires_in = int(payload.get("expires_in", 3600))
        safety_seconds = 300
        valid_for_seconds = max(expires_in - safety_seconds, 0)
        self._access_token_expiry = datetime.now(UTC) + timedelta(seconds=valid_for_seconds)

        return token.strip()

    def _access_token_value(self) -> str:
        if self._is_pat_mode():
            return self._masked_pat_token().strip()

        if self._access_token and not self._is_access_token_expired():
            return self._access_token

        self._access_token = self._acquire_service_principal_token()
        return self._access_token

    def _authorization_header(self) -> str:
        return f"Bearer {self._access_token_value()}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = (
            path
            if path.startswith("http://") or path.startswith("https://")
            else f"{self._workspace_url()}/{path.lstrip('/')}"
        )

        headers = {
            "Authorization": self._authorization_header(),
            "Accept": "application/json",
        }

        response = self.session.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            json=json_payload,
            timeout=self._timeout_seconds(),
        )
        response.raise_for_status()

        if response.status_code == 204 or not response.text.strip():
            return {}

        return response.json()

    def _paged_values(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        value_keys: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        collected: list[dict[str, Any]] = []

        next_page_token: str | None = None
        while True:
            current_params = dict(params or {})
            if next_page_token:
                current_params["page_token"] = next_page_token

            payload = self._request_json("get", path, params=current_params)
            values: Any = None
            for key in value_keys:
                candidate = payload.get(key)
                if isinstance(candidate, list):
                    values = candidate
                    break

            if isinstance(values, list):
                for entry in values:
                    if isinstance(entry, dict):
                        collected.append(entry)

            token = payload.get("next_page_token")
            if not isinstance(token, str) or not token.strip():
                break
            next_page_token = token

        return collected

    def _connect_sql(self):
        return self._databricks_sql.connect(
            server_hostname=self._workspace_host(),
            http_path=f"/sql/1.0/warehouses/{self._warehouse_id()}",
            access_token=self._access_token_value(),
        )

    def _catalog_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_catalogs
        if not configured:
            return None
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _catalog_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_catalogs or []
        denylist = {entry.strip().lower() for entry in configured if entry and entry.strip()}
        if not denylist:
            denylist = set(_DEFAULT_EXCLUDED_CATALOGS)
        return denylist

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {entry.strip().lower() for entry in configured if entry and entry.strip()}
        if not denylist:
            denylist = set(_DEFAULT_EXCLUDED_SCHEMAS)
        return denylist

    def _table_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_tables
        if not configured:
            return None
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _catalog_allowed(self, catalog: str) -> bool:
        normalized = catalog.lower()

        if normalized in self._catalog_denylist():
            return False

        if normalized == "hive_metastore" and not self._scope_options().include_hive_metastore:
            return False

        allowlist = self._catalog_allowlist()
        if allowlist and normalized not in allowlist:
            return False
        return True

    def _schema_allowed(self, catalog: str, schema: str) -> bool:
        scoped_schema = f"{catalog}.{schema}".lower()

        denylist = self._schema_denylist()
        if schema.lower() in denylist or scoped_schema in denylist:
            return False

        allowlist = self._schema_allowlist()
        if not allowlist:
            return True

        return schema.lower() in allowlist or scoped_schema in allowlist

    def _table_allowed(self, table_ref: TableRef) -> bool:
        allowlist = self._table_allowlist()
        if not allowlist:
            return True

        table = table_ref.table.lower()
        schema_table = f"{table_ref.schema}.{table_ref.table}".lower()
        catalog_schema_table = f"{table_ref.catalog}.{table_ref.schema}.{table_ref.table}".lower()

        return table in allowlist or schema_table in allowlist or catalog_schema_table in allowlist

    def _list_catalogs(self) -> list[str]:
        values = self._paged_values(
            "/api/2.1/unity-catalog/catalogs",
            value_keys=("catalogs", "value", "items"),
        )

        catalogs: list[str] = []
        for entry in values:
            name = entry.get("name")
            if isinstance(name, str) and name and self._catalog_allowed(name):
                catalogs.append(name)

        catalogs.sort()
        return catalogs

    def _list_schemas_for_catalog(self, catalog: str) -> list[str]:
        values = self._paged_values(
            "/api/2.1/unity-catalog/schemas",
            params={"catalog_name": catalog},
            value_keys=("schemas", "value", "items"),
        )

        schemas: list[str] = []
        for entry in values:
            name = entry.get("name")
            if not isinstance(name, str) or not name:
                continue
            if self._schema_allowed(catalog, name):
                schemas.append(name)

        schemas.sort()
        return schemas

    def _coerce_object_type(self, table_type: Any) -> str:
        normalized = str(table_type or "TABLE").upper()
        if "VIEW" in normalized:
            return "VIEW"
        return "TABLE"

    def _list_tables_for_schema(self, catalog: str, schema: str) -> list[TableRef]:
        values = self._paged_values(
            "/api/2.1/unity-catalog/tables",
            params={"catalog_name": catalog, "schema_name": schema},
            value_keys=("tables", "value", "items"),
        )

        limit_value = self._scope_options().table_limit_per_schema
        limit = int(limit_value) if limit_value else None

        tables: list[TableRef] = []
        for entry in values:
            table_name = entry.get("name") or entry.get("table_name")
            if not isinstance(table_name, str) or not table_name:
                continue

            table_ref = TableRef(
                catalog=catalog,
                schema=schema,
                table=table_name,
                object_type=self._coerce_object_type(entry.get("table_type") or entry.get("type")),
            )

            if not self._table_allowed(table_ref):
                continue

            tables.append(table_ref)
            if limit is not None and len(tables) >= limit:
                break

        return tables

    def _iter_tables(self) -> list[TableRef]:
        tables: list[TableRef] = []

        for catalog in self._list_catalogs():
            if self._aborted:
                break

            try:
                schemas = self._list_schemas_for_catalog(catalog)
            except Exception as exc:
                logger.warning("Skipping catalog %s due to schema listing error: %s", catalog, exc)
                continue

            for schema in schemas:
                if self._aborted:
                    break

                try:
                    tables.extend(self._list_tables_for_schema(catalog, schema))
                except Exception as exc:
                    logger.warning(
                        "Skipping schema %s.%s due to table listing error: %s",
                        catalog,
                        schema,
                        exc,
                    )

        return tables

    def _table_key(self, table_ref: TableRef) -> tuple[str, str, str]:
        return (table_ref.catalog, table_ref.schema, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.catalog}_#_{table_ref.schema}_#_{table_ref.table}"

    def _parse_qualified_table_name(self, value: str) -> tuple[str, str, str] | None:
        cleaned = value.strip().strip("`")
        if not cleaned:
            return None

        parts = [part.strip().strip("`") for part in cleaned.split(".") if part.strip()]
        if len(parts) < 3:
            return None

        return (parts[-3], parts[-2], parts[-1])

    def _lineage_table_ref_from_payload(
        self,
        payload: dict[str, Any],
    ) -> tuple[str, str, str] | None:
        nested = payload.get("tableInfo")
        if isinstance(nested, dict):
            payload = nested

        catalog = payload.get("catalog_name") or payload.get("catalog")
        schema = payload.get("schema_name") or payload.get("schema")
        table = payload.get("name") or payload.get("table")

        if all(isinstance(value, str) and value for value in (catalog, schema, table)):
            return (catalog, schema, table)

        table_name = payload.get("table_name") or payload.get("full_name")
        if isinstance(table_name, str) and table_name.strip():
            return self._parse_qualified_table_name(table_name)

        return None

    def _lineage_refs_for_table(self, table_ref: TableRef) -> set[tuple[str, str, str]]:
        response = self._request_json(
            "get",
            "/api/2.0/lineage-tracking/table-lineage",
            json_payload={
                "table_name": f"{table_ref.catalog}.{table_ref.schema}.{table_ref.table}",
                "include_entity_lineage": bool(self._extraction_options().include_notebooks),
            },
        )

        refs: set[tuple[str, str, str]] = set()

        upstreams = response.get("upstreams")
        if isinstance(upstreams, list):
            for entry in upstreams:
                if isinstance(entry, dict):
                    parsed = self._lineage_table_ref_from_payload(entry)
                    if parsed:
                        refs.add(parsed)

        upstream_tables = response.get("upstream_tables")
        if isinstance(upstream_tables, list):
            for entry in upstream_tables:
                if isinstance(entry, dict):
                    parsed = self._lineage_table_ref_from_payload(entry)
                    if parsed:
                        refs.add(parsed)

        return refs

    def _collect_table_lineage_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        if not self._extraction_options().include_table_lineage:
            return {}

        known_keys = {self._table_key(table_ref) for table_ref in tables}
        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}

        for table_ref in tables:
            if self._aborted:
                break

            source_key = self._table_key(table_ref)
            try:
                upstream_refs = self._lineage_refs_for_table(table_ref)
            except Exception as exc:
                logger.warning(
                    "Could not resolve Databricks lineage for %s.%s.%s: %s",
                    table_ref.catalog,
                    table_ref.schema,
                    table_ref.table,
                    exc,
                )
                continue

            for target in upstream_refs:
                if target in known_keys:
                    links.setdefault(source_key, set()).add(target)

        return links

    def _list_notebooks(self) -> list[NotebookRef]:
        if not self._extraction_options().include_notebooks:
            return []

        notebooks: list[NotebookRef] = []
        queue: deque[str] = deque(["/"])
        visited_paths: set[str] = set()

        while queue:
            if self._aborted:
                break

            path = queue.popleft()
            if path in visited_paths:
                continue
            visited_paths.add(path)

            try:
                payload = self._request_json(
                    "get",
                    "/api/2.0/workspace/list",
                    params={"path": path},
                )
            except Exception as exc:
                logger.warning("Skipping workspace path %s due to listing error: %s", path, exc)
                continue

            objects = payload.get("objects")
            if not isinstance(objects, list):
                continue

            for obj in objects:
                if not isinstance(obj, dict):
                    continue

                object_type = str(obj.get("object_type") or "").upper()
                object_path = obj.get("path")
                if not isinstance(object_path, str) or not object_path:
                    continue

                if object_type == "DIRECTORY":
                    queue.append(object_path)
                    continue

                if object_type != "NOTEBOOK":
                    continue

                object_id = obj.get("object_id")
                notebooks.append(
                    NotebookRef(
                        path=object_path,
                        object_id=str(object_id) if object_id is not None else None,
                        language=(
                            str(obj.get("language")) if obj.get("language") is not None else None
                        ),
                        created_at_ms=(
                            int(obj["created_at"])
                            if isinstance(obj.get("created_at"), int)
                            else None
                        ),
                        modified_at_ms=(
                            int(obj["modified_at"])
                            if isinstance(obj.get("modified_at"), int)
                            else None
                        ),
                    )
                )

        return notebooks

    def _list_pipelines(self) -> list[PipelineRef]:
        if not self._extraction_options().include_pipelines:
            return []

        values = self._paged_values(
            "/api/2.0/pipelines",
            value_keys=("statuses", "pipelines", "value", "items"),
        )

        pipelines: list[PipelineRef] = []
        for entry in values:
            pipeline_id = entry.get("pipeline_id") or entry.get("id")
            if not isinstance(pipeline_id, str) or not pipeline_id:
                continue

            name = entry.get("name")
            state = entry.get("state") or entry.get("health")
            pipelines.append(
                PipelineRef(
                    pipeline_id=pipeline_id,
                    name=str(name) if isinstance(name, str) and name else pipeline_id,
                    state=str(state) if isinstance(state, str) and state else None,
                )
            )

        return pipelines

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Databricks Unity Catalog...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            catalogs = self._list_catalogs()
            if not catalogs:
                raise ValueError("No Unity Catalog catalogs available for scanning")

            with closing(self._connect_sql()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()

            auth_mode = (
                "PAT_TOKEN"
                if isinstance(self.config.required, DatabricksRequiredPat)
                else "SERVICE_PRINCIPAL"
            )
            result["status"] = "SUCCESS"
            result["message"] = (
                "Successfully connected to Databricks Unity Catalog "
                f"using {auth_mode}. Reachable catalogs: {len(catalogs)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Databricks Unity Catalog: {exc}"

        return result

    def _table_to_asset(
        self,
        table_ref: TableRef,
        *,
        links: list[str] | None = None,
    ) -> SingleAssetScanResults:
        asset_name = f"{table_ref.catalog}.{table_ref.schema}.{table_ref.table}"
        raw_id = self._table_raw_id(table_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"{self._workspace_url()}/explore/data/"
            f"{table_ref.catalog}/{table_ref.schema}/{table_ref.table}"
        )

        metadata = {
            "catalog": table_ref.catalog,
            "schema": table_ref.schema,
            "table": table_ref.table,
            "object_type": table_ref.object_type,
            "sampling": {
                "limit": int(self._sampling().limit or 100),
                "strategy": str(self._sampling().strategy),
            },
        }

        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=asset_name,
            external_url=external_url,
            links=links or [],
            asset_type=OutputAssetType.TABLE,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    def _notebook_raw_id(self, notebook: NotebookRef) -> str:
        return f"notebook_#_{notebook.path}"

    def _notebook_to_asset(self, notebook: NotebookRef) -> SingleAssetScanResults:
        raw_id = self._notebook_raw_id(notebook)
        asset_hash = self.generate_hash_id(raw_id)

        metadata = {
            "kind": "notebook",
            "path": notebook.path,
            "object_id": notebook.object_id,
            "language": notebook.language,
            "created_at_ms": notebook.created_at_ms,
            "modified_at_ms": notebook.modified_at_ms,
        }

        raw_content = json.dumps(metadata, ensure_ascii=False)
        text_content = _truncate_text(
            "\n".join(
                [
                    "kind=notebook",
                    f"path={notebook.path}",
                    f"language={notebook.language or 'unknown'}",
                    f"object_id={notebook.object_id or 'unknown'}",
                ]
            ),
            int(self._sampling().max_total_chars or 20000),
        )
        self._content_cache[asset_hash] = (raw_content, text_content)

        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=notebook.path,
            external_url=f"{self._workspace_url()}/#workspace{notebook.path}",
            links=[],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    def _pipeline_raw_id(self, pipeline: PipelineRef) -> str:
        return f"pipeline_#_{pipeline.pipeline_id}"

    def _pipeline_to_asset(self, pipeline: PipelineRef) -> SingleAssetScanResults:
        raw_id = self._pipeline_raw_id(pipeline)
        asset_hash = self.generate_hash_id(raw_id)

        metadata = {
            "kind": "pipeline",
            "pipeline_id": pipeline.pipeline_id,
            "name": pipeline.name,
            "state": pipeline.state,
        }

        raw_content = json.dumps(metadata, ensure_ascii=False)
        text_content = _truncate_text(
            "\n".join(
                [
                    "kind=pipeline",
                    f"pipeline_id={pipeline.pipeline_id}",
                    f"name={pipeline.name}",
                    f"state={pipeline.state or 'unknown'}",
                ]
            ),
            int(self._sampling().max_total_chars or 20000),
        )
        self._content_cache[asset_hash] = (raw_content, text_content)

        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=pipeline.name,
            external_url=f"{self._workspace_url()}/#joblist/pipelines/{pipeline.pipeline_id}",
            links=[],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        tables = self._iter_tables()

        table_hash_by_key: dict[tuple[str, str, str], str] = {
            self._table_key(table_ref): self.generate_hash_id(self._table_raw_id(table_ref))
            for table_ref in tables
        }

        lineage_links = self._collect_table_lineage_links(tables)

        batch: list[SingleAssetScanResults] = []

        for table_ref in tables:
            if self._aborted:
                return

            key = self._table_key(table_ref)
            linked_hashes = [
                table_hash_by_key[target]
                for target in sorted(lineage_links.get(key, set()))
                if target in table_hash_by_key
            ]

            asset = self._table_to_asset(table_ref, links=linked_hashes)
            self._table_lookup[asset.hash] = table_ref
            batch.append(asset)

            if len(batch) >= self.BATCH_SIZE:
                if pipeline:
                    batch = await pipeline.process(batch)
                yield batch
                batch = []

        for notebook in self._list_notebooks():
            if self._aborted:
                return

            batch.append(self._notebook_to_asset(notebook))
            if len(batch) >= self.BATCH_SIZE:
                if pipeline:
                    batch = await pipeline.process(batch)
                yield batch
                batch = []

        for pipeline_ref in self._list_pipelines():
            if self._aborted:
                return

            batch.append(self._pipeline_to_asset(pipeline_ref))
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

    def _parse_table_ref_from_asset_id(self, asset_id: str) -> TableRef | None:
        if asset_id in self._table_lookup:
            return self._table_lookup[asset_id]

        decoded = asset_id
        if "_#_" not in decoded:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

        parts = decoded.split("_#_")
        if len(parts) >= 2 and parts[-2] in {"notebook", "pipeline"}:
            return None

        if len(parts) >= 4 and parts[0].upper() == "DATABRICKS":
            return TableRef(
                catalog=parts[-3],
                schema=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )

        if len(parts) >= 3:
            return TableRef(
                catalog=parts[-3],
                schema=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )

        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = (
            "SELECT column_name "
            "FROM system.information_schema.columns "
            f"WHERE table_catalog = {_quote_literal(table_ref.catalog)} "
            f"AND table_schema = {_quote_literal(table_ref.schema)} "
            f"AND table_name = {_quote_literal(table_ref.table)} "
            "ORDER BY ordinal_position"
        )

        with closing(self._connect_sql()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                columns: list[str] = []
                for row in cursor.fetchall():
                    candidate: Any | None = None
                    try:
                        candidate = row[0]  # type: ignore[index]
                    except Exception:
                        candidate = None
                    if isinstance(candidate, str):
                        columns.append(candidate)
                return columns

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        configured = sampling.order_by_column
        if configured and configured in columns:
            return configured

        priority_candidates = (
            "updated_at",
            "modified_at",
            "created_at",
            "inserted_at",
            "timestamp",
            "ts",
            "date",
        )

        for candidate in priority_candidates:
            if candidate in columns:
                return candidate
        return None

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()

        max_columns = int(sampling.max_columns or 25)
        selected_columns = columns[:max_columns] if columns else []
        if not selected_columns:
            raise ValueError(
                f"Table {table_ref.catalog}.{table_ref.schema}.{table_ref.table} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in selected_columns)
        from_expr = (
            f"{_quote_identifier(table_ref.catalog)}."
            f"{_quote_identifier(table_ref.schema)}."
            f"{_quote_identifier(table_ref.table)}"
        )

        query = f"SELECT {quoted_columns} FROM {from_expr}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(selected_columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY rand()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY rand()"

        if strategy != SamplingStrategy.ALL:
            query += f" LIMIT {int(sampling.limit or 100)}"

        return query, []

    def _serialize_cell(self, value: Any) -> str:
        max_cell_chars = int(self._sampling().max_cell_chars or 512)

        if value is None:
            return "null"
        if isinstance(value, (bytes, bytearray, memoryview)):
            rendered = f"<{len(bytes(value))} bytes>"
            return _truncate_text(rendered, max_cell_chars)
        if isinstance(value, datetime):
            return _truncate_text(value.isoformat(), max_cell_chars)
        return _truncate_text(str(value), max_cell_chars)

    def _format_sample_content(
        self,
        table_ref: TableRef,
        column_names: list[str],
        rows: list[tuple[Any, ...]],
    ) -> tuple[str, str]:
        sampling = self._sampling()
        return format_tabular_sample_content(
            scope_label="table",
            scope_value=f"{table_ref.catalog}.{table_ref.schema}.{table_ref.table}",
            strategy=sampling.strategy,
            rows=rows,
            column_names=column_names,
            serialize_cell=self._serialize_cell,
            max_total_chars=int(sampling.max_total_chars or 20000),
            include_column_names=sampling.include_column_names is not False,
            object_type=table_ref.object_type,
            raw_metadata={
                "catalog": table_ref.catalog,
                "schema": table_ref.schema,
                "table": table_ref.table,
            },
        )

    def _sample_table_rows(self, table_ref: TableRef) -> tuple[str, str] | None:
        columns = self._available_columns(table_ref)
        query, _params = self._build_sampling_query(table_ref, columns)

        with closing(self._connect_sql()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                rows = cursor.fetchall()
                column_names = [desc[0] for desc in cursor.description or []]

        if not column_names:
            return None

        return self._format_sample_content(table_ref, column_names, rows)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        table_ref = self._parse_table_ref_from_asset_id(asset_id)
        if not table_ref:
            return None

        try:
            sampled = self._sample_table_rows(table_ref)
        except Exception as exc:
            logger.error(
                "Failed to sample content for Databricks table %s.%s.%s: %s",
                table_ref.catalog,
                table_ref.schema,
                table_ref.table,
                exc,
            )
            return None

        if sampled is None:
            return None

        self._content_cache[asset_id] = sampled
        return sampled

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        del text_content
        table_ref = self._table_lookup.get(asset.hash)
        if not table_ref:
            return

        path = f"{table_ref.catalog}.{table_ref.schema}.{table_ref.table}"
        cached = self._content_cache.get(asset.hash)
        raw_content = cached[0] if cached else None
        metadata = finding.metadata or {}
        finding.location = build_tabular_location(
            raw_content=raw_content,
            matched_content=finding.matched_content,
            base_path=path,
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting Databricks extraction...")
        super().abort()

    def cleanup(self) -> None:
        self.session.close()
