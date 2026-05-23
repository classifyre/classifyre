from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ...models.generated_input import (
    OracleInput,
    OracleOptionalConnection,
    OracleOptionalScope,
    SamplingConfig,
    SamplingStrategy,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_SCHEMAS = {
    "SYS",
    "SYSTEM",
    "DBSNMP",
    "WMSYS",
    "CTXSYS",
    "XDB",
    "MDSYS",
    "ORDSYS",
    "OUTLN",
    "ORDDATA",
}


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class OracleSource(BaseTabularSource):
    source_type = "oracle"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = OracleInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._oracledb = require_module(
            module_name="oracledb",
            source_name="Oracle",
            uv_groups=["oracle"],
            detail="The Oracle connector is optional.",
        )
        self._host = self.config.required.host
        self._port = int(self.config.required.port)
        self._service_name = self.config.required.service_name

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Oracle"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

    def _connection_options(self) -> OracleOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return OracleOptionalConnection()

    def _scope_options(self) -> OracleOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return OracleOptionalScope()

    def _dsn(self) -> str:
        if hasattr(self._oracledb, "makedsn"):
            return str(
                self._oracledb.makedsn(
                    self._host,
                    int(self._port),
                    service_name=self._service_name,
                )
            )
        return f"{self._host}:{self._port}/{self._service_name}"

    def _connect(self, database: str | None = None) -> Any:
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "user": self.config.masked.username,
            "password": self.config.masked.password,
            "dsn": self._dsn(),
            "tcp_connect_timeout": int(connection_options.connect_timeout_seconds or 30),
        }
        try:
            return self._oracledb.connect(**connect_kwargs)
        except TypeError:
            connect_kwargs.pop("tcp_connect_timeout", None)
            return self._oracledb.connect(**connect_kwargs)

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            conn.ping()
            return True
        except Exception:
            return False

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "DBMS_RANDOM.VALUE"

    def _supports_nulls_last(self) -> bool:
        return True

    def _scope_label(self) -> str:
        return "object"

    # ── Oracle uses FETCH FIRST N ROWS ONLY ──────────────────────────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Object {table_ref.display_name} has no readable columns")

        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        from_expr = self._table_select_fqn(table_ref)

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return f"SELECT {quoted_columns} FROM {from_expr}", []

        rows_per_page = int(sampling.rows_per_page or 100)
        query = f"SELECT {quoted_columns} FROM {from_expr}"

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        query += f" FETCH FIRST {rows_per_page} ROWS ONLY"
        return query, []

    # ── Oracle OFFSET/FETCH pagination ───────────────────────────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)
        paginated_query = f"{base_query} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
        with conn.cursor() as cursor:
            cursor.execute(paginated_query)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── Oracle keyset pagination with named params ───────────────────────

    def _fetch_page_keyset(
        self,
        conn: Any,
        base_query: str,
        page_size: int,
        pk_columns: list[str],
        pk_order: str,
        last_pk_values: list[Any] | None,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        bind: dict[str, Any] = {}
        if last_pk_values is None:
            paginated_query = f"{base_query} ORDER BY {pk_order} FETCH FIRST {page_size} ROWS ONLY"
        elif len(pk_columns) == 1:
            where = f"WHERE {self._quote_identifier(pk_columns[0])} > :pk0"
            paginated_query = (
                f"{base_query} {where} ORDER BY {pk_order} FETCH FIRST {page_size} ROWS ONLY"
            )
            bind = {"pk0": last_pk_values[0]}
        else:
            pk_cols_quoted = ", ".join(self._quote_identifier(c) for c in pk_columns)
            placeholders = ", ".join(f":pk{i}" for i in range(len(pk_columns)))
            where = f"WHERE ({pk_cols_quoted}) > ({placeholders})"
            paginated_query = (
                f"{base_query} {where} ORDER BY {pk_order} FETCH FIRST {page_size} ROWS ONLY"
            )
            bind = {f"pk{i}": last_pk_values[i] for i in range(len(pk_columns))}

        with conn.cursor() as cursor:
            cursor.execute(paginated_query, bind if bind else [])
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── Case-insensitive column resolution (Oracle uppercases) ───────────

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        normalized = {column.lower(): column for column in columns}

        configured = sampling.order_by_column
        if configured:
            resolved = normalized.get(configured.lower())
            if resolved:
                return resolved

        from ..tabular_base import _LATEST_COLUMN_CANDIDATES

        for candidate in _LATEST_COLUMN_CANDIDATES:
            resolved = normalized.get(candidate)
            if resolved:
                return resolved
        return None

    # ── LOB handling in cell serialization ────────────────────────────────

    def _serialize_cell(self, value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, memoryview):
            value = value.tobytes()

        # Oracle LOB objects have a .read() method
        if hasattr(value, "read"):
            try:
                value = value.read()
            except Exception:
                value = str(value)

        if isinstance(value, (bytes, bytearray)):
            return f"<{len(value)} bytes>"
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    # ── Database discovery (Oracle = single service) ─────────────────────

    def _resolve_databases(self) -> list[str]:
        return [self._service_name]

    # ── Schema/table discovery (Oracle catalog views) ────────────────────

    def _default_excluded_schemas(self) -> set[str]:
        return set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {schema.strip().upper() for schema in configured if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip().upper() for schema in configured if schema.strip()}
        return denylist if denylist else set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _include_tables_enabled(self) -> bool:
        return self._scope_options().include_tables is not False

    def _include_views_enabled(self) -> bool:
        return self._scope_options().include_views is not False

    def _include_view_lineage_enabled(self) -> bool:
        scope = self._scope_options()
        return bool(scope.include_view_lineage or scope.include_view_column_lineage)

    def _object_allowlist(self) -> set[str]:
        include_objects = self._scope_options().include_objects or []
        return {entry.strip().lower() for entry in include_objects if entry.strip()}

    def _table_limit(self) -> int | None:
        table_limit = self._scope_options().table_limit
        return int(table_limit) if table_limit else None

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        object_allowlist = self._object_allowlist()
        limit = self._table_limit()

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)

        with conn.cursor() as cursor:
            if include_tables:
                cursor.execute(
                    """
                    SELECT owner, table_name
                    FROM all_tables
                    ORDER BY owner, table_name
                    """
                )
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or len(row) < 2:
                        continue
                    schema_name = row[0]
                    object_name = row[1]
                    if not isinstance(schema_name, str) or not isinstance(object_name, str):
                        continue

                    schema_upper = schema_name.upper()
                    if schema_upper in schema_denylist:
                        continue
                    if schema_allowlist and schema_upper not in schema_allowlist:
                        continue

                    scoped_name = f"{schema_upper}.{object_name}".lower()
                    service_scoped_name = f"{database}.{schema_upper}.{object_name}".lower()
                    if (
                        object_allowlist
                        and scoped_name not in object_allowlist
                        and service_scoped_name not in object_allowlist
                    ):
                        continue

                    tables.append(
                        TableRef(
                            database=database,
                            schema=schema_upper,
                            table=object_name,
                            object_type="TABLE",
                        )
                    )
                    if limit is not None and len(tables) >= limit:
                        return tables

            if include_views:
                cursor.execute(
                    """
                    SELECT owner, view_name
                    FROM all_views
                    ORDER BY owner, view_name
                    """
                )
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or len(row) < 2:
                        continue
                    schema_name = row[0]
                    object_name = row[1]
                    if not isinstance(schema_name, str) or not isinstance(object_name, str):
                        continue

                    schema_upper = schema_name.upper()
                    if schema_upper in schema_denylist:
                        continue
                    if schema_allowlist and schema_upper not in schema_allowlist:
                        continue

                    scoped_name = f"{schema_upper}.{object_name}".lower()
                    service_scoped_name = f"{database}.{schema_upper}.{object_name}".lower()
                    if (
                        object_allowlist
                        and scoped_name not in object_allowlist
                        and service_scoped_name not in object_allowlist
                    ):
                        continue

                    tables.append(
                        TableRef(
                            database=database,
                            schema=schema_upper,
                            table=object_name,
                            object_type="VIEW",
                        )
                    )
                    if limit is not None and len(tables) >= limit:
                        return tables

        return tables

    # ── Primary keys (Oracle catalog) ────────────────────────────────────

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        if table_ref.object_type == "VIEW":
            return []
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT cols.column_name
                FROM all_constraints cons
                JOIN all_cons_columns cols
                  ON cons.owner = cols.owner
                 AND cons.constraint_name = cols.constraint_name
                WHERE cons.constraint_type = 'P'
                  AND cons.owner = :owner
                  AND cons.table_name = :table_name
                ORDER BY cols.position
                """,
                {
                    "owner": table_ref.schema,
                    "table_name": table_ref.table,
                },
            )
            return [
                row[0]
                for row in cursor.fetchall()
                if isinstance(row, tuple) and row and isinstance(row[0], str)
            ]

    # ── Column metadata (Oracle catalog) ─────────────────────────────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name
                FROM all_tab_columns
                WHERE owner = :owner
                  AND table_name = :table_name
                ORDER BY column_id
                """,
                {
                    "owner": table_ref.schema,
                    "table_name": table_ref.table,
                },
            )
            return [
                row[0]
                for row in cursor.fetchall()
                if isinstance(row, tuple) and row and isinstance(row[0], str)
            ]

    # ── Foreign key + view dependency links (merged) ─────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}

        # FK links
        fk_links = self._collect_fk_links(tables)
        for source, targets in fk_links.items():
            links.setdefault(source, set()).update(targets)

        # View lineage links
        if self._include_view_lineage_enabled():
            view_links = self._collect_view_links(tables)
            for source, targets in view_links.items():
                links.setdefault(source, set()).update(targets)

        return links

    def _collect_fk_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        table_keys = {t.table_key for t in tables if t.object_type == "TABLE"}
        if not table_keys:
            return {}

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        try:
            conn = self._get_cached_connection(self._service_name)
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        src.owner AS source_owner,
                        src.table_name AS source_table,
                        tgt.owner AS target_owner,
                        tgt.table_name AS target_table
                    FROM all_constraints src
                    JOIN all_constraints tgt
                      ON src.r_owner = tgt.owner
                     AND src.r_constraint_name = tgt.constraint_name
                    WHERE src.constraint_type = 'R'
                    """
                )
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or len(row) < 4:
                        continue
                    source_schema, source_name, target_schema, target_name = (
                        row[0],
                        row[1],
                        row[2],
                        row[3],
                    )
                    if not all(
                        isinstance(v, str)
                        for v in (source_schema, source_name, target_schema, target_name)
                    ):
                        continue

                    source_key = (self._service_name, str(source_schema).upper(), str(source_name))
                    target_key = (self._service_name, str(target_schema).upper(), str(target_name))
                    if source_key not in table_keys or target_key not in table_keys:
                        continue
                    links.setdefault(source_key, set()).add(target_key)
        except Exception as exc:
            logger.warning("Could not resolve Oracle foreign key links: %s", exc)

        return links

    def _collect_view_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        object_keys = {t.table_key for t in tables}
        view_keys = {t.table_key for t in tables if t.object_type == "VIEW"}
        if not view_keys:
            return {}

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        try:
            conn = self._get_cached_connection(self._service_name)
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        owner,
                        name,
                        referenced_owner,
                        referenced_name,
                        referenced_type
                    FROM all_dependencies
                    WHERE type = 'VIEW'
                      AND referenced_type IN ('TABLE', 'VIEW')
                    """
                )
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or len(row) < 5:
                        continue
                    owner, name, ref_owner, ref_name = row[0], row[1], row[2], row[3]
                    if not all(isinstance(v, str) for v in (owner, name, ref_owner, ref_name)):
                        continue

                    source_key = (self._service_name, str(owner).upper(), str(name))
                    target_key = (self._service_name, str(ref_owner).upper(), str(ref_name))
                    if source_key not in view_keys or target_key not in object_keys:
                        continue
                    links.setdefault(source_key, set()).add(target_key)
        except Exception as exc:
            logger.warning("Could not resolve Oracle view lineage links: %s", exc)

        return links

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"oracle://{self._host}:{self._port}/{table_ref.database}/"
            f"{table_ref.schema}.{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {
            "object_type": table_ref.object_type,
            "lineage": {
                "include_view_lineage": bool(self._scope_options().include_view_lineage),
                "include_view_column_lineage": bool(
                    self._scope_options().include_view_column_lineage
                ),
            },
        }

    def _finding_base_path(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"

    # ── Test connection (Oracle uses SELECT 1 FROM dual) ─────────────────

    def test_connection(self) -> dict[str, Any]:
        from datetime import UTC
        from datetime import datetime as dt

        logger.info("Testing connection to %s...", self._source_label)
        result: dict[str, Any] = {
            "timestamp": dt.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            conn = self._connect()
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM dual")
                    cursor.fetchone()
            finally:
                conn.close()

            tables = self._iter_tables()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Oracle. Reachable objects: {len(tables)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Oracle: {exc}"
        return result

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 5 and parts[0].upper() == "ORACLE":
            # Backward compatibility: ORACLE_#_ENV_#_SERVICE_#_SCHEMA_#_OBJECT
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        if len(parts) >= 4 and parts[0].upper() == "ORACLE":
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        if len(parts) >= 4:
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        if len(parts) >= 3:
            return TableRef(
                database=self._service_name, schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        return None
