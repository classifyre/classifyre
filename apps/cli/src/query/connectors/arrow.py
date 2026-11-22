"""Sources read live through their own API: the ``connector`` tier (docs/prd/QC-query-connectors.md §5.2, §5.3).

A connector's table is registered with DuckDB as an Arrow *dataset* whose
``scanner(columns, filter)`` DuckDB calls once per scan of the table, after
its optimiser has decided what it needs (checked on DuckDB 2.0, QC §11 QC0):

* ``columns``: only the columns the query reads, through the masked and
  filtered view (projection pushdown);
* ``filter``: the conjuncts DuckDB can push, as a ``pyarrow.compute``
  expression: comparisons with a constant, ``IN`` lists, ranges, the row
  filter of the view. Never one on a masked column: a condition on a mask's
  output is not a condition on the column, so DuckDB keeps it to itself.

DuckDB trusts a dataset with the filters it pushed, so every batch is
filtered again here before DuckDB sees it: what the connector does with the
predicates (:func:`predicates_of`) is only how much it reads, never what the
query answers. Scans are lazy: no request is made until DuckDB pulls the
first batch, and none after it stops pulling (a ``LIMIT`` reads one page).

Limits: a scan that would read more than :func:`connector_max_rows` rows
is refused (``connector_limit``) rather than answered on part of the table;
every request a connector makes gets at most the time left before the
query's deadline (:meth:`ScanRequest.timeout`).
"""

from __future__ import annotations

import json
import os
import time
from abc import abstractmethod
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from functools import cache
from typing import Any, ClassVar, Literal

from ...utils.duckdb_engine import quote_identifier
from .base import BindingError, QueryBinding, SourceContext, TableLocation

Op = Literal["=", "!=", "<", "<=", ">", ">=", "in"]

DEFAULT_CONNECTOR_MAX_ROWS = 1_000_000


def connector_max_rows() -> int:
    """How many rows one scan of a connector table may read."""
    try:
        value = int(os.environ.get("CLASSIFYRE_QUERY_CONNECTOR_MAX_ROWS", "") or 0)
    except ValueError:
        value = 0
    return value if value > 0 else DEFAULT_CONNECTOR_MAX_ROWS


class ConnectorError(BindingError):
    """A message that is safe to show: never a response body, a key or a DSN."""

    def __init__(self, message: str, code: str = "source_unavailable") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Predicate:
    column: str
    op: Op
    #: A tuple for ``in``.
    value: Any

    def __str__(self) -> str:
        if self.op == "in":
            return f"{self.column} IN ({', '.join(_shown(v) for v in self.value)})"
        return f"{self.column} {self.op} {_shown(self.value)}"


def _shown(value: Any) -> str:
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


@dataclass
class ScanStats:
    """What reading one table cost; sent with the result (``scans``)."""

    requests: int = 0
    rows: int = 0
    pushed: list[str] = field(default_factory=list)
    ms: int = 0
    scans: int = 0


@dataclass(frozen=True)
class ScanRequest:
    """What DuckDB needs from one scan of a connector table."""

    #: None: every column.
    columns: tuple[str, ...] | None
    #: Conditions every row DuckDB keeps meets; a connector may use any of
    #: them to read less, or none.
    predicates: tuple[Predicate, ...]
    #: ``time.monotonic()`` by which the query must be done.
    deadline: float
    stats: ScanStats

    def timeout(self, default: float) -> float:
        """A request's timeout: the source's own, at most the time left."""
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise ConnectorError("The query ran out of time reading its source.", "timeout")
        return min(default, left)

    def sent(self, predicates: Iterable[Predicate]) -> None:
        """Record the conditions the connector sent to its source (what the
        person is shown as filtered there): only those, not all it was offered."""
        for predicate in predicates:
            if str(predicate) not in self.stats.pushed:
                self.stats.pushed.append(str(predicate))

    def value_of(self, column: str) -> Any:
        """The value of a pushed ``column = …``, or None."""
        for predicate in self.predicates:
            if predicate.column == column and predicate.op == "=":
                return predicate.value
        return None


