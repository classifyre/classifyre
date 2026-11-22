"""SQL over a custom source: what a notebook's ``tables()`` and ``scan()`` see
(docs/prd/QC-query-connectors.md §5.8).

A notebook that defines both is queryable live, like a Meilisearch index: the
scan records each declared :class:`Table` as a ``table`` asset with its
columns, and a query that reads one calls ``scan(table, request)`` in the
notebook's own child process (``src/sources/custom/runner.py``), which
returns the rows as Arrow. The query engine filters every row again, so what
``scan()`` does with the request's filters only decides how much it reads:
returning more rows than the filters select is always correct, returning
fewer never is.

This module is imported by the notebook runtime (the child) and by the query
side (the parent); it imports pyarrow only when rows are converted.
"""

from __future__ import annotations

import base64
import datetime as dt
import re
import time
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, cast

from ..query.predicate import OPS, Op
from ..query.predicate import Predicate as Filter

__all__ = [
    "COLUMN_CLASSIFICATIONS",
    "COLUMN_TYPES",
    "Filter",
    "QueryContractError",
    "ScanCall",
    "ScanRefusedError",
    "ScanRequest",
    "Table",
]

#: The column types a table may declare (DuckDB names), and ``<type>[]`` lists.
COLUMN_TYPES = (
    "VARCHAR",
    "BIGINT",
    "INTEGER",
    "DOUBLE",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
    "TIMESTAMPTZ",
    "JSON",
)
#: What a column may be declared to hold (``Table(classify=...)``), least
#: guarded first; ``personal`` and ``sensitive`` are masked and ``secret``
#: hidden for people who do not read the table in clear, as when findings
#: classify a column. Equal to the API's ``CLASSIFICATIONS`` (governance-rules.ts),
#: checked by tests/test_query_custom.py.
COLUMN_CLASSIFICATIONS = ("public", "internal", "confidential", "personal", "sensitive", "secret")
_TABLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class QueryContractError(ValueError):
    """``tables()`` or ``scan()`` broke the contract; the message says how."""


class ScanRefusedError(Exception):
    """Raise it from ``scan()`` to refuse a query with a message of your own.

    The message is shown to whoever ran the query, so write it for them
    (*"companies needs WHERE fnr = ..."*) and keep values out of it. Any other
    exception fails the query with only its type and line: its text may hold
    the values it was raised over, and goes to the query's log instead.
    """


@dataclass(frozen=True)
class Table:
    """One table a query can read from this source.

    ``columns`` maps each column to its type: ``VARCHAR``, ``BIGINT``,
    ``INTEGER``, ``DOUBLE``, ``BOOLEAN``, ``DATE``, ``TIMESTAMP``,
    ``TIMESTAMPTZ``, ``JSON`` (objects and lists as JSON text), or a list of
    one of them (``VARCHAR[]``). The table is ``<source>.main.<name>`` in SQL
    (``schema`` picks another middle part).

    ``classify`` says what a column holds: ``{"birth_date": "personal"}``. A
    query's rows are never scanned for personal data, so this (or a steward)
    is what masks a column by default: ``personal`` and ``sensitive`` are
    masked, ``secret`` hidden, for people who do not read the table in clear.
    """

    name: str
    columns: Mapping[str, str]
    description: str = ""
    schema: str = "main"
    classify: Mapping[str, str] = field(default_factory=dict)

    def check(self) -> None:
        for label, value in (("name", self.name), ("schema", self.schema)):
            if not isinstance(value, str) or not _TABLE_NAME.match(value):
                raise QueryContractError(
                    f"Table {label} {value!r} must be lower-case letters, digits and "
                    "underscores, starting with a letter."
                )
        if not isinstance(self.columns, Mapping) or not self.columns:
            raise QueryContractError(f"Table {self.name!r} declares no columns.")
        for column, kind in self.columns.items():
            if not isinstance(column, str) or not column:
                raise QueryContractError(f"Table {self.name!r} has a column with no name.")
            base = str(kind).strip().upper().removesuffix("[]")
            if base not in COLUMN_TYPES:
                raise QueryContractError(
                    f"Column {column!r} of table {self.name!r} has type {kind!r}; "
                    f"use one of {', '.join(COLUMN_TYPES)} (or a list, like VARCHAR[])."
                )
        if not isinstance(self.classify, Mapping):
            raise QueryContractError(f"Table {self.name!r}: classify must be a dict.")
        for column, label in self.classify.items():
            if column not in self.columns:
                raise QueryContractError(
                    f"Table {self.name!r} classifies {column!r}, which it does not declare."
                )
            if label not in COLUMN_CLASSIFICATIONS:
                raise QueryContractError(
                    f"Column {column!r} of table {self.name!r} is classified {label!r}; "
                    f"use one of {', '.join(COLUMN_CLASSIFICATIONS)}."
                )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "schema": self.schema,
            "description": self.description,
            "columns": [
                {
                    "name": name,
                    "type": str(kind).strip().upper(),
                    **({"classification": self.classify[name]} if name in self.classify else {}),
                }
                for name, kind in self.columns.items()
            ],
        }


