from __future__ import annotations

import logging
import ssl as ssl_module
from typing import Any

from ...models.generated_input import (
    MySQLInput,
    MySQLOptionalConnection,
    MySQLOptionalScope,
    MySQLSSLMode,
    SamplingConfig,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_DATABASES = {"information_schema", "mysql", "performance_schema", "sys"}


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


class MySQLSource(BaseTabularSource):
    source_type = "mysql"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = MySQLInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pymysql = require_module(
            module_name="pymysql",
            source_name="MySQL",
            uv_groups=["mysql"],
            detail="The MySQL connector is optional.",
        )

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "MySQL"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

    def _connection_options(self) -> MySQLOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return MySQLOptionalConnection()

    def _scope_options(self) -> MySQLOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return MySQLOptionalScope()

    def _build_ssl_kwargs(self, connection_options: MySQLOptionalConnection) -> dict[str, Any]:
        ssl_mode = connection_options.ssl_mode or MySQLSSLMode.PREFERRED
        ssl_ca_pem = self.config.masked.ssl_ca

        if ssl_mode == MySQLSSLMode.DISABLED:
            return {"ssl_disabled": True}
        if ssl_mode == MySQLSSLMode.PREFERRED and not ssl_ca_pem:
            return {}

        ctx = ssl_module.create_default_context()
        if ssl_ca_pem:
            normalized = ssl_ca_pem.replace("\\n", "\n").replace("\r\n", "\n").strip()
            ctx.load_verify_locations(cadata=normalized)

        if ssl_mode == MySQLSSLMode.VERIFY_IDENTITY:
            ctx.check_hostname = True
            ctx.verify_mode = ssl_module.CERT_REQUIRED
        elif ssl_mode == MySQLSSLMode.VERIFY_CA:
            ctx.check_hostname = False
            ctx.verify_mode = ssl_module.CERT_REQUIRED
        else:
            ctx.check_hostname = False
            ctx.verify_mode = ssl_module.CERT_NONE

        return {"ssl": ctx}

    def _connect(self, database: str | None = None) -> Any:
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "host": self.config.required.host,
            "port": int(self.config.required.port),
            "user": self.config.masked.username,
            "password": self.config.masked.password,
            "connect_timeout": int(connection_options.connect_timeout_seconds or 30),
        }
        if database:
            connect_kwargs["database"] = database

        connect_kwargs.update(self._build_ssl_kwargs(connection_options))
        if connection_options.allow_public_key_retrieval:
            connect_kwargs["allow_public_key_retrieval"] = True

        connection = self._pymysql.connect(**connect_kwargs)
        connection.autocommit(True)
        return connection

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            return bool(conn.open)
        except Exception:
            return False

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "RAND()"

    # ── MySQL uses db.table (no schema) ──────────────────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return (
            f"{self._quote_identifier(table_ref.database)}"
            f".{self._quote_identifier(table_ref.table)}"
        )

    # ── Database / table discovery ───────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        scope = self._scope_options()
        include_all = bool(scope.include_all_databases)
        configured_database = scope.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "MySQL source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'app_db') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []
        conn = self._get_cached_connection()
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            for row in cursor.fetchall():
                name = row[0] if isinstance(row, tuple) else None
                if isinstance(name, str) and name and name not in excluded:
                    databases.append(name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)
        return databases

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {db.strip() for db in configured if db.strip()}
        return excluded if excluded else set(_DEFAULT_EXCLUDED_DATABASES)

    def _table_allowlist(self) -> set[str]:
        include_tables = self._scope_options().include_tables or []
        return {item.strip().lower() for item in include_tables if item.strip()}

    def _table_limit(self) -> int | None:
        limit = self._scope_options().table_limit
        return int(limit) if limit else None

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        table_allowlist = self._table_allowlist()
        limit = self._table_limit()

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """,
                (database,),
            )
            for row in cursor.fetchall():
                table_name = row[0] if isinstance(row, tuple) else None
                if not isinstance(table_name, str) or not table_name:
                    continue
                if not self._accept_table(table_allowlist, database, None, table_name):
                    continue
                tables.append(TableRef(database=database, schema=None, table=table_name))
                if limit is not None and len(tables) >= limit:
                    break
        return tables

    # ── Primary keys (MySQL-specific query) ──────────────────────────────

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name
                FROM information_schema.key_column_usage
                WHERE constraint_name = 'PRIMARY'
                  AND table_schema = %s
                  AND table_name = %s
                ORDER BY ordinal_position
                """,
                (table_ref.database, table_ref.table),
            )
            return [row[0] for row in cursor.fetchall() if isinstance(row[0], str)]

    # ── Column metadata (MySQL uses table_schema = database) ─────────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                (table_ref.database, table_ref.table),
            )
            return [
                row[0]
                for row in cursor.fetchall()
                if isinstance(row, tuple) and row and isinstance(row[0], str)
            ]

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        # MySQL is 2-level: the database lives in ``table_schema``.
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name, column_type
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                (table_ref.database, table_ref.table),
            )
            result: dict[str, str] = {}
            for row in cursor.fetchall():
                if isinstance(row, tuple) and row and isinstance(row[0], str):
                    result[row[0]] = str(row[1]) if len(row) > 1 and row[1] is not None else ""
            return result

    # ── Foreign key links ────────────────────────────────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        all_keys = {t.table_key for t in tables}
        by_database: dict[str, set[tuple[str, ...]]] = {}
        for t in tables:
            by_database.setdefault(t.database, set()).add(t.table_key)

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                conn = self._get_cached_connection(database)
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            TABLE_SCHEMA   AS source_database,
                            TABLE_NAME     AS source_table,
                            REFERENCED_TABLE_SCHEMA AS target_database,
                            REFERENCED_TABLE_NAME   AS target_table
                        FROM information_schema.KEY_COLUMN_USAGE
                        WHERE TABLE_SCHEMA = %s
                          AND REFERENCED_TABLE_SCHEMA IS NOT NULL
                          AND REFERENCED_TABLE_NAME IS NOT NULL
                        """,
                        (database,),
                    )
                    for src_db, src_table, tgt_db, tgt_table in cursor.fetchall():
                        source_key = (src_db, src_table)
                        target_key = (tgt_db, tgt_table)
                        if source_key in scoped_keys and target_key in all_keys:
                            links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve foreign key links for database %s: %s", database, exc
                )
        return links

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"mysql://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.table}"
        )

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3 and parts[0].upper() == "MYSQL":
            return TableRef(database=parts[-2], schema=None, table=parts[-1])
        if len(parts) >= 2:
            return TableRef(database=parts[-2], schema=None, table=parts[-1])
        return None
