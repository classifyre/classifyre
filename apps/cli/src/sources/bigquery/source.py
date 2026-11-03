"""Google BigQuery, including BigLake and BigQuery tables for Apache Iceberg.

Rows are read with ``list_rows`` (the ``tabledata.list`` API), which costs
nothing, wherever the read is a plain walk of a table — ALL and AUTOMATIC. A SQL
query, even with ``LIMIT``, bills every byte of the columns it touches, and an
AUTOMATIC sweep issues one per page. Only RANDOM and LATEST, which need an
``ORDER BY``, run a query, capped by ``maximum_bytes_billed`` when set.

The DB-API surface the tabular base expects is a thin shim over the client
(``_BigQueryConnection``), the same approach the Dremio source takes over REST.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from typing import Any

from ...models.generated_input import BigQueryInput, SamplingConfig
from ...utils.sql_lineage import upstream_tables_from_sql
from ..dependencies import require_module
from ..inline_paging import InlinePagingMixin
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage

logger = logging.getLogger(__name__)

# The plain table walk the tabular base issues for ALL: no ORDER BY, no LIMIT.
_PLAIN_SELECT_RE = re.compile(r"^SELECT (?P<columns>.+) FROM `(?P<table>[^`]+)`$", re.S)


def _quote(identifier: str) -> str:
    return "`" + identifier.replace("`", "\\`") + "`"


def bigquery_table_format(table: Any) -> str:
    """The storage format a BigQuery table declares."""
    table_type = str(getattr(table, "table_type", "") or "").upper()
    if table_type in ("VIEW", "MATERIALIZED_VIEW"):
        return "view"
    properties = getattr(table, "_properties", {}) or {}
    if properties.get("biglakeConfiguration"):
        return "iceberg"  # BigQuery table for Apache Iceberg (BigLake managed)
    external = properties.get("externalDataConfiguration") or {}
    if external:
        source_format = str(external.get("sourceFormat", "")).upper()
        return {"ICEBERG": "iceberg", "DELTA_LAKE": "delta"}.get(source_format, "external")
    return "native"


class _BigQueryCursor:
    def __init__(self, connection: _BigQueryConnection) -> None:
        self._connection = connection
        self._rows: Iterator[tuple[Any, ...]] = iter(())
        self.description: list[tuple[str, ...]] | None = None

    def __enter__(self) -> _BigQueryCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def execute(self, query: str, params: Any = None) -> None:
        del params  # every query here is built by the source, with no parameters
        client = self._connection.client
        plain = _PLAIN_SELECT_RE.match(query.strip())
        if plain:
            table = client.get_table(plain.group("table"))
            wanted = {c.strip().strip("`") for c in plain.group("columns").split(",")}
            fields = [f for f in table.schema if f.name in wanted]
            rows = client.list_rows(table, selected_fields=fields)
            self.description = [(f.name,) for f in fields]
            self._rows = (tuple(row.values()) for row in rows)
            return
        job = client.query(query, job_config=self._connection.job_config())
        result = job.result()
        self.description = [(f.name,) for f in result.schema]
        self._rows = (tuple(row.values()) for row in result)

    def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
        out = []
        for row in self._rows:
            out.append(row)
            if len(out) >= size:
                break
        return out

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._rows)

    def fetchone(self) -> tuple[Any, ...] | None:
        return next(self._rows, None)

    def close(self) -> None:
        self._rows = iter(())


class _BigQueryConnection:
    def __init__(self, client: Any, bigquery: Any, maximum_bytes_billed: int | None) -> None:
        self.client = client
        self._bigquery = bigquery
        self._maximum_bytes_billed = maximum_bytes_billed

    def job_config(self) -> Any:
        config = self._bigquery.QueryJobConfig()
        if self._maximum_bytes_billed:
            config.maximum_bytes_billed = int(self._maximum_bytes_billed)
        return config

    def cursor(self) -> _BigQueryCursor:
        return _BigQueryCursor(self)

    def close(self) -> None:
        self.client.close()


class BigQuerySource(InlinePagingMixin, BaseTabularSource):
    source_type = "bigquery"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = BigQueryInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._tables: dict[tuple[str, ...], Any] = {}

    @property
    def _source_label(self) -> str:
        return "Google BigQuery"

    def _asset_type_value(self) -> str:
        return str(getattr(self.config.type, "value", self.config.type))

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _option(self, section: str, name: str, default: Any = None) -> Any:
        block = getattr(self.config.optional, section, None) if self.config.optional else None
        value = getattr(block, name, None) if block is not None else None
        return default if value is None else getattr(value, "value", value)

    def _names(self, name: str) -> set[str]:
        return {
            str(v).strip().lower() for v in (self._option("scope", name) or []) if str(v).strip()
        }

    def _project(self) -> str:
        return str(self.config.required.project_id)

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        bigquery = require_module(
            module_name="google.cloud.bigquery",
            source_name="Google BigQuery",
            uv_groups=["bigquery"],
        )
        info = self.config.masked.gcp_credentials_json if self.config.masked else None
        credentials = None
        if info:
            service_account = require_module(
                module_name="google.oauth2.service_account",
                source_name="Google BigQuery",
                uv_groups=["bigquery"],
            )
            credentials = service_account.Credentials.from_service_account_info(json.loads(info))
        client = bigquery.Client(
            project=self._option("connection", "billing_project_id") or self._project(),
            credentials=credentials,
            location=self._option("connection", "location"),
        )
        return _BigQueryConnection(
            client, bigquery, self._option("connection", "maximum_bytes_billed")
        )

    def _client(self) -> Any:
        return self._get_cached_connection(self._project()).client

    # ── Discovery ────────────────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        return [self._project()]

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include, exclude = self._names("include_datasets"), self._names("exclude_datasets")
        include_tables = self._option("scope", "include_tables", True) is not False
        include_views = self._option("scope", "include_views", True) is not False
        objects = self._names("include_objects")
        limit = self._option("scope", "table_limit")
        client = self._client()
        tables: list[TableRef] = []
        for dataset in client.list_datasets(database):
            name = str(dataset.dataset_id)
            if name.lower() in exclude or (include and name.lower() not in include):
                continue
            for item in client.list_tables(dataset.reference):
                is_view = str(item.table_type).upper() in ("VIEW", "MATERIALIZED_VIEW")
                if (is_view and not include_views) or (not is_view and not include_tables):
                    continue
                if objects and f"{name.lower()}.{str(item.table_id).lower()}" not in objects:
                    continue
                ref = TableRef(
                    database=database,
                    schema=name,
                    table=str(item.table_id),
                    object_type="VIEW" if is_view else "TABLE",
                )
                tables.append(ref)
                if limit and len(tables) >= int(limit):
                    return tables
        return tables

    def _table(self, table_ref: TableRef) -> Any:
        if table_ref.table_key not in self._tables:
            self._tables[table_ref.table_key] = self._client().get_table(
                f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"
            )
        return self._tables[table_ref.table_key]

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        return {f.name: str(f.field_type) for f in self._table(table_ref).schema}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    def _estimate_row_count(self, table_ref: TableRef) -> int | None:
        rows = getattr(self._table(table_ref), "num_rows", None)
        return int(rows) if rows is not None else None

    # ── Rows ─────────────────────────────────────────────────────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        """A page by row position, from ``tabledata.list`` — no query, no bytes billed."""
        del base_query
        table = self._table(table_ref)
        if str(table.table_type).upper() in ("VIEW", "MATERIALIZED_VIEW"):
            # A view has no stored rows to list; it is read with a query.
            return super()._fetch_one_page(
                table_ref, f"SELECT * FROM {self._table_select_fqn(table_ref)}", page_size, offset
            )
        rows = self._client().list_rows(table, start_index=int(offset), max_results=int(page_size))
        names = [f.name for f in table.schema]
        return [tuple(row.values()) for row in rows], names

    def _inline_window(self, page_size: int, offset: int) -> str:
        return f"LIMIT {page_size} OFFSET {offset}"

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote(identifier)

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return f"`{table_ref.database}.{table_ref.schema}.{table_ref.table}`"

    def _random_order_expr(self) -> str:
        return "RAND()"

    # ── Lineage ──────────────────────────────────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        if self._option("extraction", "include_view_lineage", True) is False:
            return []
        scoped = {t.table_key for t in tables}
        results: list[ViewLineage] = []
        for view in tables:
            if (view.object_type or "").upper() != "VIEW":
                continue
            sql = getattr(self._table(view), "view_query", None) or getattr(
                self._table(view), "mview_query", None
            )
            if not sql:
                continue
            upstreams = [
                key
                for key in upstream_tables_from_sql(
                    str(sql),
                    dialect="bigquery",
                    default_database=view.database,
                    default_schema=view.schema,
                )
                if key != view.table_key and key in scoped
            ]
            if upstreams:
                results.append(ViewLineage(view.table_key, tuple(upstreams), str(sql)))
        return results

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str:
        return self._project()

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            "https://console.cloud.google.com/bigquery?"
            f"project={table_ref.database}&ws=!1m5!1m4!4m3!1s{table_ref.database}"
            f"!2s{table_ref.schema}!3s{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        table = self._table(table_ref)
        meta: dict[str, Any] = {
            "object_type": table_ref.object_type or "TABLE",
            "table_format": bigquery_table_format(table),
        }
        external = (getattr(table, "_properties", {}) or {}).get("externalDataConfiguration") or {}
        uris = external.get("sourceUris") or []
        if uris:
            meta["location"] = str(uris[0])
        return meta

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None
