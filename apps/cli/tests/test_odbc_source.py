"""The ODBC source, against a fake ``pyodbc`` backed by an in-memory SQLite file.

SQLite stands in for "a database behind an ODBC driver": it answers real SQL, so
paging and keyset reads are exercised for real, while the fake supplies the
catalog functions (``tables``, ``columns``, ``primaryKeys``, ``foreignKeys``) the
way a driver does, including their pattern matching (``_`` and ``%`` are
wildcards in ODBC catalog calls).
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from src.sources.odbc.source import OdbcSource, TableRef
from src.utils.odbc_connection import (
    build_connection_string,
    endpoint_label,
    parse_attributes,
    urn_endpoint,
)

SQL_DBMS_NAME = 17
SQL_DBMS_VER = 18
SQL_IDENTIFIER_QUOTE_CHAR = 29
SQL_CATALOG_USAGE = 92


def _like(pattern: str | None, value: str) -> bool:
    if pattern is None:
        return True
    regex = "".join(".*" if c == "%" else "." if c == "_" else re.escape(c) for c in pattern)
    return re.fullmatch(regex, value) is not None


class _FakeCursor:
    def __init__(self, conn: _FakeConnection) -> None:
        self._conn = conn
        self._cursor = conn.db.cursor()
        self._rows: list[tuple[Any, ...]] = []
        self.description: Any = None
        self.timeout = 0
        self.fetched = 0

    # catalog functions
    def tables(self, **_kwargs: Any) -> _FakeCursor:
        rows = self._conn.db.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        self._rows = [(None, None, name, kind.upper(), None) for name, kind in rows]
        return self

    def columns(self, table: str | None = None, **_kwargs: Any) -> _FakeCursor:
        out: list[tuple[Any, ...]] = []
        for (name,) in self._conn.db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            if not _like(table, name):
                continue
            for cid, col, ctype, *_ in self._conn.db.execute(f'PRAGMA table_info("{name}")'):
                out.append(
                    (
                        None,
                        None,
                        name,
                        col,
                        12,
                        ctype or "TEXT",
                        0,
                        0,
                        0,
                        0,
                        1,
                        None,
                        None,
                        12,
                        0,
                        0,
                        cid + 1,
                        "YES",
                    )
                )
        self._rows = out
        return self

    def primaryKeys(  # noqa: N802 - pyodbc's spelling
        self, table: str | None = None, **_kwargs: Any
    ) -> _FakeCursor:
        out: list[tuple[Any, ...]] = []
        for _cid, col, _t, _nn, _d, pk in self._conn.db.execute(f'PRAGMA table_info("{table}")'):
            if pk:
                out.append((None, None, table, col, pk, "pk"))
        self._rows = out
        return self

    def foreignKeys(  # noqa: N802 - pyodbc's spelling
        self,
        foreignTable: str | None = None,  # noqa: N803
        **_kwargs: Any,
    ) -> _FakeCursor:
        out = []
        for _id, seq, ref, src, dst, *_ in self._conn.db.execute(
            f'PRAGMA foreign_key_list("{foreignTable}")'
        ):
            out.append((None, None, ref, dst, None, None, foreignTable, src, seq + 1))
        self._rows = out
        return self

    # statements
    def execute(self, query: str, params: Any = None) -> _FakeCursor:
        self._conn.queries.append(query)
        self._cursor.execute(query, list(params) if params else [])
        self.description = self._cursor.description
        self._rows = []
        return self

    def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
        if self.description is not None and not self._rows:
            rows = self._cursor.fetchmany(size)
            self.fetched += len(rows)
            return rows
        rows, self._rows = self._rows[:size], self._rows[size:]
        return rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self.fetchmany(10**9)

    def fetchone(self) -> tuple[Any, ...] | None:
        rows = self.fetchmany(1)
        return rows[0] if rows else None

    def __iter__(self) -> Any:
        return iter(self._rows)

    def close(self) -> None:
        self._cursor.close()


class _FakeConnection:
    def __init__(self, path: str, dbms: str, log: list[str]) -> None:
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.dbms = dbms
        self.queries = log
        self.timeout = 0

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self)

    def getinfo(self, what: int) -> Any:
        return {
            SQL_DBMS_NAME: self.dbms,
            SQL_DBMS_VER: "3.45",
            SQL_IDENTIFIER_QUOTE_CHAR: '"',
            SQL_CATALOG_USAGE: 0,
        }[what]

    def close(self) -> None:
        self.db.close()


class _FakePyodbc:
    SQL_DBMS_NAME = SQL_DBMS_NAME
    SQL_DBMS_VER = SQL_DBMS_VER
    SQL_IDENTIFIER_QUOTE_CHAR = SQL_IDENTIFIER_QUOTE_CHAR
    SQL_CATALOG_USAGE = SQL_CATALOG_USAGE

    def __init__(self, path: str, dbms: str = "SQLite") -> None:
        self.path = path
        self.dbms = dbms
        self.queries: list[str] = []
        self.connect_args: list[tuple[str, dict[str, Any]]] = []

    def connect(self, connection_string: str, **kwargs: Any) -> _FakeConnection:
        self.connect_args.append((connection_string, kwargs))
        return _FakeConnection(self.path, self.dbms, self.queries)


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "ODBC",
        "required": {"connection_string": "Driver={SQLite3};Database=lab"},
        "masked": {"username": "admin", "password": "admin"},
        "sampling": {"strategy": "ALL", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture
def fake(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> _FakePyodbc:
    path = str(tmp_path / "lab.db")
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id),
            total REAL
        );
        CREATE TABLE log_lines (message TEXT);
        CREATE TABLE a_b (x INTEGER);
        CREATE TABLE axb (y INTEGER);
        CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 10;
        """
    )
    db.executemany("INSERT INTO customers VALUES (?, ?)", [(i, f"c{i}") for i in range(1, 13)])
    db.executemany(
        "INSERT INTO orders VALUES (?, ?, ?)", [(i, (i % 12) + 1, i * 2.5) for i in range(1, 13)]
    )
    db.executemany("INSERT INTO log_lines VALUES (?)", [(f"line {i}",) for i in range(1, 13)])
    db.commit()
    db.close()
    module = _FakePyodbc(path)
    monkeypatch.setattr("src.sources.odbc.source.require_module", lambda **_kw: module)
    return module