class ArrowConnector(QueryBinding):
    """A source whose tables are read through its own client, as Arrow."""

    tier: ClassVar[str] = "connector"
    #: What the source is called in messages ("Meilisearch at …").
    product: ClassVar[str] = "The source"
    #: The ``required`` field holding the source's URL.
    url_field: ClassVar[str] = "url"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._live: dict[str, Any] = {}

    # ── what a connector implements ────────────────────────────────────

    def schema(self, location: TableLocation) -> Any:
        """The table's Arrow schema: by default, the columns the scan recorded."""
        if not location.columns:
            raise BindingError(
                f"{self.source.label()} has no recorded columns for this table: "
                "run a scan of the source again."
            )
        return declared_schema(location.columns)

    @abstractmethod
    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        """The table's rows: ``pyarrow.RecordBatch`` es or lists of dicts.

        Count each call to the source in ``request.stats.requests``; give it
        ``request.timeout(...)``; raise :class:`ConnectorError` with a
        message fit to show.
        """

    # ── QueryBinding ───────────────────────────────────────────────────

    def relation(self, conn: Any, location: TableLocation) -> str:
        name = f"__live_{self.source.index}_{len(self._live)}"
        live = _live_table(self, location, self.schema(location))
        conn.register(name, live)
        self._live[name] = live
        return quote_identifier(name)

    def label(self) -> str | None:
        """``scheme://host:port/`` of the source's URL: never its path or
        user info."""
        from urllib.parse import urlsplit

        parts = urlsplit(str(self.source.section("required").get(self.url_field) or ""))
        if not parts.hostname:
            return None
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{parts.hostname}{port}/"

    def where(self) -> str:
        """The source as error messages name it."""
        return f"{self.product} at {self.label() or self.source.alias}"

    def stats(self, relation: str) -> ScanStats | None:
        """What the scans of the table read through ``relation`` cost."""
        live = self._live.get(relation.strip('"'))
        return live.stats if live is not None else None

    def failure(self, relation: str) -> ConnectorError | None:
        """Why a scan of that table failed: DuckDB reports it wrapped."""
        live = self._live.get(relation.strip('"'))
        return live.error if live is not None else None

    def close(self) -> None:
        self._live.clear()


def _live_table(connector: ArrowConnector, location: TableLocation, schema: Any) -> Any:
    """The dataset DuckDB scans for one connector table (see the module docstring)."""
    # The class is built on first use, so importing this module does not
    # import pyarrow. It is never constructed through Dataset.__init__ (that
    # wraps a C++ dataset this one does not have): DuckDB only reads
    # ``schema`` and calls ``scanner``.
    cls = _live_class()
    live = cls.__new__(cls)
    live.connector = connector
    live.location = location
    live.arrow_schema = schema
    live.stats = ScanStats()
    live.error = None
    return live


