"""Any database that has an ODBC driver: tables, views, columns, keys and rows.

ODBC is the one interface nearly every engine ships a driver for (SQL Server,
Oracle, DB2, Teradata, Informix, Firebird, Vertica, ClickHouse, Spark, a DSN
that fronts a mainframe), so this source reads through the interface instead of
through an engine's own library. Discovery uses ODBC's *catalog functions*
(``SQLTables``, ``SQLColumns``, ``SQLPrimaryKeys``, ``SQLForeignKeys``), which
every driver answers in its own dialect, so no ``information_schema`` query has
to be guessed per database.

Rows are read with ``SELECT`` statements. The only dialect-specific part is
limiting them: the driver names the database it fronts (``SQL_DBMS_NAME``) and
that picks ``LIMIT … OFFSET …`` or ``OFFSET … FETCH``; a database that is not
known reads from the start of the table and stops, which is correct for every
engine and only costs a longer read when a window starts deep into a table.

The same connection string is what the SQL query job hands DuckDB's
``odbc_scanner`` (``src/query/bindings.py``), so a table that scans also queries.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from ...models.generated_input import OdbcInput, SamplingConfig, SamplingStrategy
from ...utils.odbc_connection import (
    URN_PLATFORMS,
    build_connection_string,
    endpoint_label,
    urn_endpoint,
)
from ...utils.urn import Urn, UrnError
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

#: What a table's "database" is when the driver reports no catalog for it.
_NO_CATALOG_LABEL = "default"

#: The one "database" discovery walks: ODBC lists every catalog a connection can
#: see in a single call, and each table carries its own.
_ALL_CATALOGS = "*"

#: Schemas that hold an engine's own catalog, never user data.
_SYSTEM_SCHEMAS = {
    "information_schema",
    "pg_catalog",
    "pg_toast",
    "sys",
    "mysql",
    "performance_schema",
    "sysibm",
    "syscat",
    "sysstat",
    "sysfun",
    "sysproc",
    "sysibmadm",
    "systools",
    "sysibmts",
    "sysibminternal",
    "nullid",
    "sqlj",
    "system",
    "ctxsys",
    "mdsys",
    "olapsys",
    "ordsys",
    "outln",
    "wmsys",
    "xdb",
    "dbsnmp",
    "appqossys",
    "audsys",
    "gsmadmin_internal",
    "lbacsys",
    "dvsys",
    "oracle_ocm",
    "remote_scheduler_agent",
}

#: A catalog the engine keeps for itself.
_SYSTEM_CATALOGS = {"master", "model", "msdb", "tempdb", "system", "rdsadmin"}


@dataclass(frozen=True)
class _Dialect:
    """How one engine limits rows, as far as ODBC itself does not say."""

    #: ``limit`` = ``LIMIT n OFFSET m``; ``fetch`` = ``OFFSET m ROWS FETCH NEXT n ROWS ONLY``;
    #: ``client`` = no SQL window: read from the start and stop.
    window: str
    random: str | None = None
    #: SQL Server refuses ``OFFSET`` without an ``ORDER BY``.
    needs_order: bool = False


# Matched against ``SQL_DBMS_NAME`` (lower-cased), first hit wins.
_DIALECTS: tuple[tuple[str, _Dialect], ...] = (
    ("postgres", _Dialect("limit", "RANDOM()")),
    ("redshift", _Dialect("limit", "RANDOM()")),
    ("mysql", _Dialect("limit", "RAND()")),
    ("mariadb", _Dialect("limit", "RAND()")),
    ("sqlite", _Dialect("limit", "RANDOM()")),
    ("duckdb", _Dialect("limit", "RANDOM()")),
    ("snowflake", _Dialect("limit", "RANDOM()")),
    ("vertica", _Dialect("limit", "RANDOM()")),
    ("clickhouse", _Dialect("limit", "rand()")),
    ("spark", _Dialect("limit", "rand()")),
    ("hive", _Dialect("limit", "rand()")),
    ("databricks", _Dialect("limit", "rand()")),
    ("microsoft sql server", _Dialect("fetch", "NEWID()", needs_order=True)),
    ("oracle", _Dialect("fetch", "DBMS_RANDOM.VALUE")),
    ("db2", _Dialect("fetch", "RAND()")),
)
_PAGING_OVERRIDES = {
    "limit_offset": "limit",
    "offset_fetch": "fetch",
    "client_side": "client",
}
_UNKNOWN = _Dialect("client")


def _fetch_in_chunks(cursor: Any, skip: int, take: int) -> list[tuple[Any, ...]]:
    """``take`` rows after the first ``skip``, never holding more than one chunk."""
    remaining = skip
    while remaining > 0:
        chunk = cursor.fetchmany(min(remaining, 5000))
        if not chunk:
            return []
        remaining -= len(chunk)
    return [tuple(row) for row in cursor.fetchmany(take)]


class OdbcSource(BaseTabularSource):
    source_type = "odbc"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = OdbcInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pyodbc = require_module(
            module_name="pyodbc",
            source_name="ODBC",
            uv_groups=["odbc"],
            detail=(
                "pyodbc needs the unixODBC driver manager and the database's ODBC driver "
                "installed on the scanning host."
            ),
        )
        self._connection_string = build_connection_string(recipe)
        self._label = endpoint_label(self._connection_string)
        self._dialect_cache: tuple[_Dialect, str] | None = None
        self._catalogs_cache: bool | None = None
        self._quote_char: str | None = None
        self._meta_lock = threading.Lock()

    # ── Configuration ────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "ODBC"

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

    def _include_views_enabled(self) -> bool:
        return self._option("scope", "include_views", True) is not False

    def _table_limit(self) -> int | None:
        limit = self._option("scope", "table_limit")
        return int(limit) if limit else None

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        del database  # one connection string, every catalog behind it
        conn = self._pyodbc.connect(
            self._connection_string,
            timeout=int(self._option("connection", "login_timeout_seconds", 15)),
            # No transaction is ever opened: a scan only reads, and a driver in
            # manual-commit mode keeps a snapshot (and locks) open for the run.
            autocommit=True,
        )
        query_timeout = int(self._option("connection", "query_timeout_seconds", 120))
        if query_timeout > 0:
            try:
                conn.timeout = query_timeout
            except Exception as exc:
                # SQL_ATTR_CONNECTION_TIMEOUT is optional and several drivers
                # (psqlodbc) refuse it; the per-statement timeout is tried next.
                logger.debug("Driver ignores the connection timeout: %s", exc)
        return conn

    def _cursor(self, conn: Any) -> Any:
        """A cursor with the statement timeout set, for drivers that honour it."""
        cursor = conn.cursor()
        query_timeout = int(self._option("connection", "query_timeout_seconds", 120))
        if query_timeout > 0:
            try:
                cursor.timeout = query_timeout
            except Exception as exc:
                logger.debug("Driver ignores the statement timeout: %s", exc)
        return cursor

    def _get_cached_connection(self, database: str | None = None) -> Any:
        # A connection is not shared between threads (pyodbc's threadsafety is
        # 1, and several drivers refuse a second open statement): one per thread.
        return super()._get_cached_connection(f"{database or ''}#{threading.get_ident()}")

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            conn.getinfo(self._pyodbc.SQL_DBMS_NAME)
            return True
        except Exception:
            return False

    def _driver_facts(self) -> tuple[_Dialect, str]:
        """``(dialect, SQL_DBMS_NAME)`` of the connected database."""
        with self._meta_lock:
            if self._dialect_cache is None:
                conn = self._get_cached_connection(_ALL_CATALOGS)
                name = str(conn.getinfo(self._pyodbc.SQL_DBMS_NAME) or "").strip()
                chosen = _PAGING_OVERRIDES.get(str(self._option("connection", "paging", "auto")))
                dialect = _UNKNOWN
                lowered = name.lower()
                for needle, candidate in _DIALECTS:
                    if needle in lowered:
                        dialect = candidate
                        break
                if chosen is not None:
                    dialect = _Dialect(
                        chosen,
                        dialect.random,
                        # ``fetch`` on SQL Server needs an ORDER BY whichever way it was chosen.
                        needs_order=dialect.needs_order or "sql server" in lowered,
                    )
                self._dialect_cache = (dialect, name)
            return self._dialect_cache

    def _dialect(self) -> _Dialect:
        return self._driver_facts()[0]

    def _dbms_name(self) -> str:
        return self._driver_facts()[1]

    # ── Catalogs ─────────────────────────────────────────────────────────

    def _supports_catalogs(self) -> bool:
        """Whether the driver puts catalogs in table names (``SQL_CATALOG_USAGE``).

        Oracle, DB2 and SQLite do not: their tables are ``schema.table`` and the
        "database" of a :class:`TableRef` is only a label.
        """
        with self._meta_lock:
            if self._catalogs_cache is None:
                conn = self._get_cached_connection(_ALL_CATALOGS)
                try:
                    self._catalogs_cache = int(conn.getinfo(self._pyodbc.SQL_CATALOG_USAGE)) != 0
                except Exception:
                    self._catalogs_cache = True
            return self._catalogs_cache

    def _real_catalog(self, table_ref: TableRef) -> str | None:
        if table_ref.database == _NO_CATALOG_LABEL or not self._supports_catalogs():
            return None
        return table_ref.database

    # ── Discovery ────────────────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        return [_ALL_CATALOGS]

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        del database
        include_catalogs, exclude_catalogs = (
            self._names("include_catalogs"),
            self._names("exclude_catalogs"),
        )
        include_schemas, exclude_schemas = (
            self._names("include_schemas"),
            self._names("exclude_schemas"),
        )
        objects = self._names("include_objects")
        include_tables = self._option("scope", "include_tables", True) is not False
        include_views = self._include_views_enabled()
        limit = self._table_limit()

        conn = self._get_cached_connection(_ALL_CATALOGS)
        cursor = self._cursor(conn)
        try:
            rows = [tuple(row) for row in cursor.tables()]
        finally:
            cursor.close()

        tables: list[TableRef] = []
        for row in sorted(rows, key=lambda r: tuple(str(part or "") for part in r[:3])):
            catalog, schema, name, table_type = (row + (None,) * 4)[:4]
            if not isinstance(name, str) or not name:
                continue
            kind = str(table_type or "TABLE").upper()
            if "SYSTEM" in kind or "TEMP" in kind or kind in {"ALIAS", "SYNONYM", "INDEX"}:
                continue
            is_view = "VIEW" in kind
            if (is_view and not include_views) or (not is_view and not include_tables):
                continue
            schema_name = str(schema) if schema else None
            catalog_name = str(catalog) if catalog else _NO_CATALOG_LABEL
            schema_key = (schema_name or "").lower()
            catalog_key = catalog_name.lower()
            if schema_key in _SYSTEM_SCHEMAS or schema_key in exclude_schemas:
                continue
            if catalog and (catalog_key in _SYSTEM_CATALOGS or catalog_key in exclude_catalogs):
                continue
            if include_schemas and schema_key not in include_schemas:
                continue
            if include_catalogs and catalog_key not in include_catalogs:
                continue
            if objects and not self._object_selected(objects, catalog_name, schema_name, name):
                continue
            tables.append(
                TableRef(
                    database=catalog_name,
                    schema=schema_name,
                    table=name,
                    object_type="VIEW" if is_view else "TABLE",
                )
            )
            if limit is not None and len(tables) >= limit:
                break
        return tables

    @staticmethod
    def _object_selected(objects: set[str], catalog: str, schema: str | None, table: str) -> bool:
        names = {table.lower()}
        if schema:
            names.add(f"{schema}.{table}".lower())
            names.add(f"{catalog}.{schema}.{table}".lower())
        else:
            names.add(f"{catalog}.{table}".lower())
        return bool(names & objects)

    # ── Catalog calls ────────────────────────────────────────────────────

    def _catalog_args(self, table_ref: TableRef) -> dict[str, Any]:
        return {
            "table": table_ref.table,
            "catalog": self._real_catalog(table_ref),
            "schema": table_ref.schema,
        }

    @staticmethod
    def _same(value: Any, expected: str | None) -> bool:
        """Catalog functions take *patterns* (``_`` and ``%`` are wildcards), so a
        row is kept only when its name is the one asked for."""
        return (str(value) if value else None) == (expected or None)

    def _matching_rows(self, rows: list[tuple[Any, ...]], table_ref: TableRef) -> list[Any]:
        real = self._real_catalog(table_ref)
        return [
            row
            for row in rows
            if self._same(row[2], table_ref.table)
            and self._same(row[1], table_ref.schema)
            and (real is None or not row[0] or self._same(row[0], real))
        ]

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        conn = self._get_cached_connection(table_ref.database)
        cursor = self._cursor(conn)
        try:
            rows = [tuple(row) for row in cursor.columns(**self._catalog_args(table_ref))]
        finally:
            cursor.close()
        matching = self._matching_rows(rows, table_ref)
        # ODBC orders by ORDINAL_POSITION (column 17), which some drivers omit.
        matching.sort(key=lambda r: r[16] if len(r) > 16 and isinstance(r[16], int) else 0)
        return {str(row[3]): str(row[5] or "") for row in matching if row[3]}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
        cursor = self._cursor(conn)
        try:
            rows = [tuple(row) for row in cursor.primaryKeys(**self._catalog_args(table_ref))]
        finally:
            cursor.close()
        matching = self._matching_rows(rows, table_ref)
        matching.sort(key=lambda r: r[4] if len(r) > 4 and isinstance(r[4], int) else 0)
        return [str(row[3]) for row in matching if row[3]]

    def _collect_foreign_key_links(
        self, tables: list[TableRef]
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        if self._option("extraction", "include_foreign_keys", True) is False:
            return {}
        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        for table_ref in tables:
            if self._aborted:
                break
            if (table_ref.object_type or "").upper() == "VIEW":
                continue
            try:
                conn = self._get_cached_connection(table_ref.database)
                cursor = self._cursor(conn)
                try:
                    rows = [
                        tuple(row)
                        for row in cursor.foreignKeys(
                            foreignTable=table_ref.table,
                            foreignCatalog=self._real_catalog(table_ref),
                            foreignSchema=table_ref.schema,
                        )
                    ]
                finally:
                    cursor.close()
            except Exception as exc:
                # A driver without SQLForeignKeys: no links, not a failed scan.
                logger.debug("No foreign keys for %s: %s", table_ref.display_name, exc)
                if "optional feature not implemented" in str(exc).lower():
                    break  # the driver has no SQLForeignKeys at all
                continue
            for row in rows:
                # (pk catalog, schema, table, column, fk catalog, schema, table, column, …)
                if len(row) < 8 or not self._same(row[6], table_ref.table):
                    continue
                if not self._same(row[5], table_ref.schema):
                    continue
                target_schema = str(row[1]) if row[1] else None
                target_db = str(row[0]) if row[0] else _NO_CATALOG_LABEL
                target = (
                    (target_db, target_schema, str(row[2]))
                    if target_schema is not None
                    else (target_db, str(row[2]))
                )
                if target != table_ref.table_key:
                    links.setdefault(table_ref.table_key, set()).add(target)
        return links

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        if self._quote_char is None:
            conn = self._get_cached_connection(_ALL_CATALOGS)
            char = str(conn.getinfo(self._pyodbc.SQL_IDENTIFIER_QUOTE_CHAR) or "").strip()
            self._quote_char = char
        char = self._quote_char
        if not char:
            return identifier
        return f"{char}{identifier.replace(char, char * 2)}{char}"

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        parts = [self._real_catalog(table_ref), table_ref.schema, table_ref.table]
        return ".".join(self._quote_identifier(part) for part in parts if part)

    def _random_order_expr(self) -> str:
        return self._dialect().random or ""

    def _param_placeholder(self) -> str:
        return "?"

    def _window_sql(self, query: str, limit: int, offset: int) -> str:
        """``query`` with its rows limited, or ``query`` unchanged for a client-side window."""
        dialect = self._dialect()
        if dialect.window == "limit":
            return f"{query} LIMIT {int(limit)} OFFSET {int(offset)}"
        if dialect.window == "fetch":
            order = (
                " ORDER BY (SELECT NULL)"
                if dialect.needs_order and " order by " not in query.lower()
                else ""
            )
            return f"{query}{order} OFFSET {int(offset)} ROWS FETCH NEXT {int(limit)} ROWS ONLY"
        return query

    def _read_window(
        self,
        conn: Any,
        query: str,
        params: list[Any] | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        """Rows ``offset`` … ``offset + limit`` of ``query``, and its column names."""
        windowed = self._window_sql(query, limit, offset)
        in_sql = windowed != query
        cursor = self._cursor(conn)
        try:
            if params:
                cursor.execute(windowed, params)
            else:
                cursor.execute(windowed)
            names = [str(desc[0]) for desc in cursor.description] if cursor.description else []
            if not names:
                return [], []
            if in_sql:
                return [tuple(row) for row in cursor.fetchmany(limit)], names
            return _fetch_in_chunks(cursor, offset, limit), names
        finally:
            cursor.close()

    # ── Rows ─────────────────────────────────────────────────────────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")
        quoted = ", ".join(self._quote_identifier(c) for c in columns)
        query = f"SELECT {quoted} FROM {self._table_select_fqn(table_ref)}"
        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False and self._random_order_expr():
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM and self._random_order_expr():
            # An engine whose random function is unknown reads the table's own order.
            query += f" ORDER BY {self._random_order_expr()}"
        return query, []

    def _fetch_sample_rows(
        self, table_ref: TableRef
    ) -> tuple[list[tuple[Any, ...]], list[str]] | None:
        strategy = self._sampling().strategy
        if strategy in (SamplingStrategy.AUTOMATIC, SamplingStrategy.ALL):
            return super()._fetch_sample_rows(table_ref)
        columns = self._available_columns(table_ref)
        query, _ = self._build_sampling_query(table_ref, columns)
        rows, names = self._fetch_one_page(
            table_ref, query, int(self._sampling().rows_per_page or 100), 0
        )
        return (rows, names) if names else None

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)
        return self._read_window(conn, base_query, None, page_size, offset)

    def _fetch_page_keyset(
        self,
        conn: Any,
        base_query: str,
        *,
        page_size: int,
        pk_columns: list[str],
        pk_order: str,
        last_pk_values: list[Any] | None,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        params: list[Any] = []
        query = base_query
        if last_pk_values is not None:
            if len(pk_columns) == 1:
                query += f" WHERE {self._quote_identifier(pk_columns[0])} > ?"
                params = [last_pk_values[0]]
            else:
                # Row-value comparison is not in every dialect; spell it out.
                params = []
                branches = []
                for i, column in enumerate(pk_columns):
                    equal = [f"{self._quote_identifier(c)} = ?" for c in pk_columns[:i]]
                    branches.append(
                        "(" + " AND ".join([*equal, f"{self._quote_identifier(column)} > ?"]) + ")"
                    )
                    params.extend([*last_pk_values[:i], last_pk_values[i]])
                query += " WHERE " + " OR ".join(branches)
        query += f" ORDER BY {pk_order}"
        return self._read_window(conn, query, params or None, page_size, 0)

    def _fetch_page_key_range(
        self,
        conn: Any,
        base_query: str,
        *,
        page_size: int,
        pk_column: str,
        after: Any,
        before: Any,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        column = self._quote_identifier(pk_column)
        conditions: list[str] = []
        params: list[Any] = []
        if after is not None:
            conditions.append(f"{column} > ?")
            params.append(after)
        if before is not None:
            conditions.append(f"{column} < ?")
            params.append(before)
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"{base_query}{where} ORDER BY {column} DESC"
        return self._read_window(conn, query, params or None, page_size, 0)

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_platform(self) -> str | None:
        lowered = self._dbms_name().lower()
        for needle, platform in URN_PLATFORMS.items():
            if needle in lowered:
                return platform
        return None

    def _urn_authority(self) -> str | None:
        platform = self._urn_platform()
        return urn_endpoint(self._connection_string, platform) if platform else None

    def _table_urn(self, table_ref: TableRef) -> str | None:
        """The URN the engine's own source would give this table, when ODBC can tell.

        Only for engines with a source of their own, a connection string that
        names the server, and a table the driver placed in a real catalog: then
        the name is the same, character for character, and a scan through ODBC
        and a scan through the native connector meet on one object.
        """
        platform = self._urn_platform()
        authority = self._urn_authority()
        if not platform or not authority or self._real_catalog(table_ref) is None:
            return None
        try:
            return str(Urn.of(platform, authority, *table_ref.fqn_parts))
        except UrnError as exc:
            logger.debug("No URN for %s: %s", table_ref.display_name, exc)
            return None

    def _build_external_url(self, table_ref: TableRef) -> str:
        path = "/".join(quote(part, safe="") for part in table_ref.fqn_parts)
        return f"odbc://{quote(self._label, safe=':')}/{path}"

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        is_view = (table_ref.object_type or "").upper() == "VIEW"
        meta: dict[str, Any] = {
            "object_type": table_ref.object_type or "TABLE",
            "table_format": "view" if is_view else "native",
        }
        catalog = self._real_catalog(table_ref)
        if catalog:
            meta["catalog"] = catalog
        name = self._dbms_name()
        if name:
            meta["dbms_name"] = name
        meta["qualified_name"] = self._table_select_fqn(table_ref)
        return meta

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        if len(parts) == 2:
            return TableRef(database=parts[0], schema=None, table=parts[1])
        return None

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        from datetime import UTC, datetime

        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            conn = self._connect()
            try:
                # Not `SELECT 1`: Oracle and DB2 want a FROM clause. The driver
                # naming its database is proof enough that the sign-in worked.
                name = str(conn.getinfo(self._pyodbc.SQL_DBMS_NAME) or "").strip()
                version = str(conn.getinfo(self._pyodbc.SQL_DBMS_VER) or "").strip()
            finally:
                conn.close()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Connected to {name or 'the database'}"
                f"{f' {version}' if version else ''} through ODBC ({self._label})."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect through ODBC to {self._label}: {exc}"
        return result