async def _discover(source: OdbcSource) -> dict[str, Any]:
    assets = {}
    async for batch in source.extract_raw():
        for asset in batch:
            assets[asset.name] = asset
    return assets


async def _pages(source: OdbcSource, asset: Any) -> list[tuple[str, str]]:
    return [page async for page in source.fetch_content_pages(asset.hash)]


# ── connection string ────────────────────────────────────────────────────


def test_connection_string_appends_credentials_and_braces_unsafe_values() -> None:
    recipe = _recipe(masked={"username": "svc;admin", "password": "p}w;d=1"})
    built = build_connection_string(recipe)
    assert built == "Driver={SQLite3};Database=lab;UID={svc;admin};PWD={p}}w;d=1};"
    attributes = parse_attributes(built)
    assert attributes["UID"] == "svc;admin"
    assert attributes["PWD"] == "p}w;d=1"
    assert attributes["DRIVER"] == "SQLite3"


def test_connection_string_without_credentials_is_the_dsn_alone() -> None:
    built = build_connection_string(
        _recipe(required={"connection_string": "DSN=finance_dw;"}, masked={})
    )
    assert built == "DSN=finance_dw;"
    assert endpoint_label(built) == "finance_dw"


def test_endpoint_is_read_from_every_common_spelling() -> None:
    assert urn_endpoint("Driver={x};Server=DB.Internal;Port=5433", "postgres") == "db.internal:5433"
    assert (
        urn_endpoint("Driver={x};Server=tcp:sql.corp,1444;Database=a", "mssql") == "sql.corp:1444"
    )
    assert urn_endpoint("Driver={x};Host=h", "mysql") == "h:3306"
    assert urn_endpoint("DSN=finance_dw", "postgres") is None


# ── discovery ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_discovery_lists_tables_and_views_with_catalog_free_names(
    fake: _FakePyodbc,
) -> None:
    source = OdbcSource(_recipe())
    assets = await _discover(source)

    assert set(assets) == {
        "default.customers",
        "default.orders",
        "default.log_lines",
        "default.a_b",
        "default.axb",
        "default.big_orders",
    }
    orders = assets["default.orders"]
    assert orders.metadata["table_name"] == "orders"
    assert [c["name"] for c in orders.metadata["columns"]] == ["id", "customer_id", "total"]
    assert orders.metadata["dbms_name"] == "SQLite"
    assert orders.metadata["qualified_name"] == '"orders"'
    assert "catalog" not in orders.metadata  # the driver has no catalogs
    assert assets["default.big_orders"].metadata["table_type"] == "VIEW"
    assert orders.urn is None  # SQLite has no source of its own to meet
    # The connection string that reached the driver carries the credentials.
    assert fake.connect_args[0][0] == "Driver={SQLite3};Database=lab;UID=admin;PWD=admin;"
    assert fake.connect_args[0][1]["autocommit"] is True