@cache
def _live_class() -> Any:
    import pyarrow as pa
    import pyarrow.dataset as ds

    class LiveTable(ds.Dataset):  # type: ignore[misc]
        """Only ``schema`` and ``scanner`` work: DuckDB hands projection and
        filters only to a ``pyarrow.dataset.Dataset`` (it checks the type; a
        duck-typed object with ``__arrow_c_stream__`` gets neither, QC §11
        QC0), and the C++ dataset ``Dataset.__init__`` would wrap does not
        exist. Never pass one anywhere but ``DuckDBPyConnection.register``.
        """

        connector: ArrowConnector
        location: TableLocation
        arrow_schema: Any
        stats: ScanStats
        error: ConnectorError | None

        @property
        def schema(self) -> Any:
            return self.arrow_schema

        def scanner(self, columns: Any = None, filter: Any = None, **_: Any) -> Any:
            schema = self.arrow_schema
            names = tuple(columns) if columns is not None else None
            predicates, complete = predicates_of(filter, schema)
            # DuckDB leaves the filter's own columns out of ``columns``: the
            # local filter needs them, so the source is asked for them too
            # (all columns when the filter was not read whole).
            read: tuple[str, ...] | None = names
            if names is not None and filter is not None:
                if complete:
                    extra = [p.column for p in predicates if p.column not in names]
                    read = names + tuple(dict.fromkeys(extra))
                else:
                    read = None
            withheld = self.location.withheld
            predicates = tuple(p for p in predicates if p.column.lower() not in withheld)
            self.stats.scans += 1
            request = ScanRequest(
                columns=read,
                predicates=predicates,
                deadline=self.connector.source.deadline,
                stats=self.stats,
            )
            out_schema = schema if names is None else pa.schema([schema.field(n) for n in names])
            batches = self._batches(request, filter, out_schema)
            return _Scanner(pa.RecordBatchReader.from_batches(out_schema, batches))

        def _batches(self, request: ScanRequest, filter: Any, out_schema: Any) -> Iterator[Any]:
            limit = connector_max_rows()
            read = 0  # this scan's rows: the cap is per scan, not per table
            started = time.monotonic()
            try:
                for chunk in self.connector.scan(self.location, request):
                    batch = to_batch(chunk, self.arrow_schema)
                    self.stats.rows += batch.num_rows
                    read += batch.num_rows
                    if read > limit:
                        raise ConnectorError(
                            f"has more than {limit:,} rows to read for this query; "
                            "filter it on a column its source can filter, or ask an "
                            "admin to raise the limit.",
                            "connector_limit",
                        )
                    if filter is not None:
                        batch = pa.Table.from_batches([batch]).filter(filter)
                        parts = batch.select(list(out_schema.names)).to_batches()
                    else:
                        parts = [batch.select(list(out_schema.names))]
                    yield from parts
            except ConnectorError as exc:
                self.error = exc
                raise
            except Exception as exc:
                # Not the connector's own message: its first line only, which
                # the runner's redactor still reads (never a response body).
                self.error = ConnectorError(_first_line(exc))
                raise self.error from exc
            finally:
                self.stats.ms += int((time.monotonic() - started) * 1000)

    return LiveTable


class _Scanner:
    def __init__(self, reader: Any) -> None:
        self._reader = reader

    def to_reader(self) -> Any:
        return self._reader


def _first_line(exc: BaseException) -> str:
    text = str(exc).strip().splitlines()
    return text[0][:300] if text else type(exc).__name__


# ── schemas and batches ────────────────────────────────────────────────

_INTEGER = {"TINYINT", "SMALLINT", "INTEGER", "INT", "BIGINT", "HUGEINT", "UBIGINT", "UINTEGER"}
_FLOAT = {"DOUBLE", "FLOAT", "REAL"}


def arrow_type(type_name: str) -> Any:
    """The Arrow type a recorded (DuckDB-named) column type reads as.

    Anything not known reads as text: a JSON column is its JSON text.
    """
    import pyarrow as pa

    upper = type_name.strip().upper()
    if upper.endswith("[]"):
        return pa.list_(arrow_type(upper[:-2]))
    if upper in _INTEGER:
        return pa.int64()
    if upper in _FLOAT:
        return pa.float64()
    if upper == "BOOLEAN":
        return pa.bool_()
    if upper == "DATE":
        return pa.date32()
    if upper in ("TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ"):
        return pa.timestamp("us", tz="UTC")
    if upper == "TIMESTAMP":
        return pa.timestamp("us")
    return pa.string()


def declared_schema(columns: tuple[tuple[str, str], ...]) -> Any:
    import pyarrow as pa

    return pa.schema([pa.field(name, arrow_type(kind)) for name, kind in columns])