def declared_tables(value: Any) -> list[Table]:
    """What ``tables()`` returned, checked: a list (or iterable) of ``Table``."""
    if isinstance(value, Table):
        value = [value]
    if value is None or isinstance(value, (str, bytes, Mapping)):
        raise QueryContractError("tables() must return a list of Table(...).")
    out: list[Table] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, Table):
            raise QueryContractError(
                f"tables() must return Table(...) objects, got {type(item).__name__}."
            )
        item.check()
        # scan() is called with the name alone, so it is unique across schemas.
        if item.name in seen:
            raise QueryContractError(f"tables() declares {item.name!r} twice.")
        seen.add(item.name)
        out.append(item)
    return out


@dataclass
class ScanRequest:
    """What the query needs from one ``scan()`` call.

    Read ``columns`` and ``filters`` to fetch less; call :meth:`values` (or
    :meth:`use`) for the filters you sent to your source, so the person sees
    them under the query as filtered at the source.
    """

    #: The columns the query reads; None: all of them.
    columns: tuple[str, ...] | None
    filters: tuple[Filter, ...]
    #: More rows than this and the query is refused: stop fetching after it.
    max_rows: int
    #: ``time.monotonic()`` by which the query must be done.
    deadline: float
    used: list[Filter] = field(default_factory=list)
    #: Calls made to the source, shown under the query (``count_request()``).
    requests: int = 0

    def values(self, column: str) -> tuple[Any, ...] | None:
        """The values ``column`` is limited to by ``column = x`` or
        ``column IN (...)``, or None when the query does not limit it so.
        Marks that filter as used."""
        for item in self.filters:
            if item.column == column and item.op in ("=", "in"):
                self.use(item)
                return tuple(item.value) if item.op == "in" else (item.value,)
        return None

    def value(self, column: str) -> Any:
        """The value of ``column = x``, or None. Marks that filter as used."""
        for item in self.filters:
            if item.column == column and item.op == "=":
                self.use(item)
                return item.value
        return None

    def use(self, *filters: Filter) -> None:
        """Say which filters ``scan()`` sent to its source."""
        for item in filters:
            if item not in self.used:
                self.used.append(item)

    def count_request(self, n: int = 1) -> None:
        """Count calls made to the source (shown with the query's result)."""
        self.requests += n

    def seconds_left(self) -> float:
        """Time left before the query is stopped; give each call at most this."""
        return max(0.0, self.deadline - time.monotonic())


# ── the wire between the query (parent) and the notebook (child) ───────


@dataclass(frozen=True)
class ScanCall:
    """One ``scan()`` the query asks the notebook for (the ``scan`` command)."""

    table: str
    #: The table's declared columns, ``(name, type)``: the batches' schema.
    columns: tuple[tuple[str, str], ...]
    #: The columns the query reads (None: all), what ``request.columns`` says.
    projection: tuple[str, ...] | None
    filters: tuple[Filter, ...]
    max_rows: int
    seconds_left: float

    def to_wire(self) -> dict[str, Any]:
        return {
            "command": "scan",
            "table": self.table,
            "columns": [list(c) for c in self.columns],
            "projection": list(self.projection) if self.projection is not None else None,
            "filters": encode_filters(self.filters),
            "maxRows": self.max_rows,
            "secondsLeft": self.seconds_left,
        }

    @classmethod
    def from_wire(cls, raw: Mapping[str, Any]) -> ScanCall:
        projection = raw.get("projection")
        return cls(
            table=str(raw.get("table") or ""),
            columns=tuple((str(n), str(t)) for n, t in raw.get("columns") or ()),
            projection=tuple(str(c) for c in projection) if isinstance(projection, list) else None,
            filters=decode_filters(raw.get("filters")),
            max_rows=int(raw.get("maxRows") or 0),
            seconds_left=float(raw.get("secondsLeft") or 0),
        )


def encode_value(value: Any) -> Any:
    """A filter value as JSON: dates and decimals tagged, the rest as is."""
    if isinstance(value, tuple):
        return [encode_value(v) for v in value]
    if isinstance(value, dt.datetime):
        return {"$datetime": value.isoformat()}
    if isinstance(value, dt.date):
        return {"$date": value.isoformat()}
    if isinstance(value, Decimal):
        return {"$decimal": str(value)}
    return value


def decode_value(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(decode_value(v) for v in value)
    if isinstance(value, dict):
        if "$datetime" in value:
            return dt.datetime.fromisoformat(str(value["$datetime"]))
        if "$date" in value:
            return dt.date.fromisoformat(str(value["$date"]))
        if "$decimal" in value:
            return Decimal(str(value["$decimal"]))
    return value


def encode_filters(filters: Iterable[Any]) -> list[dict[str, Any]]:
    return [{"column": f.column, "op": f.op, "value": encode_value(f.value)} for f in filters]


def decode_filters(raw: Any) -> tuple[Filter, ...]:
    out: list[Filter] = []
    for item in raw or ():
        if not isinstance(item, dict) or not isinstance(item.get("column"), str):
            continue
        op = next((o for o in OPS if o == item.get("op")), None)
        if op is not None:
            out.append(Filter(item["column"], cast(Op, op), decode_value(item.get("value"))))
    return tuple(out)


def batch_to_wire(batch: Any) -> str:
    import pyarrow as pa

    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, batch.schema) as writer:
        writer.write_batch(batch)
    return base64.b64encode(sink.getvalue().to_pybytes()).decode("ascii")


