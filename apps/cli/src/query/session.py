"""One DuckDB session per query: views over the allowed tables, one deadline.

Order of work, all inside one deadline so a slow ``ATTACH`` counts against the
time the person asked for (the proof of concept's review, finding F02):

1. validate the SQL against the request's tables (:mod:`.gate`);
2. attach only the sources the SQL reads, and create a view
   ``"<source>"."<schema>"."<table>"`` over each table it names;
3. lock the configuration, so nothing the query does can change a setting;
4. run ``SELECT * FROM (<sql>) LIMIT max_rows + 1`` and return Arrow, cut to
   ``max_rows`` and ``max_result_bytes`` with ``truncated`` set.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..utils.duckdb_engine import connect, load_extension, quote_identifier, require_duckdb
from .bindings import BindingError, SourceBinding, TableLocation
from .gate import QueryRefusedError, TableName, validate

logger = logging.getLogger(__name__)

DEFAULT_MAX_ROWS = 10_000
DEFAULT_MAX_RESULT_BYTES = 32 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 120


#: Formats a query can be exported as, and their media types.
EXPORT_FORMATS = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "parquet": "application/vnd.apache.parquet",
}
#: One sheet holds 1,048,576 rows, the header included.
XLSX_MAX_ROWS = 1_048_575
#: Excel refuses longer text in one cell.
XLSX_MAX_CELL_CHARS = 32_767
#: Column types Excel has no cell for: written as text.
_XLSX_AS_TEXT = (
    "[]",
    "STRUCT",
    "MAP",
    "UNION",
    "BLOB",
    "UUID",
    "INTERVAL",
    "HUGEINT",
    "UHUGEINT",
    "BIT",
    "TIME",
    "WITH TIME ZONE",
    "GEOMETRY",
)


class QueryTimeoutError(RuntimeError):
    """The deadline passed, during setup or while the query ran."""


@dataclass
class QueryRequest:
    """The request the API hands a query job (see docs/prd/DQ-data-query.md §5)."""

    run_id: str
    sql: str
    sources: list[dict[str, Any]]
    tables: list[dict[str, Any]]
    max_rows: int = DEFAULT_MAX_ROWS
    max_result_bytes: int = DEFAULT_MAX_RESULT_BYTES
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    memory_limit: str | None = None
    threads: int | None = None
    callback_url: str | None = None
    callback_token: str | None = None
    #: "xlsx" | "csv" | "parquet": write a file instead of returning Arrow.
    export_format: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> QueryRequest:
        def positive(key: str, default: int) -> int:
            value = data.get(key)
            return int(value) if isinstance(value, (int, float)) and value > 0 else default

        threads = data.get("threads")
        return cls(
            run_id=str(data.get("runId") or ""),
            sql=str(data.get("sql") or ""),
            sources=[s for s in data.get("sources") or [] if isinstance(s, dict)],
            tables=[t for t in data.get("tables") or [] if isinstance(t, dict)],
            max_rows=positive("maxRows", DEFAULT_MAX_ROWS),
            max_result_bytes=positive("maxResultBytes", DEFAULT_MAX_RESULT_BYTES),
            timeout_seconds=positive("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS),
            memory_limit=str(data["memoryLimit"]) if data.get("memoryLimit") else None,
            threads=int(threads) if isinstance(threads, int) and threads > 0 else None,
            callback_url=str(data["callbackUrl"]) if data.get("callbackUrl") else None,
            callback_token=str(data["callbackToken"]) if data.get("callbackToken") else None,
            export_format=(
                str(data["exportFormat"]).lower()
                if str(data.get("exportFormat") or "").lower() in EXPORT_FORMATS
                else None
            ),
        )


@dataclass
class QueryResult:
    #: Arrow IPC stream, or the exported file.
    arrow: bytes
    row_count: int
    truncated: bool
    truncated_reason: str | None
    columns: list[dict[str, str]]
    timings: dict[str, int] = field(default_factory=dict)
    tables: list[str] = field(default_factory=list)
    media_type: str = "application/vnd.apache.arrow.stream"
    export_format: str | None = None


@dataclass
class _Table:
    name: TableName
    source_alias: str
    location: TableLocation


class QuerySession:
    """Runs one :class:`QueryRequest`; use as a context manager."""

    def __init__(self, request: QueryRequest) -> None:
        self.request = request
        self._duckdb = require_duckdb()
        self._spill = tempfile.TemporaryDirectory(prefix="classifyre-query-")
        self._conn: Any = None
        self._bindings: dict[str, SourceBinding] = {}
        for index, entry in enumerate(request.sources):
            alias = str(entry.get("alias") or "").lower()
            recipe = entry.get("recipe")
            if alias and isinstance(recipe, dict):
                self._bindings[alias] = SourceBinding(
                    alias, index, recipe, str(entry.get("sourceId") or "")
                )
        self._tables: dict[TableName, _Table] = {}
        for entry in request.tables:
            name = TableName.of(
                str(entry.get("source") or ""),
                str(entry.get("schema") or ""),
                str(entry.get("table") or ""),
            )
            location = entry.get("location")
            if name.source in self._bindings and isinstance(location, dict):
                self._tables[name] = _Table(name, name.source, TableLocation.from_dict(location))

    def __enter__(self) -> QuerySession:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # pragma: no cover - best effort
                pass
            self._conn = None
        for binding in self._bindings.values():
            binding.close()
        self._spill.cleanup()

    # ── setup ──────────────────────────────────────────────────────────

    def _open(self) -> Any:
        conn = connect(self._duckdb)
        conn.execute("SET enable_progress_bar = false")
        conn.execute(f"SET temp_directory = '{self._spill.name}'")
        memory = self.request.memory_limit or os.environ.get("CLASSIFYRE_QUERY_MEMORY_LIMIT")
        if memory:
            conn.execute(f"SET memory_limit = '{memory.replace(chr(39), '')}'")
        threads = self.request.threads or _int_env("CLASSIFYRE_QUERY_THREADS")
        if threads:
            conn.execute(f"SET threads = {int(threads)}")
        # What a large sort, join or aggregate may spill to disk before it is
        # stopped, rather than filling the node's disk.
        spill = os.environ.get("CLASSIFYRE_QUERY_MAX_SPILL", "").strip()
        if spill:
            conn.execute(f"SET max_temp_directory_size = '{spill.replace(chr(39), '')}'")
        return conn

    def _attach_tables_as_views(self, conn: Any, tables: set[TableName]) -> None:
        created_catalogs: set[str] = set()
        created_schemas: set[tuple[str, str]] = set()
        for name in sorted(tables, key=str):
            entry = self._tables[name]
            binding = self._bindings[entry.source_alias]
            try:
                relation = binding.relation(conn, entry.location)
            except BindingError as exc:
                # Scan wording: "Failed to connect to <label>: <cause>".
                # The binding already names the endpoint in its message, so
                # keep it whole instead of prefixing the table again.
                raise BindingError(f"Failed to connect to {binding.label()}: {exc}") from exc
            except Exception as exc:
                raise BindingError(f"Failed to connect to {binding.label()}: {_first_line(exc)}") from exc
            if binding.source_type == "POSTGRESQL":
                _postgres_settings(conn)
            if name.source not in created_catalogs:
                conn.execute(f"ATTACH ':memory:' AS {quote_identifier(name.source)}")
                created_catalogs.add(name.source)
            if (name.source, name.schema) not in created_schemas:
                conn.execute(
                    f"CREATE SCHEMA IF NOT EXISTS "
                    f"{quote_identifier(name.source)}.{quote_identifier(name.schema)}"
                )
                created_schemas.add((name.source, name.schema))
            target = ".".join(quote_identifier(p) for p in (name.source, name.schema, name.table))
            conn.execute(f"CREATE VIEW {target} AS SELECT * FROM {relation}")

    @contextmanager
    def _deadline(self, conn: Any, seconds: float) -> Iterator[threading.Event]:
        fired = threading.Event()

        def interrupt() -> None:
            fired.set()
            try:
                conn.interrupt()
            except Exception:  # pragma: no cover - connection already closed
                pass

        timer = threading.Timer(max(seconds, 0.001), interrupt)
        timer.daemon = True
        timer.start()
        try:
            yield fired
        finally:
            timer.cancel()

    # ── run ────────────────────────────────────────────────────────────

    def _export(self, conn: Any, sql: str) -> QueryResult:
        """Write the whole result (up to the export row limit) as a file."""
        fmt = self.request.export_format or "csv"
        cap = int(self.request.max_rows)
        if fmt == "xlsx":
            cap = min(cap, XLSX_MAX_ROWS)
        path = Path(self._spill.name) / f"export.{fmt}"
        projection = _export_columns(conn, sql, fmt)
        options = {
            "xlsx": "FORMAT xlsx, HEADER true",
            "csv": "FORMAT csv, HEADER true",
            "parquet": "FORMAT parquet, COMPRESSION zstd",
        }[fmt]
        # One row more than the limit says whether the limit cut the result.
        count = conn.execute(
            f"SELECT count(*) FROM (SELECT 1 FROM ({sql}) AS __result LIMIT {cap + 1})"
        ).fetchone()
        total = int(count[0]) if count else 0
        conn.execute(
            f"COPY (SELECT {projection} FROM ({sql}) AS __result LIMIT {cap}) "
            f"TO '{path}' ({options})"
        )
        size = path.stat().st_size
        if size > self.request.max_result_bytes:
            raise QueryRefusedError(
                f"The export is {size // (1024 * 1024)} MB, more than the "
                f"{self.request.max_result_bytes // (1024 * 1024)} MB an export may be: "
                "select fewer rows or columns.",
                "result_too_large",
            )
        data = path.read_bytes()
        described = conn.execute(f"DESCRIBE SELECT * FROM ({sql}) AS __result").fetchall()
        return QueryResult(
            arrow=data,
            row_count=min(total, cap),
            truncated=total > cap,
            truncated_reason="rows" if total > cap else None,
            columns=[{"name": str(row[0]), "type": str(row[1])} for row in described],
            media_type=EXPORT_FORMATS[fmt],
            export_format=fmt,
        )

    def run(self) -> QueryResult:
        started = time.monotonic()
        validated = validate(self.request.sql, self._tables.keys())
        conn = self._open()
        self._conn = conn
        with self._deadline(conn, self.request.timeout_seconds) as fired:
            try:
                self._attach_tables_as_views(conn, validated.tables)
                setup_done = time.monotonic()
                if self.request.export_format == "xlsx":
                    load_extension(conn, "excel")
                conn.execute("SET autoinstall_known_extensions = false")
                conn.execute("SET autoload_known_extensions = false")
                conn.execute("SET lock_configuration = true")
                if self.request.export_format:
                    exported = self._export(conn, validated.sql)
                else:
                    limit = int(self.request.max_rows) + 1
                    wrapped = f"SELECT * FROM ({validated.sql}) AS __result LIMIT {limit}"
                    table = _fetch_arrow(conn.sql(wrapped))
            except Exception:
                if fired.is_set():
                    raise QueryTimeoutError(
                        f"The query took longer than {self.request.timeout_seconds} s "
                        "and was stopped."
                    ) from None
                raise
        executed = time.monotonic()
        if self.request.export_format:
            result = exported
        else:
            result = _to_result(table, self.request.max_rows, self.request.max_result_bytes)
        result.timings = {
            "setupMs": int((setup_done - started) * 1000),
            "executeMs": int((executed - setup_done) * 1000),
            "totalMs": int((time.monotonic() - started) * 1000),
        }
        result.tables = sorted(str(t) for t in validated.tables)
        return result


def _export_columns(conn: Any, sql: str, fmt: str) -> str:
    """The projection a file format can hold: Excel gets text where it has
    no cell type, and text cut to what one cell takes."""
    if fmt != "xlsx":
        return "*"
    described = conn.execute(f"DESCRIBE SELECT * FROM ({sql}) AS __result").fetchall()
    columns = []
    for name, kind, *_ in described:
        ident = quote_identifier(str(name))
        upper = str(kind).upper()
        if any(marker in upper for marker in _XLSX_AS_TEXT):
            columns.append(f"left(CAST({ident} AS VARCHAR), {XLSX_MAX_CELL_CHARS}) AS {ident}")
        elif upper == "VARCHAR":
            columns.append(f"left({ident}, {XLSX_MAX_CELL_CHARS}) AS {ident}")
        else:
            columns.append(ident)
    return ", ".join(columns) or "*"


def _postgres_settings(conn: Any) -> None:
    """Pushed-down filters, and no parallel CTID scans: the proof of concept
    saw those over-return LIMIT rows (F01). Settings come and go between
    scanner versions, so each one is best effort."""
    for statement in (
        "SET pg_experimental_filter_pushdown = true",
        "SET pg_use_ctid_scan = false",
    ):
        try:
            conn.execute(statement)
        except Exception as exc:
            logger.debug("PostgreSQL scanner setting skipped (%s): %s", statement, exc)


def _fetch_arrow(cursor: Any) -> Any:
    fetch = (
        getattr(cursor, "to_arrow_table", None)  # DuckDB 2.x
        or getattr(cursor, "fetch_arrow_table", None)
        or cursor.arrow
    )
    table = fetch()
    # DuckDB 1.4+ may hand back a RecordBatchReader from .arrow().
    read_all = getattr(table, "read_all", None)
    return read_all() if callable(read_all) else table


def _js_safe(table: Any) -> Any:
    """Columns the browser's Arrow reader cannot decode, as text instead."""
    import pyarrow as pa

    columns = []
    names = []
    for name, column in zip(table.column_names, table.columns, strict=True):
        kind = column.type
        unsafe = (
            pa.types.is_interval(kind)
            or pa.types.is_time(kind)
            or pa.types.is_dictionary(kind)
            or isinstance(kind, pa.ExtensionType)
            or pa.types.is_decimal256(kind)
        )
        if unsafe:
            columns.append(
                pa.array(
                    [None if v is None else str(v) for v in column.to_pylist()],
                    type=pa.string(),
                )
            )
        else:
            columns.append(column)
        names.append(name)
    return pa.table(columns, names=_unique(names))


