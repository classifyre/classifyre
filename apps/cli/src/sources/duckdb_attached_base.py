"""Tabular sources that read a catalog DuckDB attaches: Iceberg REST, DuckLake.

DuckDB can ``ATTACH`` a lakehouse catalog as a database: an Iceberg REST catalog
(``TYPE iceberg``) or a DuckLake (``ducklake:``). Every table in it then reads like
a table of DuckDB's own, through the format's reader — deletes applied, renamed
columns resolved, the current snapshot only. So the whole
:class:`BaseTabularSource` machinery (sampling strategies, ``LIMIT``/``OFFSET``
paging, ``fetch_content_pages`` streaming) runs unchanged on one DuckDB
connection that holds the attachment.

A subclass says how to attach (``_attach``): which extensions, secrets and
``ATTACH`` statement. Discovery, columns and paging are shared here.
"""

from __future__ import annotations

import logging
import threading
from abc import abstractmethod
from typing import Any

from ..utils.duckdb_engine import connect, quote_identifier
from ..utils.duckdb_engine import sql_literal as _sql_literal
from .tabular_base import BaseTabularSource
from .tabular_utils import TableRef

logger = logging.getLogger(__name__)

#: The name the catalog is attached under. One per connection, so it is fixed.
CATALOG_ALIAS = "catalog"


class DuckDBAttachedSource(BaseTabularSource):
    """A tabular source over one catalog attached to an in-memory DuckDB."""

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"
        self._duck: Any = None
        self._duck_lock = threading.Lock()

    # ── Attaching ────────────────────────────────────────────────────────

    @abstractmethod
    def _attach(self, conn: Any) -> None:
        """Load extensions, create secrets and ``ATTACH`` the catalog as ``catalog``."""

    @abstractmethod
    def _require_duckdb(self) -> Any:
        """Import duckdb through the source's own uv group."""

    @abstractmethod
    def _catalog_name(self) -> str:
        """What the catalog is called outside this connection: the ``database``
        of every table, and so part of its asset id and URN."""

    def _duck_connection(self) -> Any:
        with self._duck_lock:
            if self._duck is None:
                conn = connect(self._require_duckdb())
                self._attach(conn)
                self._duck = conn
            return self._duck

    def _connect(self, database: str | None = None) -> Any:
        del database  # one attached catalog per source
        return self._duck_connection().cursor()

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    def cleanup(self) -> None:
        super().cleanup()
        with self._duck_lock:
            if self._duck is not None:
                try:
                    self._duck.close()
                except Exception:
                    pass
                self._duck = None

    @staticmethod
    def _sql_literal(value: str) -> str:
        return _sql_literal(value)

    # ── Discovery ────────────────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        return [self._catalog_name()]

    def _scope_lists(self) -> tuple[set[str], set[str], set[str]]:
        """``(schemas to include, schemas to skip, tables to include)``, lowercased."""
        scope = getattr(getattr(self.config, "optional", None), "scope", None)

        def values(*names: str) -> set[str]:
            for name in names:
                raw = getattr(scope, name, None) if scope is not None else None
                if raw:
                    return {str(v).strip().lower() for v in raw if str(v).strip()}
            return set()

        return (
            values("include_namespaces", "include_schemas"),
            values("exclude_namespaces", "exclude_schemas"),
            values("include_objects"),
        )

    def _table_limit(self) -> int | None:
        scope = getattr(getattr(self.config, "optional", None), "scope", None)
        limit = getattr(scope, "table_limit", None) if scope is not None else None
        return int(limit) if limit else None

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include, exclude, objects = self._scope_lists()
        limit = self._table_limit()
        with self._connect(database) as cursor:
            rows = cursor.execute(
                "SELECT schema_name, table_name FROM duckdb_tables() "
                "WHERE database_name = ? ORDER BY schema_name, table_name",
                [CATALOG_ALIAS],
            ).fetchall()
            views = cursor.execute(
                "SELECT schema_name, view_name FROM duckdb_views() "
                "WHERE database_name = ? AND NOT internal ORDER BY schema_name, view_name",
                [CATALOG_ALIAS],
            ).fetchall()
        found = [(schema, name, "TABLE") for schema, name in rows]
        if self._include_views_enabled():
            found += [(schema, name, "VIEW") for schema, name in views]
        tables: list[TableRef] = []
        for schema_name, table_name, object_type in found:
            schema_key = str(schema_name).lower()
            if include and schema_key not in include:
                continue
            if schema_key in exclude:
                continue
            if objects and f"{schema_key}.{str(table_name).lower()}" not in objects:
                continue
            tables.append(
                TableRef(
                    database=database,
                    schema=str(schema_name),
                    table=str(table_name),
                    object_type=object_type,
                )
            )
            if limit is not None and len(tables) >= limit:
                break
        return tables

    def _include_views_enabled(self) -> bool:
        scope = getattr(getattr(self.config, "optional", None), "scope", None)
        return bool(getattr(scope, "include_views", False)) if scope is not None else False

    # ── Columns ──────────────────────────────────────────────────────────

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        # DESCRIBE, not information_schema: for an attached Iceberg table the
        # latter lists placeholder columns that are not in the table.
        with self._connect(table_ref.database) as cursor:
            rows = cursor.execute(f"DESCRIBE {self._table_select_fqn(table_ref)}").fetchall()
        return {str(row[0]): str(row[1]) for row in rows}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    def _automatic_supports_keyset(self) -> bool:
        # Lakehouse tables have no enforced keys; AUTOMATIC pages by OFFSET.
        return False

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return quote_identifier(identifier)

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return ".".join(
            quote_identifier(part)
            for part in (CATALOG_ALIAS, table_ref.schema or "main", table_ref.table)
        )

    def _random_order_expr(self) -> str:
        return "random()"

    def _param_placeholder(self) -> str:
        return "?"

    # ── Identity ─────────────────────────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None
