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

import datetime
import decimal
import json
import math
import os
import re
import time
from abc import abstractmethod
from collections.abc import Iterator
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

    def value_of(self, column: str) -> Any:
        """The value of a pushed ``column = …``, or None."""
        for predicate in self.predicates:
            if predicate.column == column and predicate.op == "=":
                return predicate.value
        return None


class ArrowConnector(QueryBinding):
    """A source whose tables are read through its own client, as Arrow."""

    tier: ClassVar[str] = "connector"

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
            predicates, _complete = predicates_of(filter, schema)
            withheld = self.location.withheld
            predicates = tuple(p for p in predicates if p.column not in withheld)
            self.stats.scans += 1
            for predicate in predicates:
                if str(predicate) not in self.stats.pushed:
                    self.stats.pushed.append(str(predicate))
            request = ScanRequest(
                columns=names,
                predicates=predicates,
                deadline=getattr(self.connector.source, "deadline", math.inf),
                stats=self.stats,
            )
            out_schema = schema if names is None else pa.schema([schema.field(n) for n in names])
            batches = self._batches(request, filter, out_schema)
            return _Scanner(pa.RecordBatchReader.from_batches(out_schema, batches))

        def _batches(self, request: ScanRequest, filter: Any, out_schema: Any) -> Iterator[Any]:
            limit = connector_max_rows()
            started = time.monotonic()
            try:
                for chunk in self.connector.scan(self.location, request):
                    batch = to_batch(chunk, self.arrow_schema)
                    self.stats.rows += batch.num_rows
                    if self.stats.rows > limit:
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
        if pa.types.is_string(f.type):
            values = [_as_text(v) for v in values]
        try:
            arrays.append(pa.array(values, type=f.type))
        except (pa.ArrowInvalid, pa.ArrowTypeError, TypeError, ValueError, OverflowError):
            raise ConnectorError(
                f"Column {f.name} holds values of another type than the last scan "
                "recorded: scan the source again."
            ) from None
    return pa.RecordBatch.from_arrays(arrays, schema=schema)


def _as_text(value: Any) -> Any:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


# ── the filter DuckDB pushed, as predicates ────────────────────────────

_COMPARISON = re.compile(r"^\((?P<field>[^()]+?) (?P<op>==|!=|<=|>=|<|>) (?P<literal>.+)\)$", re.S)
_IS_IN = re.compile(
    r"^is_in\((?P<field>[^(),]+), \{value_set=[^:\[]+:\[(?P<values>.*)\], "
    r"null_matching_behavior=MATCH\}\)$",
    re.S,
)
_IF_VALID = re.compile(
    r"^if_else\(is_valid\((?P<field>[^()]+)\), (?P<inner>.+), null\[bool\]\)$", re.S
)
_OPS: dict[str, Op] = {"==": "=", "!=": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">="}


def predicates_of(expression: Any, schema: Any) -> tuple[tuple[Predicate, ...], bool]:
    """The top-level conjuncts of a pushed filter that read as predicates.

    Returns them and whether that is the whole filter. A conjunct is only
    taken when rebuilding it gives back exactly the expression DuckDB sent,
    so a filter misread never sends the source a wrong condition; the rest
    (``OR``, ``IS NULL``, types without a literal form) is left to the local
    filter.
    """
    if expression is None:
        return (), True
    out: list[Predicate] = []
    complete = True
    for part in _conjuncts(str(expression)):
        predicates = _leaf(part, schema)
        if predicates is None:
            complete = False
        else:
            out.extend(predicates)
    return tuple(out), complete


def _conjuncts(text: str) -> list[str]:
    """Split ``((a and b) and c)`` into ``[a, b, c]`` at depth 0 of its parentheses."""
    inner = _unwrap(text)
    if inner is None:
        return [text]
    depth = 0
    in_string = False
    escaped = False
    for i, ch in enumerate(inner):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and inner.startswith(" and ", i):
            return _conjuncts(inner[:i]) + _conjuncts(inner[i + 5 :])
    return [text]


def _unwrap(text: str) -> str | None:
    """``text`` without its outer parentheses, when they enclose all of it."""
    if not (text.startswith("(") and text.endswith(")")):
        return None
    depth = 0
    in_string = False
    escaped = False
    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and i != len(text) - 1:
                return None
    return text[1:-1]


def _leaf(text: str, schema: Any) -> list[Predicate] | None:
    import pyarrow.compute as pc

    match = _COMPARISON.match(text)
    if match:
        name = match["field"]
        if name not in schema.names:
            return None
        value = _literal(match["literal"], schema.field(name).type)
        if value is _NOT_A_LITERAL:
            return None
        op = _OPS[match["op"]]
        rebuilt = _compare(pc.field(name), op, _scalar(value, schema.field(name).type))
        return [Predicate(name, op, value)] if str(rebuilt) == text else None
    wrapped = _IF_VALID.match(text)
    inner_text = wrapped["inner"] if wrapped else text
    match = _IS_IN.match(inner_text)
    if match:
        name = match["field"]
        if name not in schema.names or (wrapped and wrapped["field"] != name):
            return None
        kind = schema.field(name).type
        values = []
        for item in _items(match["values"]):
            value = _literal(item, kind)
            if value is _NOT_A_LITERAL:
                return None
            values.append(value)
        import pyarrow as pa

        rebuilt = pc.field(name).isin(pa.array(values, type=kind))
        if wrapped:
            rebuilt = pc.if_else(pc.field(name).is_valid(), rebuilt, pa.scalar(None, pa.bool_()))
        return [Predicate(name, "in", tuple(values))] if str(rebuilt) == text else None
    return None


def _items(body: str) -> list[str]:
    """The literals of an ``is_in`` value set (one per line, comma-separated)."""
    lines = [line.strip() for line in body.strip("\n").split("\n")]
    return [line[:-1] if line.endswith(",") else line for line in lines if line]


_NOT_A_LITERAL = object()


def _literal(text: str, kind: Any) -> Any:
    import pyarrow as pa

    try:
        if pa.types.is_string(kind) or pa.types.is_large_string(kind):
            if not (text.startswith('"') and text.endswith('"')):
                return _NOT_A_LITERAL
            value = json.loads(text)
            return value if isinstance(value, str) else _NOT_A_LITERAL
        if pa.types.is_boolean(kind):
            return {"true": True, "false": False}.get(text, _NOT_A_LITERAL)
        if pa.types.is_integer(kind):
            return int(text)
        if pa.types.is_floating(kind):
            return float(text)
        if pa.types.is_decimal(kind):
            return decimal.Decimal(text)
        if pa.types.is_date(kind):
            return datetime.date.fromisoformat(text)
        if pa.types.is_timestamp(kind) and kind.tz is None:
            return datetime.datetime.fromisoformat(text)
    except (ValueError, decimal.InvalidOperation, json.JSONDecodeError):
        return _NOT_A_LITERAL
    return _NOT_A_LITERAL


def _scalar(value: Any, kind: Any) -> Any:
    import pyarrow as pa

    return pa.scalar(value, type=kind)


def _compare(field_expr: Any, op: Op, scalar: Any) -> Any:
    if op == "=":
        return field_expr == scalar
    if op == "!=":
        return field_expr != scalar
    if op == "<":
        return field_expr < scalar
    if op == "<=":
        return field_expr <= scalar
    if op == ">":
        return field_expr > scalar
    return field_expr >= scalar
