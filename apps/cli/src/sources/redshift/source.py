"""Amazon Redshift (provisioned and Serverless), with Spectrum external tables.

Redshift is a Postgres-protocol warehouse, but its catalog is its own: the
``SVV_ALL_*`` views list local tables, views and the external tables of
Redshift Spectrum together — the tables a Redshift user reads straight out of
S3, Iceberg, Hudi and Delta included. ``information_schema`` lists none of
those, which is why it is not used.

Sign-in is a database password or IAM (``redshift_connector`` fetches temporary
credentials for the user from the cluster or Serverless workgroup).
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import RedshiftInput, SamplingConfig
from ...utils.sql_lineage import upstream_tables_from_sql
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage

logger = logging.getLogger(__name__)

_SKIPPED_SCHEMAS = {"pg_catalog", "information_schema", "pg_internal", "pg_automv"}


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def spectrum_table_format(input_format: str, parameters: str) -> str:
    """The format of a Spectrum external table, from its Glue/Hive description."""
    text = f"{input_format} {parameters}".lower()
    if "iceberg" in text:
        return "iceberg"
    if "hudi" in text:
        return "hudi"
    if "delta" in text or "symlinktextinputformat" in text:
        return "delta"
    return "external"


class RedshiftSource(BaseTabularSource):
    source_type = "redshift"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = RedshiftInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._external: dict[tuple[str, str], tuple[str, str, str]] = {}

    @property
    def _source_label(self) -> str:
        return "Amazon Redshift"

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

    def _database(self) -> str:
        return str(self.config.required.database)

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        connector = require_module(
            module_name="redshift_connector", source_name="Amazon Redshift", uv_groups=["redshift"]
        )
        masked = self.config.masked
        kwargs: dict[str, Any] = {
            "host": self.config.required.host,
            "port": int(self.config.required.port),
            "database": database or self._database(),
            "user": masked.username,
            "ssl": bool(self._option("connection", "ssl", True)),
            "timeout": int(self._option("connection", "connect_timeout_seconds", 30)),
        }
        if masked.password:
            kwargs["password"] = masked.password
        else:
            kwargs["iam"] = True
            kwargs["db_user"] = masked.username
            kwargs["region"] = self._option("connection", "region")
            if self._option("connection", "cluster_identifier"):
                kwargs["cluster_identifier"] = self._option("connection", "cluster_identifier")
            if self._option("connection", "workgroup_name"):
                kwargs["serverless_work_group"] = self._option("connection", "workgroup_name")
                kwargs["is_serverless"] = True
            if masked.aws_access_key_id and masked.aws_secret_access_key:
                kwargs["access_key_id"] = masked.aws_access_key_id
                kwargs["secret_access_key"] = masked.aws_secret_access_key
                if masked.aws_session_token:
                    kwargs["session_token"] = masked.aws_session_token
        conn = connector.connect(**kwargs)
        conn.autocommit = True
        return conn

    def _rows(self, query: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
        conn = self._get_cached_connection(self._database())
        cursor = conn.cursor()
        try:
            cursor.execute(query, params or None)
            return [tuple(row) for row in cursor.fetchall()]
        finally:
            cursor.close()

    # ── Discovery ────────────────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        return [self._database()]

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include, exclude = self._names("include_schemas"), self._names("exclude_schemas")
        include_tables = self._option("scope", "include_tables", True) is not False
        include_views = self._option("scope", "include_views", True) is not False
        include_external = self._option("scope", "include_external_schemas", True) is not False
        objects = self._names("include_objects")
        limit = self._option("scope", "table_limit")
        if include_external:
            for schema, table, location, input_format, parameters in self._rows(
                "SELECT schemaname, tablename, location, input_format, parameters "
                "FROM svv_external_tables"
            ):
                self._external[(str(schema), str(table))] = (
                    str(location or ""),
                    str(input_format or ""),
                    str(parameters or ""),
                )
        tables: list[TableRef] = []
        for schema, name, table_type in self._rows(
            "SELECT schema_name, table_name, table_type FROM svv_all_tables "
            "WHERE database_name = %s ORDER BY schema_name, table_name",
            (database,),
        ):
            schema_key, kind = str(schema).lower(), str(table_type).upper()
            if schema_key in _SKIPPED_SCHEMAS or schema_key in exclude:
                continue
            if include and schema_key not in include:
                continue
            is_view, is_external = "VIEW" in kind, "EXTERNAL" in kind
            if is_external and not include_external:
                continue
            if (is_view and not include_views) or (not is_view and not include_tables):
                continue
            if objects and f"{schema_key}.{str(name).lower()}" not in objects:
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

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        rows = self._rows(
            "SELECT column_name, data_type FROM svv_all_columns "
            "WHERE database_name = %s AND schema_name = %s AND table_name = %s "
            "ORDER BY ordinal_position",
            (table_ref.database, table_ref.schema, table_ref.table),
        )
        return {str(name): str(data_type) for name, data_type in rows}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        # Redshift records primary keys but never enforces them, so they cannot
        # be trusted to page by.
        return []

    def _automatic_supports_keyset(self) -> bool:
        return False

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote(identifier)

    def _random_order_expr(self) -> str:
        return "RANDOM()"

    # ── Lineage ──────────────────────────────────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        if self._option("extraction", "include_view_lineage", True) is False:
            return []
        views = [t for t in tables if (t.object_type or "").upper() == "VIEW"]
        if not views:
            return []
        scoped = {t.table_key for t in tables}
        definitions = {
            (str(schema), str(name)): str(definition or "")
            for schema, name, definition in self._rows(
                "SELECT schemaname, viewname, definition FROM pg_views"
            )
        }
        results: list[ViewLineage] = []
        for view in views:
            sql = definitions.get((view.schema or "", view.table))
            if not sql:
                continue
            upstreams = [
                key
                for key in upstream_tables_from_sql(
                    sql,
                    dialect="redshift",
                    default_database=view.database,
                    default_schema=view.schema,
                )
                if key != view.table_key and key in scoped
            ]
            if upstreams:
                results.append(ViewLineage(view.table_key, tuple(upstreams), sql))
        return results

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str:
        return f"{self.config.required.host}:{self.config.required.port}"

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"redshift://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.schema}/{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        meta: dict[str, Any] = {"object_type": table_ref.object_type or "TABLE"}
        external = self._external.get((table_ref.schema or "", table_ref.table))
        if (table_ref.object_type or "").upper() == "VIEW":
            meta["table_format"] = "view"
        elif external:
            location, input_format, parameters = external
            meta["table_format"] = spectrum_table_format(input_format, parameters)
            if location:
                meta["location"] = location
        else:
            meta["table_format"] = "native"
        return meta

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None