def to_batch(chunk: Any, schema: Any) -> Any:
    """A connector's page as a record batch of ``schema``.

    Lists of dicts: keys not in the schema are dropped, missing ones are
    NULL, objects and lists in a text column become their JSON text. A value
    of another type than recorded raises :class:`ConnectorError` naming the
    column, never the value.
    """
    import pyarrow as pa

    if isinstance(chunk, pa.RecordBatch):
        if chunk.schema.equals(schema):
            return chunk
        chunk = chunk.to_pylist()
    rows = list(chunk)
    arrays = []
    for f in schema:
        values = [row.get(f.name) if isinstance(row, dict) else None for row in rows]
        drifted = ConnectorError(
            f"Column {f.name} holds values of another type than the last scan "
            "recorded: scan the source again."
        )
        if pa.types.is_string(f.type):
            values = [_as_text(v) for v in values]
        elif not all(_fits(v, f.type) for v in values):
            # pyarrow would convert these quietly (5.5 to 5, True to 1.0, a
            # datetime to its date), and a condition sent to the source would
            # then disagree with what SQL reads (QC re-review, c4).
            raise drifted
        try:
            arrays.append(pa.array(values, type=f.type))
        except (pa.ArrowInvalid, pa.ArrowTypeError, TypeError, ValueError, OverflowError):
            raise drifted from None
    return pa.RecordBatch.from_arrays(arrays, schema=schema)


def _fits(value: Any, kind: Any) -> bool:
    """Whether ``value`` reads as ``kind`` without changing what it is."""
    import datetime as dt

    import pyarrow as pa

    if value is None:
        return True
    if pa.types.is_integer(kind):
        if isinstance(value, bool):
            return False
        return isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    if pa.types.is_floating(kind):
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if pa.types.is_boolean(kind):
        return isinstance(value, bool)
    if pa.types.is_date(kind):
        return isinstance(value, dt.date) and not isinstance(value, dt.datetime)
    if pa.types.is_timestamp(kind):
        if not isinstance(value, dt.datetime):
            return False
        return (value.tzinfo is None) == (kind.tz is None)
    if pa.types.is_list(kind):
        return isinstance(value, (list, tuple)) and all(_fits(v, kind.value_type) for v in value)
    return True


def _as_text(value: Any) -> Any:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


# ── the filter DuckDB pushed, as predicates ────────────────────────────
#
# Read from the expression's own serialisation, not its printed text (a value
# set prints its strings unescaped, so ``'a",\n  "b'`` reads as two values):
# ``Expression.__reduce__`` gives an Arrow IPC file whose schema metadata is
# the tree in prefix order (``call``, its arguments, ``options``, ``end``) and
# whose columns hold every literal and option, typed. The tree read back is
# rebuilt and compared with the original (``Expression.equals``); a filter
# that does not come back identical sends the source nothing.

_COMPARISONS: dict[str, Op] = {
    "equal": "=",
    "not_equal": "!=",
    "less": "<",
    "less_equal": "<=",
    "greater": ">",
    "greater_equal": ">=",
}


@dataclass(frozen=True)
class _Node:
    kind: str  # "call" | "field" | "literal"
    name: str = ""
    args: tuple[_Node, ...] = ()
    #: For a literal or an option: its column in the serialisation.
    column: int | None = None
    options: int | None = None


def predicates_of(expression: Any, schema: Any) -> tuple[tuple[Predicate, ...], bool]:
    """The top-level conjuncts of a pushed filter that read as predicates.

    Returns them and whether that is the whole filter. ``OR``, ``IS NULL``,
    functions and literals of another type than their column are left to the
    local filter.
    """
    if expression is None:
        return (), True
    try:
        tree, values = _read(expression)
        if not _rebuild(tree, values).equals(expression):
            return (), False
    except Exception:
        return (), False
    out: list[Predicate] = []
    complete = True
    for part in _conjuncts(tree):
        predicate = _leaf(part, values, schema)
        if predicate is None:
            complete = False
        else:
            out.append(predicate)
    return tuple(out), complete


def _read(expression: Any) -> tuple[_Node, Any]:
    import pyarrow as pa

    _, (buffer,) = expression.__reduce__()
    table = pa.ipc.open_file(buffer).read_all()
    text = table.schema.to_string(
        truncate_metadata=False, show_field_metadata=False, show_schema_metadata=True
    )
    _, _, block = text.partition("-- schema metadata --\n")
    entries: list[tuple[str, str]] = []
    for line in block.split("\n"):
        key, sep, value = line.partition(": ")
        if not sep or len(value) < 2 or value[0] != "'" or value[-1] != "'":
            raise ValueError("unreadable filter")
        entries.append((key, value[1:-1]))
    tree, rest = _parse(entries)
    if rest:
        raise ValueError("unreadable filter")
    return tree, table


