from __future__ import annotations

import json
import logging
from collections import deque
from collections.abc import AsyncGenerator, Generator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import requests

from ...models.generated_input import (
    AzureServicePrincipal,
    DatabricksInput,
    DatabricksMaskedAzureServicePrincipal,
    DatabricksMaskedPat,
    DatabricksMaskedServicePrincipal,
    DatabricksOptionalConnection,
    DatabricksOptionalExtraction,
    DatabricksOptionalScope,
    PersonalAccessToken,
    SamplingConfig,
    SamplingStrategy,
    ServicePrincipalOAuthM2M,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_CATALOGS = {"system"}
_DEFAULT_EXCLUDED_SCHEMAS = {"information_schema"}


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


class DatabricksSource(BaseTabularSource):
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

        # pyarrow→pandas conversion calls pytz.timezone() on the timezone name
        # embedded in Arrow schema metadata. Databricks uses 'Etc/UTC' which is
        # absent from pytz's built-in zone list.
        try:
            import pytz

            pytz._tzinfo_cache.setdefault("Etc/UTC", pytz.UTC)
        except Exception:
            pass

        self._validate_auth_configuration()

        self.session = requests.Session()
        self._access_token: str | None = None
        self._access_token_expiry: datetime | None = None

    # ── Auth ─────────────────────────────────────────────────────────────

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, PersonalAccessToken):
            if not isinstance(masked, DatabricksMaskedPat):
                raise ValueError("DATABRICKS PAT_TOKEN auth requires masked.token")
            return
        if isinstance(required, ServicePrincipalOAuthM2M):
            if not isinstance(masked, DatabricksMaskedServicePrincipal):
                raise ValueError("DATABRICKS SERVICE_PRINCIPAL auth requires masked.client_secret")
            return
        if isinstance(required, AzureServicePrincipal):
            if not isinstance(masked, DatabricksMaskedAzureServicePrincipal):
                raise ValueError(
                    "DATABRICKS AZURE_SERVICE_PRINCIPAL auth requires masked.client_secret"
                )
            return
        raise ValueError("Unsupported DATABRICKS auth configuration")

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Databricks"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Config accessors ─────────────────────────────────────────────────

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
        return int(self._connection_options().timeout_seconds or 30)

    def _statement_timeout_seconds(self) -> int:
        return int(self._connection_options().statement_timeout_seconds or 60)

    def _is_pat_mode(self) -> bool:
        return isinstance(self.config.required, PersonalAccessToken)

    def _is_azure_sp_mode(self) -> bool:
        return isinstance(self.config.required, AzureServicePrincipal)

    def _masked_pat_token(self) -> str:
        masked = self.config.masked
        if not isinstance(masked, DatabricksMaskedPat):
            raise ValueError("DATABRICKS PAT_TOKEN auth requires masked.token")
        return masked.token

    def _service_principal_credentials(self) -> tuple[str, str]:
        required = self.config.required
        masked = self.config.masked
        if not isinstance(required, ServicePrincipalOAuthM2M):
            raise ValueError("SERVICE_PRINCIPAL auth mode is required")
        if not isinstance(masked, DatabricksMaskedServicePrincipal):
            raise ValueError("DATABRICKS SERVICE_PRINCIPAL auth requires masked.client_secret")
        return required.client_id, masked.client_secret

    def _azure_sp_credentials(self) -> tuple[str, str, str]:
        required = self.config.required
        masked = self.config.masked
        if not isinstance(required, AzureServicePrincipal):
            raise ValueError("AZURE_SERVICE_PRINCIPAL auth mode is required")
        if not isinstance(masked, DatabricksMaskedAzureServicePrincipal):
            raise ValueError(
                "DATABRICKS AZURE_SERVICE_PRINCIPAL auth requires masked.client_secret"
            )
        return required.tenant_id, required.client_id, masked.client_secret

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
        self._access_token_expiry = datetime.now(UTC) + timedelta(seconds=max(expires_in - 300, 0))
        return token.strip()

    def _acquire_azure_token(self) -> str:
        # Azure AD v1 token endpoint; resource ID is the fixed Databricks app in Azure
        _databricks_azure_resource = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d"
        tenant_id, client_id, client_secret = self._azure_sp_credentials()
        response = self.session.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "resource": _databricks_azure_resource,
            },
            timeout=self._timeout_seconds(),
        )
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("Azure AD token response did not include access_token")
        expires_in = int(payload.get("expires_in", 3600))
        self._access_token_expiry = datetime.now(UTC) + timedelta(seconds=max(expires_in - 300, 0))
        return token.strip()

    def _access_token_value(self) -> str:
        if self._is_pat_mode():
            return self._masked_pat_token().strip()
        if self._access_token and not self._is_access_token_expired():
            return self._access_token
        if self._is_azure_sp_mode():
            self._access_token = self._acquire_azure_token()
        else:
            self._access_token = self._acquire_service_principal_token()
        return self._access_token

    def _authorization_header(self) -> str:
        return f"Bearer {self._access_token_value()}"

    # ── REST API helpers ─────────────────────────────────────────────────

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

    # ── Connection (SQL) ─────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        return self._databricks_sql.connect(
            server_hostname=self._workspace_host(),
            http_path=f"/sql/1.0/warehouses/{self._warehouse_id()}",
            access_token=self._access_token_value(),
            _socket_timeout=self._timeout_seconds(),
        )

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            return bool(conn.open)
        except Exception:
            return False

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "rand()"

    # ── Databricks uses catalog.schema.table in FROM ─────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return (
            f"{self._quote_identifier(table_ref.database)}"
            f".{self._quote_identifier(table_ref.schema or '')}"
            f".{self._quote_identifier(table_ref.table)}"
        )

    # ── Databricks uses inline LIMIT (no params) ────────────────────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")

        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        from_expr = self._table_select_fqn(table_ref)
        query = f"SELECT {quoted_columns} FROM {from_expr}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        if strategy != SamplingStrategy.ALL:
            query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    # ── Databricks uses string interpolation for info_schema queries ─────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = (
            "SELECT column_name "
            "FROM system.information_schema.columns "
            f"WHERE table_catalog = {_quote_literal(table_ref.database)} "
            f"AND table_schema = {_quote_literal(table_ref.schema or '')} "
            f"AND table_name = {_quote_literal(table_ref.table)} "
            "ORDER BY ordinal_position"
        )
        conn = self._get_cached_connection(table_ref.database)
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

    # ── Databricks-specific cell serialization ───────────────────────────

    def _serialize_cell(self, value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, (bytes, bytearray, memoryview)):
            return f"<{len(bytes(value))} bytes>"
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    # ── Databricks pagination (inline LIMIT/OFFSET) ──────────────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)
        paginated_query = f"{base_query} LIMIT {page_size} OFFSET {offset}"
        with conn.cursor() as cursor:
            cursor.execute(paginated_query)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── Catalog / schema / table discovery (REST API) ────────────────────

    def _catalog_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_catalogs
        if not configured:
            return None
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _catalog_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_catalogs or []
        denylist = {entry.strip().lower() for entry in configured if entry and entry.strip()}
        return denylist if denylist else set(_DEFAULT_EXCLUDED_CATALOGS)

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

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {entry.strip().lower() for entry in configured if entry and entry.strip()}
        return denylist if denylist else set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _schema_allowed(self, catalog: str, schema: str) -> bool:
        scoped_schema = f"{catalog}.{schema}".lower()
        denylist = self._schema_denylist()
        if schema.lower() in denylist or scoped_schema in denylist:
            return False
        allowlist = self._schema_allowlist()
        if not allowlist:
            return True
        return schema.lower() in allowlist or scoped_schema in allowlist

    def _table_allowlist(self) -> set[str]:
        configured = self._scope_options().include_tables
        if not configured:
            return set()
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _table_allowed(self, table_ref: TableRef) -> bool:
        allowlist = self._table_allowlist()
        if not allowlist:
            return True
        table = table_ref.table.lower()
        schema_table = f"{(table_ref.schema or '')}.{table_ref.table}".lower()
        catalog_schema_table = (
            f"{table_ref.database}.{table_ref.schema or ''}.{table_ref.table}".lower()
        )
        return table in allowlist or schema_table in allowlist or catalog_schema_table in allowlist

    def _list_catalogs(self) -> list[str]:
        values = self._paged_values(
            "/api/2.1/unity-catalog/catalogs",
            value_keys=("catalogs", "value", "items"),
        )
        catalogs = [
            name
            for entry in values
            if isinstance((name := entry.get("name")), str) and name and self._catalog_allowed(name)
        ]
        catalogs.sort()
        logger.info("Found %d catalog(s): %s", len(catalogs), ", ".join(catalogs) or "(none)")
        return catalogs

    def _list_schemas_for_catalog(self, catalog: str) -> list[str]:
        values = self._paged_values(
            "/api/2.1/unity-catalog/schemas",
            params={"catalog_name": catalog},
            value_keys=("schemas", "value", "items"),
        )
        schemas = [
            name
            for entry in values
            if isinstance((name := entry.get("name")), str)
            and name
            and self._schema_allowed(catalog, name)
        ]
        schemas.sort()
        logger.info("Catalog %s: found %d schema(s)", catalog, len(schemas))
        return schemas

    def _coerce_object_type(self, table_type: Any) -> str:
        normalized = str(table_type or "TABLE").upper()
        return "VIEW" if "VIEW" in normalized else "TABLE"

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
                database=catalog,
                schema=schema,
                table=table_name,
                object_type=self._coerce_object_type(entry.get("table_type") or entry.get("type")),
            )
            if not self._table_allowed(table_ref):
                continue
            tables.append(table_ref)
            if limit is not None and len(tables) >= limit:
                break

        logger.info("Schema %s.%s: found %d table(s)", catalog, schema, len(tables))
        return tables

    # ── Override: discovery via REST API ──────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        return self._list_catalogs()

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        tables: list[TableRef] = []
        try:
            schemas = self._list_schemas_for_catalog(database)
        except Exception as exc:
            logger.warning("Skipping catalog %s due to schema listing error: %s", database, exc)
            return tables
        for schema in schemas:
            if self._aborted:
                break
            try:
                tables.extend(self._list_tables_for_schema(database, schema))
            except Exception as exc:
                logger.warning(
                    "Skipping schema %s.%s due to table listing error: %s",
                    database,
                    schema,
                    exc,
                )
        return tables

    # ── Lineage (REST API per-table) ─────────────────────────────────────

    def _parse_qualified_table_name(self, value: str) -> tuple[str, str, str] | None:
        cleaned = value.strip().strip("`")
        if not cleaned:
            return None
        parts = [part.strip().strip("`") for part in cleaned.split(".") if part.strip()]
        if len(parts) < 3:
            return None
        return (parts[-3], parts[-2], parts[-1])

    def _lineage_table_ref_from_payload(
        self, payload: dict[str, Any]
    ) -> tuple[str, str, str] | None:
        nested = payload.get("tableInfo")
        if isinstance(nested, dict):
            payload = nested
        catalog = payload.get("catalog_name") or payload.get("catalog")
        schema = payload.get("schema_name") or payload.get("schema")
        table = payload.get("name") or payload.get("table")
        if all(isinstance(v, str) and v for v in (catalog, schema, table)):
            return (catalog, schema, table)
        table_name = payload.get("table_name") or payload.get("full_name")
        if isinstance(table_name, str) and table_name.strip():
            return self._parse_qualified_table_name(table_name)
        return None

    def _lineage_refs_for_table(self, table_ref: TableRef) -> set[tuple[str, str, str]]:
        response = self._request_json(
            "get",
            "/api/2.0/lineage-tracking/table-lineage",
            params={
                "table_name": f"{table_ref.database}.{table_ref.schema}.{table_ref.table}",
                "include_entity_lineage": str(
                    bool(self._extraction_options().include_notebooks)
                ).lower(),
            },
        )
        refs: set[tuple[str, str, str]] = set()
        for key in ("upstreams", "upstream_tables"):
            entries = response.get(key)
            if isinstance(entries, list):
                for entry in entries:
                    if isinstance(entry, dict):
                        parsed = self._lineage_table_ref_from_payload(entry)
                        if parsed:
                            refs.add(parsed)
        return refs

    # ── Notebooks ────────────────────────────────────────────────────────

    def _iter_notebooks(self) -> Generator[NotebookRef, None, None]:
        if not self._extraction_options().include_notebooks:
            return
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
                    "get", "/api/2.0/workspace/list", params={"path": path}
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
                yield NotebookRef(
                    path=object_path,
                    object_id=str(object_id) if object_id is not None else None,
                    language=str(obj.get("language")) if obj.get("language") is not None else None,
                    created_at_ms=(
                        int(obj["created_at"]) if isinstance(obj.get("created_at"), int) else None
                    ),
                    modified_at_ms=(
                        int(obj["modified_at"]) if isinstance(obj.get("modified_at"), int) else None
                    ),
                )

    def _notebook_to_asset(self, notebook: NotebookRef) -> SingleAssetScanResults:
        raw_id = f"notebook_#_{notebook.path}"
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
        text_content = "\n".join(
            [
                "kind=notebook",
                f"path={notebook.path}",
                f"language={notebook.language or 'unknown'}",
                f"object_id={notebook.object_id or 'unknown'}",
            ]
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
            metadata=self.validated_metadata("notebook", metadata),
        )

    # ── Pipelines ────────────────────────────────────────────────────────

    def _iter_pipelines(self) -> Generator[PipelineRef, None, None]:
        if not self._extraction_options().include_pipelines:
            return
        next_page_token: str | None = None
        while True:
            params = {}
            if next_page_token:
                params["page_token"] = next_page_token
            try:
                payload = self._request_json("get", "/api/2.0/pipelines", params=params)
            except Exception as exc:
                logger.warning("Could not list Databricks pipelines: %s", exc)
                break
            values: list[dict[str, Any]] = []
            for key in ("statuses", "pipelines", "value", "items"):
                candidate = payload.get(key)
                if isinstance(candidate, list):
                    values = candidate
                    break
            for entry in values:
                pipeline_id = entry.get("pipeline_id") or entry.get("id")
                if not isinstance(pipeline_id, str) or not pipeline_id:
                    continue
                name = entry.get("name")
                state = entry.get("state") or entry.get("health")
                yield PipelineRef(
                    pipeline_id=pipeline_id,
                    name=str(name) if isinstance(name, str) and name else pipeline_id,
                    state=str(state) if isinstance(state, str) and state else None,
                )
            token = payload.get("next_page_token")
            if not isinstance(token, str) or not token.strip():
                break
            next_page_token = token

    def _pipeline_to_asset(self, pipeline: PipelineRef) -> SingleAssetScanResults:
        raw_id = f"pipeline_#_{pipeline.pipeline_id}"
        asset_hash = self.generate_hash_id(raw_id)
        metadata = {
            "kind": "pipeline",
            "pipeline_id": pipeline.pipeline_id,
            "name": pipeline.name,
            "state": pipeline.state,
        }
        raw_content = json.dumps(metadata, ensure_ascii=False)
        text_content = "\n".join(
            [
                "kind=pipeline",
                f"pipeline_id={pipeline.pipeline_id}",
                f"name={pipeline.name}",
                f"state={pipeline.state or 'unknown'}",
            ]
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
            metadata=self.validated_metadata("pipeline", metadata),
        )

    # ── Custom extract_raw (tables + notebooks + pipelines) ──────────────

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        logger.info("Starting Databricks extraction: discovering tables...")
        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, ...], str] = {
            t.table_key: self.generate_hash_id(t.raw_id) for t in tables
        }

        include_lineage = self._extraction_options().include_table_lineage
        if include_lineage and tables:
            logger.info("Fetching table lineage for %d table(s)...", len(tables))

        batch: list[SingleAssetScanResults] = []
        emitted_tables = 0

        for i, table_ref in enumerate(tables, 1):
            if self._aborted:
                return
            table_label = table_ref.display_name
            logger.info("Processing table %d/%d: %s", i, len(tables), table_label)

            linked_hashes: list[str] = []
            if include_lineage:
                try:
                    upstream_refs = self._lineage_refs_for_table(table_ref)
                    linked_hashes = [
                        table_hash_by_key[target]
                        for target in sorted(upstream_refs)
                        if target in table_hash_by_key
                    ]
                except Exception as exc:
                    logger.warning(
                        "Could not resolve Databricks lineage for %s: %s", table_label, exc
                    )

            asset = self._table_to_asset(table_ref, links=linked_hashes)
            self._table_lookup[asset.hash] = table_ref
            batch.append(asset)
            emitted_tables += 1

            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []

        # Notebooks
        notebook_count = 0
        for notebook in self._iter_notebooks():
            if self._aborted:
                break
            batch.append(self._notebook_to_asset(notebook))
            notebook_count += 1
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if notebook_count:
            logger.info("Discovered %d notebook(s)", notebook_count)

        # Pipelines
        pipeline_count = 0
        for pipeline_ref in self._iter_pipelines():
            if self._aborted:
                break
            batch.append(self._pipeline_to_asset(pipeline_ref))
            pipeline_count += 1
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if pipeline_count:
            logger.info("Discovered %d pipeline(s)", pipeline_count)

        if batch:
            yield batch

        logger.info(
            "Extraction complete: %d table(s), %d notebook(s), %d pipeline(s)",
            emitted_tables,
            notebook_count,
            pipeline_count,
        )

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"{self._workspace_url()}/explore/data/"
            f"{table_ref.database}/{table_ref.schema}/{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {
            "catalog": table_ref.database,
            "object_type": table_ref.object_type,
        }

    def _finding_base_path(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Databricks Unity Catalog...")
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            catalogs = self._list_catalogs()
            if not catalogs:
                raise ValueError("No Unity Catalog catalogs available for scanning")
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            if self._is_pat_mode():
                auth_mode = "PAT_TOKEN"
            elif self._is_azure_sp_mode():
                auth_mode = "AZURE_SERVICE_PRINCIPAL"
            else:
                auth_mode = "SERVICE_PRINCIPAL"
            result["status"] = "SUCCESS"
            result["message"] = (
                "Successfully connected to Databricks Unity Catalog "
                f"using {auth_mode}. Reachable catalogs: {len(catalogs)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Databricks Unity Catalog: {exc}"
        return result

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        # Skip notebook/pipeline IDs
        if len(parts) >= 2 and parts[-2] in {"notebook", "pipeline"}:
            return None
        if len(parts) >= 4 and parts[0].upper() == "DATABRICKS":
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        if len(parts) >= 3:
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        return None

    # ── Cleanup (close REST session too) ─────────────────────────────────

    def cleanup(self) -> None:
        super().cleanup()
        self.session.close()
