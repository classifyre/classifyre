"""Row filters in a query's views (docs/prd/DQ-data-query.md §5.10).

The API works out, per person and table, which rows they read: a list of
entries, each a list of conditions (``column in / not in values``). A row is
in the view when it meets every condition of at least one entry; an empty
list lets no row through. The filter runs inside the view, on the table's
own values and before any mask, so a query cannot reach the other rows by
any WHERE, JOIN or aggregate of its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..utils.duckdb_engine import quote_identifier

_OPS = ("in", "not_in")
_TEXT_TYPES = ("VARCHAR", "TEXT", "STRING", "CHAR", "BPCHAR")

Value = str | int | float | bool


@dataclass(frozen=True)
class RowCondition:
    column: str
    op: str
    values: tuple[Value, ...]


@dataclass(frozen=True)
class RowFilter:
    any_of: tuple[tuple[RowCondition, ...], ...]

    @classmethod
    def parse(cls, value: Any) -> RowFilter | None:
        """``rows`` of a request table; None when it was not sent (every row).

        Something sent that does not read as a filter lets no row through:
        the API meant to filter, and showing everything is the wrong way to
        fail.
        """
        if value is None:
            return None
        if not isinstance(value, dict) or not isinstance(value.get("anyOf"), list):
            return cls(())
        entries: list[tuple[RowCondition, ...]] = []
        for entry in value["anyOf"]:
            conditions = _conditions(entry)
            if conditions is not None:
                entries.append(conditions)
        return cls(tuple(entries))


def _conditions(entry: Any) -> tuple[RowCondition, ...] | None:
    if not isinstance(entry, list):
        return None
    out: list[RowCondition] = []
    for raw in entry:
        if not isinstance(raw, dict):
            return None
        column, op, values = raw.get("column"), raw.get("op"), raw.get("values")
        if not isinstance(column, str) or not column or op not in _OPS:
            return None
        if not isinstance(values, list) or not values:
            return None
        if not all(isinstance(v, str | int | float | bool) for v in values):
            return None
        out.append(RowCondition(column, str(op), tuple(values)))
    return tuple(out)


def _is_text(type_name: str) -> bool:
    upper = type_name.strip().upper()
    return any(upper == t or upper.startswith(f"{t}(") for t in _TEXT_TYPES)


def _literal(value: Value, type_name: str) -> str:
    """``value`` as a DuckDB literal of the column's type.

    Text columns compare with text. Other columns get the value cast to
    their type with ``TRY_CAST``: a value that is no such thing becomes NULL,
    which no row equals (and which makes a NOT IN list select nothing).
    """
    if isinstance(value, bool):
        text = "true" if value else "false"
    elif isinstance(value, int | float):
        text = repr(value)
    else:
        text = value
    quoted = "'" + text.replace("'", "''") + "'"
    if not type_name or _is_text(type_name):
        return quoted
    return f"TRY_CAST({quoted} AS {type_name})"


def _condition_sql(condition: RowCondition, types: dict[str, str]) -> str:
    name = condition.column
    actual = name if name in types else _fold(name, types)
    if actual is None:
        # The column is gone (renamed at the source): the rule cannot be
        # checked, so it selects nothing rather than everything.
        return "FALSE"
    type_name = types[actual]
    values = ", ".join(_literal(v, type_name) for v in condition.values)
    column = quote_identifier(actual)
    if condition.op == "in":
        return f"({column} IN ({values}))"
    # NOT IN over a NULL value is unknown: those rows stay out too.
    return f"({column} IS NOT NULL AND {column} NOT IN ({values}))"


def _fold(name: str, types: dict[str, str]) -> str | None:
    lowered = name.lower()
    for actual in types:
        if actual.lower() == lowered:
            return actual
    return None


def row_predicate(row_filter: RowFilter, columns: list[tuple[str, str]]) -> str:
    """The WHERE clause of a filtered view, over the table's own columns."""
    if not row_filter.any_of:
        return "FALSE"
    types = dict(columns)
    entries: list[str] = []
    for conditions in row_filter.any_of:
        if not conditions:
            return "TRUE"
        entries.append("(" + " AND ".join(_condition_sql(c, types) for c in conditions) + ")")
    return " OR ".join(entries)