def batch_from_wire(text: str) -> Any:
    import pyarrow as pa

    reader = pa.ipc.open_stream(pa.py_buffer(base64.b64decode(text)))
    batches = list(reader)
    if len(batches) != 1:
        return pa.Table.from_batches(batches, schema=reader.schema).combine_chunks().to_batches()[0]
    return batches[0]


# ── rows ───────────────────────────────────────────────────────────────


def chunks(result: Any, size: int = 1000) -> Iterator[Any]:
    """What ``scan()`` returned or yielded, as pages: Arrow batches as they
    are, dicts gathered ``size`` at a time."""
    import pyarrow as pa

    if result is None:
        return
    if isinstance(result, (pa.RecordBatch, pa.Table, Mapping)):
        result = [result]
    page: list[dict[str, Any]] = []
    for item in result:
        if isinstance(item, (pa.Table, pa.RecordBatch)):
            if page:  # rows before a batch go first, in order
                yield page
                page = []
            yield from item.to_batches() if isinstance(item, pa.Table) else [item]
            continue
        if isinstance(item, Mapping):
            page.append(dict(item))
        elif isinstance(item, list) and all(isinstance(row, Mapping) for row in item):
            page.extend(dict(row) for row in item)
        else:
            raise QueryContractError(
                "scan() must yield dicts (one per row), lists of dicts, or Arrow "
                f"record batches; got {type(item).__name__}."
            )
        if len(page) >= size:
            yield page
            page = []
    if page:
        yield page


def rows_to_batch(chunk: Any, schema: Any, table: str) -> Any:
    """A page of ``scan()``'s rows as a batch of the declared ``schema``.

    ISO text in a date or timestamp column is read as a date or timestamp,
    and a ``Decimal`` as a number; any other value of another type than the
    column declares is refused, naming the column (never the value).
    """
    import pyarrow as pa

    from ..query.connectors.arrow import ConnectorError, to_batch

    if not isinstance(chunk, pa.RecordBatch):
        chunk = [_coerced(row, schema) for row in chunk]
    elif not chunk.schema.equals(schema):
        missing = [n for n in schema.names if n not in chunk.schema.names]
        if missing:
            chunk = chunk.to_pylist()
        else:
            try:
                chunk = chunk.select(schema.names).cast(schema)
            except (pa.ArrowInvalid, pa.ArrowNotImplementedError, TypeError):
                chunk = chunk.to_pylist()
    try:
        return to_batch(chunk, schema)
    except ConnectorError:
        for f in schema:
            rows = chunk.to_pylist() if isinstance(chunk, pa.RecordBatch) else chunk
            try:
                to_batch([{f.name: row.get(f.name)} for row in rows], pa.schema([f]))
            except ConnectorError:
                raise QueryContractError(
                    f"scan() returned a value for {table}.{f.name} that is not "
                    f"{_type_name(f.type)}, the type tables() declares."
                ) from None
        raise


def _coerced(row: Mapping[str, Any], schema: Any) -> dict[str, Any]:
    """ISO text as dates and timestamps, ``Decimal`` as numbers, and
    timestamps in the zone the column declares (UTC)."""
    import pyarrow as pa

    out = dict(row)
    for f in schema:
        value = out.get(f.name)
        if value is None:
            continue
        if isinstance(value, Decimal) and (
            pa.types.is_floating(f.type) or pa.types.is_integer(f.type)
        ):
            integral = value == value.to_integral_value()
            out[f.name] = int(value) if pa.types.is_integer(f.type) and integral else float(value)
        elif isinstance(value, str) and pa.types.is_date(f.type):
            try:
                out[f.name] = dt.date.fromisoformat(value[:10])
            except ValueError:
                pass  # refused below, naming the column
        elif pa.types.is_timestamp(f.type) and isinstance(value, (str, dt.datetime)):
            if isinstance(value, str):
                try:
                    value = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError:
                    continue
            out[f.name] = _in_zone(value, utc=f.type.tz is not None)
    return out


def _in_zone(value: dt.datetime, *, utc: bool) -> dt.datetime:
    """A naive timestamp is UTC; a column without a zone gets UTC, naive."""
    if utc:
        return value if value.tzinfo is not None else value.replace(tzinfo=dt.UTC)
    if value.tzinfo is None:
        return value
    return value.astimezone(dt.UTC).replace(tzinfo=None)


def _type_name(kind: Any) -> str:
    import pyarrow as pa

    if pa.types.is_integer(kind):
        return "an integer"
    if pa.types.is_floating(kind):
        return "a number"
    if pa.types.is_boolean(kind):
        return "a boolean"
    if pa.types.is_date(kind):
        return "a date"
    if pa.types.is_timestamp(kind):
        return "a timestamp"
    if pa.types.is_list(kind):
        return "a list"
    return "text"