def _unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for name in names:
        count = seen.get(name, 0)
        seen[name] = count + 1
        out.append(name if count == 0 else f"{name}_{count}")
    return out


def _serialize(table: Any) -> bytes:
    import pyarrow as pa

    sink = io.BytesIO()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()


def _to_result(table: Any, max_rows: int, max_bytes: int) -> QueryResult:
    truncated_reason: str | None = None
    if table.num_rows > max_rows:
        table = table.slice(0, max_rows)
        truncated_reason = "rows"
    table = _js_safe(table)
    data = _serialize(table)
    while len(data) > max_bytes and table.num_rows > 1:
        keep = max(1, int(table.num_rows * (max_bytes / len(data)) * 0.9))
        table = table.slice(0, keep)
        data = _serialize(table)
        truncated_reason = "bytes"
    if len(data) > max_bytes:
        raise QueryRefusedError(
            "One row of the result is larger than the result limit: select fewer columns.",
            "result_too_large",
        )
    return QueryResult(
        arrow=data,
        row_count=table.num_rows,
        truncated=truncated_reason is not None,
        truncated_reason=truncated_reason,
        columns=[{"name": f.name, "type": str(f.type)} for f in table.schema],
    )


def _int_env(name: str) -> int | None:
    try:
        value = int(os.environ.get(name, "") or 0)
    except ValueError:
        return None
    return value or None


def _first_line(exc: BaseException) -> str:
    text = str(exc).strip().splitlines()
    return text[0][:500] if text else type(exc).__name__
