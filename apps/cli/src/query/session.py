"""One DuckDB session per query: views over the allowed tables, one deadline.

Order of work, all inside one deadline so a slow ``ATTACH`` counts against the
time the person asked for (the proof of concept's review, finding F02):

1. validate the SQL against the request's tables (:mod:`.gate`);
2. attach only the sources the SQL reads, and create a view
   ``"<source>"."<schema>"."<table>"`` over each table it names;
3. lock it down: no local path but its own and its sources', no new extension,
   no setting the query could change back (:meth:`QuerySession._lock_down`);
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
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from ..utils.duckdb_engine import connect, load_extension, quote_identifier, require_duckdb
from .bindings import BindingError, ConnectorError, SourceBinding, TableLocation
from .gate import QueryRefusedError, TableName, validate
from .masks import ColumnMask, ColumnsHiddenError, masked_projection
from .rows import RowFilter, row_predicate

logger = logging.getLogger(__name__)

DEFAULT_MAX_ROWS = 10_000
DEFAULT_MAX_RESULT_BYTES = 32 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 120


#: URL schemes a query's views may read once the session is locked down
#: (:meth:`QuerySession._lock_down`); each source's secret scopes what it reaches.
REMOTE_PREFIXES = (
    "s3://",
    "s3a://",
    "s3n://",
    "r2://",
    "gcs://",
    "gs://",
    "az://",
    "azure://",
    "abfs://",
    "abfss://",
    "http://",
    "https://",
    "hf://",
)
#: Extra local roots queries may read (the chart lists ``api.localFolders``
#: mount paths), separated by ``os.pathsep`` or commas.
LOCAL_ROOTS_ENV = "CLASSIFYRE_QUERY_LOCAL_ROOTS"


def _env_paths(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [part.strip() for part in raw.replace(",", os.pathsep).split(os.pathsep) if part.strip()]


def _as_directory(path: str) -> str:
    """A directory for ``allowed_directories``: real path, trailing slash, so
    ``/data/a`` does not also open ``/data/ab``."""
    if "://" in path:
        return path
    resolved = os.path.realpath(path)
    return resolved if resolved.endswith("/") or not Path(resolved).is_dir() else resolved + "/"


def _sql_list(values: list[str]) -> str:
    return "[" + ", ".join("'" + v.replace("'", "''") + "'" for v in values) + "]"


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
    #: "postgres" for SQL from a SQL connection (a PostgreSQL client).
    dialect: str = "duckdb"
    #: The PostgreSQL database the client named (the workspace), postgres only.
    database: str | None = None
    #: The client's search path as ``source.schema`` entries, postgres only.
    search_path: list[str] = field(default_factory=list)
    #: Key of the ``hash`` masks: one per workspace (§5.8).
    mask_salt: str = ""
    #: Describe the SQL instead of running it: its output columns and their
    #: column lineage, no rows (a shared dataset being shared, §5.12).
    describe: bool = False

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
            dialect="postgres" if data.get("dialect") == "postgres" else "duckdb",
            database=str(data["database"]) if data.get("database") else None,
            search_path=[str(p) for p in data.get("searchPath") or [] if isinstance(p, str)],
            mask_salt=str(data.get("maskSalt") or ""),
            describe=data.get("describe") is True,
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
    #: For a describe request: output columns and column lineage, no rows.
    description: dict[str, Any] | None = None
    #: What reading each connector table cost (QC §5.3): table, requests,
    #: rows, filters sent, ms, scans.
    scans: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _Dataset:
    """A shared dataset (docs/prd/DQ-data-query.md §5.12): its SQL over its
    inputs, which are read as its owning group sees them and live under a
    catalog of their own that the reader's SQL cannot name."""

    sql: str
    inputs: dict[TableName, _Table]
    #: The hidden catalog its inputs are attached under (``__ds_<n>``).
    catalog: str


@dataclass(frozen=True)
class _Relation:
    """What one view reads, and the name its reads are reported under."""

    binding: SourceBinding
    relation: str
    shown: str
    #: A shared dataset's input: its filters are the owning group's.
    private: bool = False


@dataclass
class _Table:
    name: TableName
    source_alias: str
    location: TableLocation
    #: Columns masked or hidden for the person (docs/prd/DQ-data-query.md §5.8).
    masks: list[ColumnMask] = field(default_factory=list)
    #: The columns the scan recorded, sent with masks: any other is hidden.
    known_columns: list[str] | None = None
    #: The rows the person reads (§5.10); None: every row.
    rows: RowFilter | None = None
    #: Set for a shared dataset: the view is its SQL, not a source's table.
    dataset: _Dataset | None = None


