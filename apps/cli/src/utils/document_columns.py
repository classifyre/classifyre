"""Columns of schemaless records (search documents, graph nodes), as a scan records them.

A connector table (docs/prd/QC-query-connectors.md §5.7) is only as useful as
the columns its scan recorded: masks hide every column that was not, and the
query reads each recorded type as the Arrow type it names. The columns are
the top-level fields of a sample, in the order they first appear, typed with
DuckDB's names:

* text, whole numbers, decimals, booleans: ``VARCHAR``, ``BIGINT``,
  ``DOUBLE``, ``BOOLEAN`` (whole numbers mixed with decimals: ``DOUBLE``);
* a list of one scalar type: that type with ``[]`` (``VARCHAR[]``);
* objects, mixed lists, and fields of more than one type: ``JSON``, read as
  their JSON text;
* a field that is only ever null: ``VARCHAR``.
"""

from __future__ import annotations

import datetime
from collections.abc import Callable, Iterable
from typing import Any

from .file_metadata import build_columns


def value_type(value: Any) -> str | None:
    """DuckDB's name for one value's type; None for null."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, int):
        return "BIGINT"
    if isinstance(value, float):
        return "DOUBLE"
    if isinstance(value, str):
        return "VARCHAR"
    if isinstance(value, datetime.datetime):
        return "TIMESTAMP WITH TIME ZONE" if value.tzinfo is not None else "TIMESTAMP"
    if isinstance(value, datetime.date):
        return "DATE"
    if isinstance(value, (list, tuple)):
        inner = _merge(value_type(v) for v in value)
        if inner is None or inner == "JSON" or inner.endswith("[]"):
            return "JSON"
        return f"{inner}[]"
    return "JSON"


def _merge(types: Iterable[str | None]) -> str | None:
    seen = {t for t in types if t is not None}
    if not seen:
        return None
    if len(seen) == 1:
        return seen.pop()
    if seen == {"BIGINT", "DOUBLE"}:
        return "DOUBLE"
    if seen == {"BIGINT[]", "DOUBLE[]"}:
        return "DOUBLE[]"
    return "JSON"


def record_columns(
    records: Iterable[dict[str, Any]],
    typed: Callable[[Any], str | None] = value_type,
) -> list[dict[str, str]]:
    """``[{name, type}]`` over the records' top-level fields."""
    order: list[str] = []
    types: dict[str, list[str | None]] = {}
    for record in records:
        for name, value in record.items():
            if name not in types:
                order.append(name)
                types[name] = []
            types[name].append(typed(value))
    merged = {name: _merge(types[name]) or "VARCHAR" for name in order}
    return build_columns(order, merged)
