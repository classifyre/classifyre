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
from typing import Any

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
_TABLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
OPS = ("=", "!=", "<", "<=", ">", ">=", "in")


class QueryContractError(ValueError):
    """``tables()`` or ``scan()`` broke the contract; the message says how."""


@dataclass(frozen=True)
class Table:
    """One table a query can read from this source.

    ``columns`` maps each column to its type: ``VARCHAR``, ``BIGINT``,
    ``INTEGER``, ``DOUBLE``, ``BOOLEAN``, ``DATE``, ``TIMESTAMP``,
    ``TIMESTAMPTZ``, ``JSON`` (objects and lists as JSON text), or a list of
    one of them (``VARCHAR[]``). The table is ``<source>.main.<name>`` in SQL
    (``schema`` picks another middle part).
    """

    name: str
    columns: Mapping[str, str]
    description: str = ""
    schema: str = "main"

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

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "schema": self.schema,
            "description": self.description,
            "columns": [
                {"name": name, "type": str(kind).strip().upper()}
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


@dataclass(frozen=True)
class Filter:
    """A condition every row the query keeps meets: ``column op value``.

    ``op`` is one of ``=``, ``!=``, ``<``, ``<=``, ``>``, ``>=`` or ``in``
    (then ``value`` is a tuple).
    """

    column: str
    op: str
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
        if isinstance(item, dict) and item.get("op") in OPS and isinstance(item.get("column"), str):
            out.append(Filter(item["column"], str(item["op"]), decode_value(item.get("value"))))
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
    page: list[Any] = []
    for item in result:
        if isinstance(item, pa.Table):
            if page:
                yield page
                page = []
            yield from item.to_batches()
        elif isinstance(item, pa.RecordBatch):
            if page:
                yield page
                page = []
            yield item
        elif isinstance(item, Mapping):
            page.append(dict(item))
            if len(page) >= size:
                yield page
                page = []
        elif isinstance(item, list) and all(isinstance(row, Mapping) for row in item):
            page.extend(dict(row) for row in item)
            if len(page) >= size:
                yield page
                page = []
        else:
            raise QueryContractError(
                "scan() must yield dicts (one per row), lists of dicts, or Arrow "
                f"record batches; got {type(item).__name__}."
            )
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
    import pyarrow as pa

    out = dict(row)
    for f in schema:
        value = out.get(f.name)
        if value is None:
            continue
        if isinstance(value, Decimal) and (
            pa.types.is_floating(f.type) or pa.types.is_integer(f.type)
        ):
            out[f.name] = (
                int(value)
                if pa.types.is_integer(f.type) and value == value.to_integral_value()
                else float(value)
            )
        elif isinstance(value, str) and pa.types.is_date(f.type):
            try:
                out[f.name] = dt.date.fromisoformat(value[:10]) if len(value) >= 10 else value
            except ValueError:
                pass
        elif isinstance(value, str) and pa.types.is_timestamp(f.type):
            try:
                parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
            if f.type.tz is not None and parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.UTC)
            elif f.type.tz is None and parsed.tzinfo is not None:
                parsed = parsed.astimezone(dt.UTC).replace(tzinfo=None)
            out[f.name] = parsed
        elif isinstance(value, dt.datetime) and pa.types.is_timestamp(f.type):
            if f.type.tz is not None and value.tzinfo is None:
                out[f.name] = value.replace(tzinfo=dt.UTC)
            elif f.type.tz is None and value.tzinfo is not None:
                out[f.name] = value.astimezone(dt.UTC).replace(tzinfo=None)
    return out


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
