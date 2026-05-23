from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import (
    HiveInput,
    HiveOptionalConnection,
    HiveOptionalScope,
    SamplingConfig,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_DATABASES = {"information_schema", "sys"}


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


class HiveSource(BaseTabularSource):
    source_type = "hive"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = HiveInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pyhive_hive = require_module(
            module_name="pyhive.hive",
            source_name="Hive",
            uv_groups=["hive"],
            detail="The Hive connector is optional.",
        )
        self._host = self.config.required.host
        self._port = int(self.config.required.port)
        self._table_type_cache: dict[tuple[str, str], str] = {}

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Hive"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

    def _connection_options(self) -> HiveOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return HiveOptionalConnection()

    def _scope_options(self) -> HiveOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return HiveOptionalScope()

    def _connection_scheme(self) -> str:
        connection = self._connection_options()
        scheme = (
            connection.scheme.value if hasattr(connection.scheme, "value") else connection.scheme
        )
        return str(scheme) if scheme else "hive"

    def _connect(self, database: str | None = None) -> Any:
        connection_options = self._connection_options()
        scope_options = self._scope_options()
        target_database = database or scope_options.database or "default"

        connect_kwargs: dict[str, Any] = {
            "host": self._host,
            "port": int(self._port),
            "username": self.config.masked.username,
            "password": self.config.masked.password,
            "database": target_database,
        }

        scheme = self._connection_scheme().lower()
        if scheme == "hive+http":
            connect_kwargs.setdefault("scheme", "http")
        elif scheme in {"hive+https", "databricks+pyhive"}:
            connect_kwargs.setdefault("scheme", "https")

        connect_args = connection_options.connect_args or {}
        if isinstance(connect_args, dict):
            connect_kwargs.update(connect_args)

        hive_module = self._pyhive_hive
        if not hasattr(hive_module, "connect"):
            raise RuntimeError("PyHive module does not expose hive.connect")
        return hive_module.connect(**connect_kwargs)

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "rand()"

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return (
            f"{self._quote_identifier(table_ref.database)}"
            f".{self._quote_identifier(table_ref.table)}"
        )

    # ── Hive uses LIMIT N inline (no param placeholders) ─────────────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        from ...models.generated_input import SamplingStrategy

        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")

        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        from_expr = self._table_select_fqn(table_ref)
        query = f"SELECT {quoted_columns} FROM {from_expr}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return query, []

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    # ── Database / table discovery (HiveQL) ──────────────────────────────

    def _resolve_databases(self) -> list[str]:
        scope = self._scope_options()
        include_all = bool(scope.include_all_databases)
        configured_database = scope.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "Hive source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'default') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        seed = configured_database or "default"
        databases: list[str] = []
        conn = self._get_cached_connection(seed)
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            for row in cursor.fetchall():
                name = row[0] if isinstance(row, tuple) and row else None
                if isinstance(name, str) and name and name not in excluded:
                    databases.append(name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)
        return databases

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip() for name in configured if name.strip()}
        return excluded if excluded else set(_DEFAULT_EXCLUDED_DATABASES)

    def _include_tables_enabled(self) -> bool:
        return self._scope_options().include_tables is not False

    def _include_views_enabled(self) -> bool:
        return self._scope_options().include_views is not False

    def _object_allowlist(self) -> set[str]:
        include_objects = self._scope_options().include_objects or []
        return {entry.strip().lower() for entry in include_objects if entry.strip()}

    def _resolve_object_type(self, database: str, table: str) -> str:
        cache_key = (database, table)
        if cache_key in self._table_type_cache:
            return self._table_type_cache[cache_key]

        object_type = "TABLE"
        try:
            query = f"DESCRIBE FORMATTED {_quote_identifier(database)}.{_quote_identifier(table)}"
            conn = self._get_cached_connection(database)
            with conn.cursor() as cursor:
                cursor.execute(query)
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or not row:
                        continue
                    field_name = row[0]
                    details = row[1] if len(row) > 1 else ""
                    if isinstance(field_name, str) and field_name.strip().lower() == "table type:":
                        detail_text = str(details).strip().upper()
                        if "VIRTUAL_VIEW" in detail_text or "VIEW" in detail_text:
                            object_type = "VIEW"
                        break
        except Exception:
            object_type = "TABLE"

        self._table_type_cache[cache_key] = object_type
        return object_type

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        object_allowlist = self._object_allowlist()
        limit_val = self._scope_options().table_limit
        limit = int(limit_val) if limit_val else None

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
        with conn.cursor() as cursor:
            cursor.execute(f"SHOW TABLES IN {_quote_identifier(database)}")
            for row in cursor.fetchall():
                table_name = row[0] if isinstance(row, tuple) and row else None
                if not isinstance(table_name, str) or not table_name:
                    continue
                if not self._accept_table(object_allowlist, database, None, table_name):
                    continue

                object_type = self._resolve_object_type(database, table_name)
                if object_type == "VIEW" and not include_views:
                    continue
                if object_type != "VIEW" and not include_tables:
                    continue

                tables.append(
                    TableRef(
                        database=database, schema=None, table=table_name, object_type=object_type
                    )
                )
                if limit is not None and len(tables) >= limit:
                    break
        return tables

    # ── Hive has no PKs or FKs ───────────────────────────────────────────

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    # ── Column metadata (HiveQL DESCRIBE) ────────────────────────────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = (
            f"DESCRIBE {_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"
        )
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(query)
            columns: list[str] = []
            for row in cursor.fetchall():
                if not isinstance(row, tuple) or not row:
                    continue
                col_name = row[0]
                if not isinstance(col_name, str):
                    continue
                normalized = col_name.strip()
                if normalized and not normalized.startswith("#"):
                    columns.append(normalized)
            return columns

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"{self._connection_scheme()}://{self._host}:{self._port}/"
            f"{table_ref.database}/{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {"object_type": table_ref.object_type}

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3 and parts[0].upper() == "HIVE":
            return TableRef(database=parts[-2], schema=None, table=parts[-1], object_type="TABLE")
        if len(parts) >= 2:
            return TableRef(database=parts[-2], schema=None, table=parts[-1], object_type="TABLE")
        return None