def _known_columns(value: Any) -> list[str] | None:
    """``knownColumns`` of a request table: names, or None when not sent."""
    if not isinstance(value, list):
        return None
    return [str(name) for name in value if isinstance(name, str)]


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
        #: Each source table's view reads this binding's relation.
        self._relations: dict[str, _Relation] = {}
        self._tables: dict[TableName, _Table] = {}
        for entry in request.tables:
            dataset = entry.get("dataset")
            if isinstance(dataset, dict):
                table = self._dataset_table(entry, dataset, len(self._tables))
            else:
                table = self._source_table(entry)
            if table is not None:
                self._tables[table.name] = table

    def _source_table(self, entry: dict[str, Any]) -> _Table | None:
        name = TableName.of(
            str(entry.get("source") or ""),
            str(entry.get("schema") or ""),
            str(entry.get("table") or ""),
        )
        location = entry.get("location")
        if name.source not in self._bindings or not isinstance(location, dict):
            return None
        return _Table(
            name,
            name.source,
            TableLocation.from_dict(location),
            ColumnMask.parse(entry.get("columns")),
            _known_columns(entry.get("knownColumns")),
            RowFilter.parse(entry.get("rows")),
        )

    def _dataset_table(
        self, entry: dict[str, Any], dataset: dict[str, Any], index: int
    ) -> _Table | None:
        name = TableName.of(
            str(entry.get("source") or ""),
            str(entry.get("schema") or ""),
            str(entry.get("table") or ""),
        )
        sql = dataset.get("sql")
        if not isinstance(sql, str) or not sql.strip() or name.source in self._bindings:
            return None
        inputs: dict[TableName, _Table] = {}
        for raw in dataset.get("inputs") or []:
            if isinstance(raw, dict):
                table = self._source_table(raw)
                if table is not None:
                    inputs[table.name] = table
        return _Table(
            name,
            "",
            TableLocation.from_dict({"kind": "dataset"}),
            ColumnMask.parse(entry.get("columns")),
            _known_columns(entry.get("knownColumns")),
            RowFilter.parse(entry.get("rows")),
            dataset=_Dataset(sql, inputs, f"__ds_{index}"),
        )

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

    def _lock_down(self, conn: Any) -> None:
        """Once the views exist: no new extension, no local path but the
        query's own, and no setting the query could change back.

        The SQL gate already refuses table functions and file names; this is
        the second wall behind it. A query process shares its host with other
        queries (the query worker), so a query that got past the gate must
        still not read another's spill files or ``/proc``. Remote URLs stay
        open: what a query reaches there is what its sources' secrets allow.
        """
        conn.execute("SET autoinstall_known_extensions = false")
        conn.execute("SET autoload_known_extensions = false")
        allowed = [*REMOTE_PREFIXES, _as_directory(self._spill.name)]
        allowed += [_as_directory(path) for path in _env_paths(LOCAL_ROOTS_ENV)]
        for binding in self._bindings.values():
            allowed += [_as_directory(path) for path in binding.local_paths()]
        try:
            rows = conn.execute(
                "SELECT path FROM duckdb_databases() WHERE path IS NOT NULL AND path <> ''"
            ).fetchall()
        except Exception:  # pragma: no cover - older DuckDB
            rows = []
        allowed_files = [str(row[0]) for row in rows if "://" not in str(row[0])]
        conn.execute(f"SET allowed_directories = {_sql_list(sorted(set(allowed)))}")
        if allowed_files:
            conn.execute(f"SET allowed_paths = {_sql_list(sorted(set(allowed_files)))}")
        conn.execute("SET enable_external_access = false")
        conn.execute("SET lock_configuration = true")

    def _attach_tables_as_views(self, conn: Any, tables: set[TableName]) -> None:
        created_catalogs: set[str] = set()
        created_schemas: set[tuple[str, str]] = set()

        def target_of(catalog: str, schema: str, table: str) -> str:
            if catalog not in created_catalogs:
                conn.execute(f"ATTACH ':memory:' AS {quote_identifier(catalog)}")
                created_catalogs.add(catalog)
            if (catalog, schema) not in created_schemas:
                conn.execute(
                    f"CREATE SCHEMA IF NOT EXISTS "
                    f"{quote_identifier(catalog)}.{quote_identifier(schema)}"
                )
                created_schemas.add((catalog, schema))
            return ".".join(quote_identifier(p) for p in (catalog, schema, table))

        for name in sorted(tables, key=str):
            entry = self._tables[name]
            target = target_of(name.source, name.schema, name.table)
            if entry.dataset is not None:
                relation = self._dataset_relation(conn, entry.dataset, target_of, str(name))
                self._create_view(conn, target, relation, entry, label=str(name), binding=None)
            else:
                self._source_view(conn, target, entry)

    def _source_view(
        self, conn: Any, target: str, entry: _Table, *, dataset: str | None = None
    ) -> None:
        """``dataset``: the shared dataset this table is an input of. Its
        reads are reported under the dataset's name, never with the filters
        sent: those hold the owning group's row filter (DQ §5.10)."""
        binding = self._bindings[entry.source_alias]
        # A masked column is never a filter sent to its source (QC §5.11);
        # masks match columns without case.
        location = replace(
            entry.location,
            withheld=frozenset(m.column.lower() for m in entry.masks),
        )
        try:
            relation = binding.relation(conn, location)
        except BindingError as exc:
            # Scan wording: "Failed to connect to <label>: <cause>".
            # The binding already names the endpoint in its message, so
            # keep it whole instead of prefixing the table again.
            raise BindingError(f"Failed to connect to {binding.label()}: {exc}") from exc
        except Exception as exc:
            raise BindingError(
                f"Failed to connect to {binding.label()}: {_first_line(exc)}"
            ) from exc
        if binding.source_type == "POSTGRESQL":
            _postgres_settings(conn)
        self._relations[target] = _Relation(
            binding, relation, dataset or str(entry.name), private=dataset is not None
        )
        self._create_view(conn, target, relation, entry, label=str(entry.name), binding=binding)

    def _dataset_relation(self, conn: Any, dataset: _Dataset, target_of: Any, shown: str) -> str:
        """A shared dataset's SQL over its inputs (§5.12), as a relation.

        Each input becomes a view ``"__ds_<n>"."main"."t<j>"``, masked and
        filtered for the dataset's owning group; the dataset's SQL is checked
        against its inputs and rewritten onto those names, which the reader's
        own SQL can never name (the gate allows only the request's tables).
        """
        hidden: dict[TableName, tuple[str, str, str]] = {}
        for j, input_name in enumerate(sorted(dataset.inputs, key=str)):
            hidden[input_name] = (dataset.catalog, "main", f"t{j}")
        validated = validate(dataset.sql, dataset.inputs.keys(), rename=hidden)
        for input_name in sorted(validated.tables, key=str):
            catalog, schema, table = hidden[input_name]
            self._source_view(
                conn,
                target_of(catalog, schema, table),
                dataset.inputs[input_name],
                dataset=shown,
            )
        return f"({validated.sql}) AS __dataset"

    def _create_view(
        self,
        conn: Any,
        target: str,
        relation: str,
        entry: _Table,
        *,
        label: str,
        binding: SourceBinding | None,
    ) -> None:
        try:
            projection = "*"
            where = ""
            # A shared dataset shows only the columns it was saved with
            # (§5.12), masked or not.
            only_known = entry.dataset is not None and entry.known_columns is not None
            if entry.masks or entry.rows is not None or only_known:
                described = conn.execute(f"DESCRIBE SELECT * FROM {relation}").fetchall()
                columns = [(str(row[0]), str(row[1])) for row in described]
                if entry.rows is not None:
                    # Only the rows the person reads exist in the view;
                    # the filter sees the table's own values, before any
                    # mask (§5.10).
                    where = f" WHERE {row_predicate(entry.rows, columns)}"
                if entry.masks or only_known:
                    # The view is the only way to the table: masked here,
                    # the query filters and joins on masked values;
                    # hidden, the column does not exist for it.
                    try:
                        projection = (
                            masked_projection(
                                columns,
                                entry.masks,
                                self.request.mask_salt,
                                entry.known_columns,
                            )
                            or "*"
                        )
                    except ColumnsHiddenError:
                        raise QueryRefusedError(
                            f"Every column of {label} is hidden from you.", "columns_hidden"
                        ) from None
            conn.execute(f"CREATE VIEW {target} AS SELECT {projection} FROM {relation}{where}")
        except QueryRefusedError:
            raise
        except BindingError:
            raise
        except Exception as exc:
            if binding is None:
                raise
            raise BindingError(
                f"Failed to read {binding.label()}: {binding.explain(exc) or _first_line(exc)}"
            ) from exc

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

    def describe(self) -> QueryResult:
        """The SQL's output columns and their column lineage, reading no rows
        (§5.12: what a shared dataset would be, before it is shared)."""
        from .describe import column_lineage

        started = time.monotonic()
        validated = validate(self.request.sql, self._tables.keys())
        conn = self._open()
        self._conn = conn
        with self._deadline(conn, self.request.timeout_seconds) as fired:
            try:
                self._attach_tables_as_views(conn, validated.tables)
                self._lock_down(conn)
                described = conn.execute(
                    f"DESCRIBE SELECT * FROM ({validated.sql}) AS __result"
                ).fetchall()
                schemas: dict[TableName, list[str]] = {}
                for name in validated.tables:
                    target = ".".join(
                        quote_identifier(p) for p in (name.source, name.schema, name.table)
                    )
                    schemas[name] = [
                        str(row[0])
                        for row in conn.execute(f"DESCRIBE SELECT * FROM {target}").fetchall()
                    ]
            except Exception:
                if fired.is_set():
                    raise QueryTimeoutError(
                        f"Describing the query took longer than "
                        f"{self.request.timeout_seconds} s and was stopped."
                    ) from None
                raise
        columns = [{"name": str(row[0]), "type": str(row[1])} for row in described]
        return QueryResult(
            arrow=b"",
            row_count=0,
            truncated=False,
            truncated_reason=None,
            columns=columns,
            timings={"totalMs": int((time.monotonic() - started) * 1000)},
            tables=sorted(str(t) for t in validated.tables),
            description={
                "columns": columns,
                "lineage": column_lineage(validated.sql, schemas),
            },
        )

    def run(self) -> QueryResult:
        if self.request.describe:
            return self.describe()
        started = time.monotonic()
        validated = validate(
            self.request.sql,
            self._tables.keys(),
            self.request.dialect,
            database=self.request.database,
            search_path=self.request.search_path,
        )
        conn = self._open()
        self._conn = conn
        for binding in self._bindings.values():
            binding.deadline = started + self.request.timeout_seconds
        with self._deadline(conn, self.request.timeout_seconds) as fired:
            try:
                self._attach_tables_as_views(conn, validated.tables)
                setup_done = time.monotonic()
                if self.request.export_format == "xlsx":
                    load_extension(conn, "excel")
                self._lock_down(conn)
                if self.request.export_format:
                    exported = self._export(conn, validated.sql)
                else:
                    limit = int(self.request.max_rows) + 1
                    wrapped = f"SELECT * FROM ({validated.sql}) AS __result LIMIT {limit}"
                    table = _fetch_arrow(conn.sql(wrapped))
            except Exception as exc:
                failed = self._connector_failure()
                if fired.is_set() or (failed is not None and failed.code == "timeout"):
                    raise QueryTimeoutError(
                        f"The query took longer than {self.request.timeout_seconds} s "
                        "and was stopped."
                    ) from None
                if failed is not None and failed is not exc:
                    raise failed from None
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
        result.scans = self._scan_stats()
        return result

    def _connector_failure(self) -> ConnectorError | None:
        """The error a connector raised, named for its table: DuckDB hands it
        on wrapped in its own text."""
        for _, read in sorted(self._relations.items()):
            error = read.binding.failure(read.relation)
            if error is None:
                continue
            if error.code == "connector_limit":
                return ConnectorError(f"{read.shown} {error}", error.code)
            return ConnectorError(f"Failed to read {read.shown}: {error}", error.code)
        return None

    def _scan_stats(self) -> list[dict[str, Any]]:
        """Per table the person named: what its live reads cost. A shared
        dataset's inputs add up under the dataset, without their filters."""
        out: dict[str, dict[str, Any]] = {}
        for _, read in sorted(self._relations.items()):
            stats = read.binding.scan_stats(read.relation)
            if stats is None or not stats.scans:
                continue
            entry = out.setdefault(
                read.shown,
                {"table": read.shown, "requests": 0, "rows": 0, "pushed": [], "ms": 0, "scans": 0},
            )
            entry["requests"] += stats.requests
            entry["rows"] += stats.rows
            entry["ms"] += stats.ms
            entry["scans"] += stats.scans
            if not read.private:
                entry["pushed"] += [p for p in stats.pushed if p not in entry["pushed"]]
        return [out[name] for name in sorted(out)]


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
