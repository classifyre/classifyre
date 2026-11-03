"""Trino and Starburst (Galaxy, Enterprise): every catalog the cluster can see.

A Trino cluster federates many systems behind one SQL interface, and on a
lakehouse that usually means Iceberg, Delta Lake, Hudi and Hive catalogs over the
same object storage. Each catalog is a ``database`` here, so a table is
``catalog.schema.table`` — Trino's own three-part name — and its rows are read
through the catalog's connector, which applies that format's deletes and
renames.

The connector behind each catalog (``system.metadata.catalogs``) becomes the
table's ``table_format``, so a finding in a Trino-read Iceberg table says it was
an Iceberg table. Views are read from ``information_schema.views`` and their
upstreams parsed out of the SQL (``SQL_PARSED`` lineage).
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import SamplingConfig, TrinoInput
from ...utils.sql_lineage import upstream_tables_from_sql
from ..dependencies import require_module
from ..inline_paging import InlinePagingMixin
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage

logger = logging.getLogger(__name__)

_SKIPPED_CATALOGS = {"system"}
# Iceberg catalogs expose a `system` schema of metadata tables (snapshots, files).
_SKIPPED_SCHEMAS = {"information_schema", "system"}

# Trino connector name -> the table format its tables are stored in.
_CONNECTOR_FORMATS = {
    "iceberg": "iceberg",
    "delta_lake": "delta",
    "delta-lake": "delta",
    "hudi": "hudi",
    "hive": "hive",
    "lakehouse": "lakehouse",
}


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class TrinoSource(InlinePagingMixin, BaseTabularSource):
    source_type = "trino"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = TrinoInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._dbapi = require_module(
            module_name="trino.dbapi",
            source_name="Trino",
            uv_groups=["trino"],
            detail="The Trino connector is optional.",
        )
        self._connectors: dict[str, str] | None = None

    # ── Configuration ────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Trino"

    def _asset_type_value(self) -> str:
        return str(getattr(self.config.type, "value", self.config.type))

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _option(self, section: str, name: str, default: Any = None) -> Any:
        block = getattr(self.config.optional, section, None) if self.config.optional else None
        value = getattr(block, name, None) if block is not None else None
        value = getattr(value, "value", value)
        return default if value is None else value

    def _names(self, name: str) -> set[str]:
        return {
            str(v).strip().lower() for v in (self._option("scope", name) or []) if str(v).strip()
        }

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        auth_module = require_module(
            module_name="trino.auth", source_name="Trino", uv_groups=["trino"]
        )
        masked = self.config.masked
        scheme = str(self._option("connection", "http_scheme", "https"))
        auth: Any = None
        if masked.access_token:
            auth = auth_module.JWTAuthentication(masked.access_token)
        elif masked.password:
            auth = auth_module.BasicAuthentication(masked.username, masked.password)
        return self._dbapi.connect(
            host=self.config.required.host,
            port=int(self.config.required.port),
            user=masked.username,
            http_scheme=scheme,
            auth=auth,
            catalog=database if database and database != "system" else None,
            verify=bool(self._option("connection", "verify_ssl", True)),
            request_timeout=float(self._option("connection", "request_timeout_seconds", 120)),
            source="classifyre",
        )

    def _rows(self, query: str, database: str | None = None) -> list[tuple[Any, ...]]:
        conn = self._get_cached_connection(database or "system")
        cursor = conn.cursor()
        try:
            cursor.execute(query)
            return [tuple(row) for row in cursor.fetchall()]
        finally:
            cursor.close()

    # ── Discovery ────────────────────────────────────────────────────────

    def _catalog_connectors(self) -> dict[str, str]:
        if self._connectors is None:
            try:
                rows = self._rows(
                    "SELECT catalog_name, connector_name FROM system.metadata.catalogs"
                )
                self._connectors = {str(name): str(connector) for name, connector in rows}
            except Exception as exc:
                logger.debug("Could not read Trino catalog connectors: %s", exc)
                self._connectors = {str(row[0]): "" for row in self._rows("SHOW CATALOGS")}
        return self._connectors

    def _resolve_databases(self) -> list[str]:
        include, exclude = self._names("include_catalogs"), self._names("exclude_catalogs")
        catalogs = []
        for catalog in sorted(self._catalog_connectors()):
            key = catalog.lower()
            if key in _SKIPPED_CATALOGS or key in exclude:
                continue
            if include and key not in include:
                continue
            catalogs.append(catalog)
        return catalogs

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_schemas, exclude_schemas = (
            self._names("include_schemas"),
            self._names("exclude_schemas"),
        )
        objects = self._names("include_objects")
        include_tables = self._option("scope", "include_tables", True) is not False
        include_views = self._option("scope", "include_views", True) is not False
        limit = self._option("scope", "table_limit")
        rows = self._rows(
            f"SELECT table_schema, table_name, table_type FROM {_quote(database)}.information_schema.tables "
            "ORDER BY table_schema, table_name",
            database,
        )
        tables: list[TableRef] = []
        for schema, name, table_type in rows:
            schema_key = str(schema).lower()
            if schema_key in _SKIPPED_SCHEMAS or schema_key in exclude_schemas:
                continue
            if include_schemas and schema_key not in include_schemas:
                continue
            is_view = "VIEW" in str(table_type).upper()
            if (is_view and not include_views) or (not is_view and not include_tables):
                continue
            if objects and not (
                f"{schema_key}.{str(name).lower()}" in objects
                or f"{database.lower()}.{schema_key}.{str(name).lower()}" in objects
            ):
                continue
            tables.append(
                TableRef(
                    database=database,
                    schema=str(schema),
                    table=str(name),
                    object_type="VIEW" if is_view else "TABLE",
                )
            )
            if limit and len(tables) >= int(limit):
                break
        return tables

    # ── Columns ──────────────────────────────────────────────────────────

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        rows = self._rows(
            f"SELECT column_name, data_type FROM {_quote(table_ref.database)}.information_schema.columns "
            f"WHERE table_schema = '{_escape(table_ref.schema)}' "
            f"AND table_name = '{_escape(table_ref.table)}' ORDER BY ordinal_position",
            table_ref.database,
        )
        return {str(name): str(data_type) for name, data_type in rows}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote(identifier)

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return ".".join(
            _quote(p) for p in (table_ref.database, table_ref.schema or "", table_ref.table)
        )

    def _random_order_expr(self) -> str:
        return "random()"

    # ── Lineage ──────────────────────────────────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        if self._option("extraction", "include_view_lineage", True) is False:
            return []
        views = [t for t in tables if (t.object_type or "").upper() == "VIEW"]
        scoped = {t.table_key for t in tables}
        results: list[ViewLineage] = []
        for catalog in sorted({v.database for v in views}):
            try:
                rows = self._rows(
                    f"SELECT table_schema, table_name, view_definition "
                    f"FROM {_quote(catalog)}.information_schema.views",
                    catalog,
                )
            except Exception as exc:
                logger.debug("Could not read view definitions in %s: %s", catalog, exc)
                continue
            for schema, name, definition in rows:
                view = TableRef(
                    database=catalog, schema=str(schema), table=str(name), object_type="VIEW"
                )
                if view.table_key not in scoped or not definition:
                    continue
                upstreams = [
                    key
                    for key in upstream_tables_from_sql(
                        str(definition),
                        dialect="trino",
                        default_database=catalog,
                        default_schema=str(schema),
                    )
                    if key != view.table_key and key in scoped
                ]
                if upstreams:
                    results.append(ViewLineage(view.table_key, tuple(upstreams), str(definition)))
        return results

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str:
        return f"{self.config.required.host}:{self.config.required.port}"

    def _build_external_url(self, table_ref: TableRef) -> str:
        scheme = str(self._option("connection", "http_scheme", "https"))
        return (
            f"{scheme}://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.schema}/{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        connector = self._catalog_connectors().get(table_ref.database, "")
        meta: dict[str, Any] = {"object_type": table_ref.object_type or "TABLE"}
        if connector:
            meta["connector"] = connector
        if (table_ref.object_type or "").upper() == "VIEW":
            meta["table_format"] = "view"
        else:
            meta["table_format"] = _CONNECTOR_FORMATS.get(connector, "native")
        return meta

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None


def _escape(value: str | None) -> str:
    return (value or "").replace("'", "''")
