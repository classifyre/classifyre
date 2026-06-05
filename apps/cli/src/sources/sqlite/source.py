"""SQLite source — proof of BaseTabularSource reusability.

SQLite is a serverless, file-based database.  It uses Python's built-in
``sqlite3`` module so there are **no optional dependencies**.  The source
supports table discovery, random/latest/all sampling strategies, foreign-key
link resolution, and keyset pagination — all inherited from
:class:`BaseTabularSource`.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any

from ...models.generated_input import (
    SamplingConfig,
    SQLiteInput,
    SQLiteOptionalScope,
)
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


def _quote_identifier(identifier: str) -> str:
    """Quote a SQLite identifier with double-quotes."""
    return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'


class SQLiteSource(BaseTabularSource):
    """Scan tables in a local SQLite database file."""

    source_type = "sqlite"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = SQLiteInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "SQLite"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Scope helpers ────────────────────────────────────────────────────

    def _scope_options(self) -> SQLiteOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return SQLiteOptionalScope()

    def _database_path(self) -> str:
        return self.config.required.database_path

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        """Open a ``sqlite3`` connection to the configured database file.

        The *database* argument is accepted for API compatibility with the
        base class but is ignored — SQLite always connects to the single
        configured ``database_path``.
        """
        path = self._database_path()
        if not Path(path).is_file():
            raise FileNotFoundError(f"SQLite database file not found: {path}")
        conn = sqlite3.connect(path)
        conn.row_factory = None  # ensure tuples
        return conn

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "RANDOM()"

    def _supports_nulls_last(self) -> bool:
        # SQLite 3.30+ supports NULLS LAST
        return True

    def _param_placeholder(self) -> str:
        return "?"

    # ── Database / table discovery ───────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        """Return the single database filename as the 'database' identifier."""
        return [self._database_path()]

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        """List user tables from ``sqlite_master``."""
        table_allowlist = self._table_allowlist()
        limit = self._table_limit()

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
        cursor = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name"
        )
        for (table_name,) in cursor.fetchall():
            if not isinstance(table_name, str) or not table_name:
                continue
            if not self._accept_table(table_allowlist, database, None, table_name):
                continue
            tables.append(TableRef(database=database, schema=None, table=table_name))
            if limit is not None and len(tables) >= limit:
                break
        return tables

    def _table_allowlist(self) -> set[str]:
        include_tables = self._scope_options().include_tables or []
        return {item.strip().lower() for item in include_tables if item.strip()}

    def _table_limit(self) -> int | None:
        limit = self._scope_options().table_limit
        return int(limit) if limit else None

    # ── Table select FQN (just table name for SQLite) ────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return self._quote_identifier(table_ref.table)

    # ── Column metadata ──────────────────────────────────────────────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        cursor = conn.execute(f"PRAGMA table_info({self._quote_identifier(table_ref.table)})")
        return [row[1] for row in cursor.fetchall() if isinstance(row[1], str)]

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        # PRAGMA table_info row: (cid, name, type, notnull, dflt_value, pk)
        conn = self._get_cached_connection(table_ref.database)
        cursor = conn.execute(f"PRAGMA table_info({self._quote_identifier(table_ref.table)})")
        result: dict[str, str] = {}
        for row in cursor.fetchall():
            if isinstance(row[1], str):
                result[row[1]] = str(row[2]) if row[2] else ""
        return result

    # ── Primary keys ─────────────────────────────────────────────────────

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        cursor = conn.execute(f"PRAGMA table_info({self._quote_identifier(table_ref.table)})")
        pk_cols: list[tuple[int, str]] = []
        for row in cursor.fetchall():
            # row: (cid, name, type, notnull, dflt_value, pk)
            if row[5]:  # pk > 0
                pk_cols.append((row[5], row[1]))
        pk_cols.sort()
        return [name for _, name in pk_cols]

    # ── Foreign key links ────────────────────────────────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        all_keys = {t.table_key for t in tables}
        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}

        conn = self._get_cached_connection(self._database_path())
        for table_ref in tables:
            try:
                cursor = conn.execute(
                    f"PRAGMA foreign_key_list({self._quote_identifier(table_ref.table)})"
                )
                for row in cursor.fetchall():
                    # row: (id, seq, table, from, to, on_update, on_delete, match)
                    referenced_table = row[2]
                    if not isinstance(referenced_table, str):
                        continue
                    target_key = (table_ref.database, referenced_table)
                    source_key = table_ref.table_key
                    if target_key in all_keys:
                        links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve foreign key links for table %s: %s",
                    table_ref.table,
                    exc,
                )
        return links

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return f"sqlite:///{table_ref.database}/{table_ref.table}"

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) == 2:
            return TableRef(database=parts[0], schema=None, table=parts[1])
        return None