@pytest.mark.asyncio
@pytest.mark.usefixtures("fake")
async def test_columns_of_a_table_whose_name_holds_a_wildcard_are_exact() -> None:
    """``a_b`` as an ODBC pattern also matches ``axb``; only its own columns count."""
    source = OdbcSource(_recipe())
    columns = source._available_column_types(TableRef("default", None, "a_b"))
    assert columns == {"x": "INTEGER"}


@pytest.mark.asyncio
@pytest.mark.usefixtures("fake")
async def test_scope_filters_apply() -> None:
    source = OdbcSource(
        _recipe(
            optional={
                "scope": {
                    "include_views": False,
                    "exclude_schemas": ["main"],
                    "include_objects": ["orders"],
                }
            }
        )
    )
    assert set(await _discover(source)) == {"default.orders"}


@pytest.mark.asyncio
@pytest.mark.usefixtures("fake")
async def test_foreign_keys_become_links() -> None:
    source = OdbcSource(_recipe())
    assets = await _discover(source)
    assert assets["default.orders"].links == [assets["default.customers"].hash]
    off = OdbcSource(_recipe(optional={"extraction": {"include_foreign_keys": False}}))
    assert (await _discover(off))["default.orders"].links == []


@pytest.mark.usefixtures("fake")
def test_test_connection_names_the_database() -> None:
    result = OdbcSource(_recipe()).test_connection()
    assert result["status"] == "SUCCESS"
    assert "SQLite 3.45" in result["message"]


# ── reading rows ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["customers", "log_lines"])
async def test_odbc_fetch_content_pages_batches_for_all_strategy(
    fake: _FakePyodbc, table: str
) -> None:
    """12 rows at rows_per_page=10: a keyed table pages by key, a keyless one streams."""
    source = OdbcSource(_recipe())
    assets = await _discover(source)
    fake.queries.clear()

    pages = await _pages(source, assets[f"default.{table}"])

    assert len(pages) == 12
    assert "c1" in pages[0][0] or "line 1" in pages[0][0]
    reads = [q for q in fake.queries if q.startswith("SELECT") and "FROM" in q]
    if table == "customers":
        # Keyset: two pages (10 + 2), each bounded in SQL, after the row count.
        paged = [q for q in reads if "LIMIT" in q]
        assert len(paged) == 2
        assert 'WHERE "id" > ?' in paged[1]
    else:
        # No key: one unbounded statement read in chunks of the page size.
        assert not any("LIMIT" in q for q in reads)


@pytest.mark.asyncio
async def test_sampling_reads_one_window(fake: _FakePyodbc) -> None:
    for strategy in ("RANDOM", "LATEST"):
        source = OdbcSource(_recipe(sampling={"strategy": strategy, "rows_per_page": 10}))
        assets = await _discover(source)
        pages = await _pages(source, assets["default.orders"])
        assert len(pages) == 10, strategy
    random_query = [q for q in fake.queries if "RANDOM()" in q]
    assert random_query and random_query[0].endswith("LIMIT 10 OFFSET 0")


@pytest.mark.asyncio
async def test_client_side_window_reads_only_what_it_needs(fake: _FakePyodbc) -> None:
    recipe = _recipe(
        optional={"connection": {"paging": "client_side"}},
        sampling={"strategy": "RANDOM", "rows_per_page": 10},
    )
    source = OdbcSource(recipe)
    assets = await _discover(source)
    fake.queries.clear()
    pages = await _pages(source, assets["default.log_lines"])
    assert len(pages) == 10
    assert not any("LIMIT" in q or "FETCH" in q for q in fake.queries)


@pytest.mark.asyncio
@pytest.mark.usefixtures("fake")
async def test_automatic_walks_a_table_across_runs() -> None:
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
    source = OdbcSource(recipe)
    assets = await _discover(source)
    first = await _pages(source, assets["default.customers"])
    assert len(first) == 10
    cursor = source._next_sampling_cursor
    assert cursor is not None

    # The next run resumes from the stored cursor and finds the rest.
    nxt = OdbcSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    nxt._sampling_cursor = cursor
    await _discover(nxt)
    second = await _pages(nxt, assets["default.customers"])
    assert 0 < len(second) <= 10