def _parse(entries: list[tuple[str, str]]) -> tuple[_Node, list[tuple[str, str]]]:
    if not entries:
        raise ValueError("unreadable filter")
    (key, value), rest = entries[0], entries[1:]
    if key == "field_ref":
        return _Node("field", name=value), rest
    if key == "literal":
        return _Node("literal", column=int(value)), rest
    if key != "call":
        raise ValueError("unreadable filter")
    args: list[_Node] = []
    options: int | None = None
    while rest and rest[0][0] != "end":
        if rest[0][0] == "options":
            options = int(rest[0][1])
            rest = rest[1:]
            continue
        arg, rest = _parse(rest)
        args.append(arg)
    if not rest or rest[0] != ("end", value):
        raise ValueError("unreadable filter")
    return _Node("call", name=value, args=tuple(args), options=options), rest[1:]


def _rebuild(node: _Node, values: Any) -> Any:
    import pyarrow as pa
    import pyarrow.compute as pc

    if node.kind == "field":
        return pc.field(node.name)
    if node.kind == "literal":
        return pc.scalar(values.column(node.column)[0])
    options = None
    if node.options is not None:
        raw = values.column(node.options)[0].as_py()
        if raw.get("_type_name") != b"SetLookupOptions" or raw.get("null_matching_behavior") != 0:
            raise ValueError("options this reader does not rebuild")
        kind = values.column(node.options).type.field("value_set").type.value_type
        options = pc.SetLookupOptions(pa.array(raw["value_set"], type=kind), skip_nulls=False)
    args = [_rebuild(arg, values) for arg in node.args]
    return pc.Expression._call(node.name, args, options)


def _conjuncts(node: _Node) -> list[_Node]:
    if node.kind == "call" and node.name in ("and_kleene", "and"):
        return [part for arg in node.args for part in _conjuncts(arg)]
    return [node]


def _leaf(node: _Node, values: Any, schema: Any) -> Predicate | None:
    if node.kind != "call":
        return None
    if node.name in _COMPARISONS and len(node.args) == 2:
        left, right = node.args
        op = _COMPARISONS[node.name]
        if left.kind == "literal" and right.kind == "field":
            left, right = right, left
            op = {"<": ">", "<=": ">=", ">": "<", ">=": "<="}.get(op, op)  # type: ignore[assignment]
        if left.kind != "field" or right.kind != "literal":
            return None
        value = _value(left.name, values.column(right.column), schema)
        return None if value is _NOT_A_LITERAL else Predicate(left.name, op, value)
    inner = node
    if node.name == "if_else" and len(node.args) == 3:
        # DuckDB's IN: if_else(is_valid(f), is_in(f, set), null).
        guard, inner, otherwise = node.args
        if not (
            guard.kind == "call"
            and guard.name == "is_valid"
            and len(guard.args) == 1
            and otherwise.kind == "literal"
            and values.column(otherwise.column)[0].as_py() is None
            and inner.kind == "call"
            and inner.name == "is_in"
            and inner.args[:1] == guard.args
        ):
            return None
    if inner.name == "is_in" and len(inner.args) == 1 and inner.options is not None:
        (target,) = inner.args
        if target.kind != "field" or target.name not in schema.names:
            return None
        column = values.column(inner.options)
        if column.type.field("value_set").type.value_type != schema.field(target.name).type:
            return None
        items = tuple(column[0].as_py()["value_set"])
        if any(item is None for item in items):
            return None
        return Predicate(target.name, "in", items)
    return None


_NOT_A_LITERAL = object()


def _value(name: str, column: Any, schema: Any) -> Any:
    """A literal's value, when it has its column's own type."""
    if name not in schema.names or column.type != schema.field(name).type:
        return _NOT_A_LITERAL
    value = column[0].as_py()
    return _NOT_A_LITERAL if value is None else value