def test_window_sql_per_dialect(fake: _FakePyodbc) -> None:
    source = OdbcSource(_recipe())
    assert source._window_sql("SELECT 1", 5, 10).endswith("LIMIT 5 OFFSET 10")

    fake.dbms = "Microsoft SQL Server"
    mssql = OdbcSource(_recipe())
    assert mssql._window_sql("SELECT a FROM t", 5, 10) == (
        "SELECT a FROM t ORDER BY (SELECT NULL) OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY"
    )
    assert mssql._window_sql("SELECT a FROM t ORDER BY a", 5, 0) == (
        "SELECT a FROM t ORDER BY a OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY"
    )

    fake.dbms = "Oracle"
    assert OdbcSource(_recipe())._window_sql("SELECT a FROM t", 5, 10) == (
        "SELECT a FROM t OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY"
    )

    fake.dbms = "Some Mainframe DB"
    unknown = OdbcSource(_recipe())
    assert unknown._window_sql("SELECT a FROM t", 5, 10) == "SELECT a FROM t"
    assert unknown._random_order_expr() == ""


def test_urn_matches_the_native_connector(
    fake: _FakePyodbc, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake.dbms = "PostgreSQL"
    source = OdbcSource(
        _recipe(
            required={
                "connection_string": "Driver={PostgreSQL Unicode};Server=db.internal;Port=5432;Database=app"
            }
        )
    )
    monkeypatch.setattr(source, "_supports_catalogs", lambda: True)
    table = TableRef("app", "public", "Users")
    assert source._table_urn(table) == "postgres://db.internal/app/public/users"
    # A DSN hides the server: no URN rather than a guess.
    dsn = OdbcSource(_recipe(required={"connection_string": "DSN=pg"}))
    monkeypatch.setattr(dsn, "_supports_catalogs", lambda: True)
    assert dsn._table_urn(table) is None


def test_fields_are_written_in_each_driver_familys_spelling() -> None:
    def built(driver: str, **fields: Any) -> str:
        return build_connection_string(
            {"required": {"driver": driver, "host": "db.test", **fields}, "masked": {}}
        )

    assert built("PostgreSQL Unicode", port=5432, database="app") == (
        "Driver={PostgreSQL Unicode};Server=db.test;Port=5432;Database=app;"
    )
    assert built("ODBC Driver 18 for SQL Server", port=1444, database="sales") == (
        "Driver={ODBC Driver 18 for SQL Server};Server=db.test,1444;Database=sales;"
    )
    assert built("Oracle in instantclient_23_0", database="XE") == (
        "Driver={Oracle in instantclient_23_0};DBQ=//db.test:1521/XE;"
    )
    assert built("IBM DB2 ODBC DRIVER", port=50000, database="d") == (
        "Driver={IBM DB2 ODBC DRIVER};HostName=db.test;Port=50000;Database=d;"
    )
    assert built("Teradata Database ODBC Driver 20.00") == (
        "Driver={Teradata Database ODBC Driver 20.00};DBCName=db.test;"
    )
    assert built("Simba Spark ODBC Driver", port=10000) == (
        "Driver={Simba Spark ODBC Driver};Host=db.test;Port=10000;"
    )


def test_dsn_and_extra_attributes_and_credentials() -> None:
    recipe = {
        "required": {"driver": "PostgreSQL Unicode", "host": "h"},
        "masked": {"username": "u", "password": "p"},
        "optional": {
            "connection": {
                "attributes": [
                    {"name": "SSLmode", "value": "require"},
                    {"name": "Server", "value": "override;1"},
                ]
            }
        },
    }
    # Attributes come after the fields (so a later Server= wins), then UID/PWD.
    assert build_connection_string(recipe) == (
        "Driver={PostgreSQL Unicode};Server=h;SSLmode=require;Server={override;1};UID=u;PWD=p;"
    )
    assert build_connection_string({"required": {"dsn": "finance_dw"}}) == "DSN=finance_dw;"
    with pytest.raises(ValueError, match="driver and host"):
        build_connection_string({"required": {"driver": "x"}})
    assert (
        endpoint_label(
            build_connection_string({"required": {"driver": "x", "host": "H", "port": 9}})
        )
        == "h:9"
    )
