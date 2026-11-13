"""Column hide/mask in a query's views (docs/prd/DQ-data-query.md §5.8).

The API decides, per person and table, which columns are masked or hidden;
the job builds each table's view over them, so the query (its WHERE, JOIN
and GROUP BY too) only ever sees the masked values, and a hidden column is
simply not there. The same projection serves every way of reading a table:
the SQL page, a Data tab, an export, a SQL connection, a published product.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..utils.duckdb_engine import quote_identifier

MASK_KINDS = ("redact", "partial", "hash", "null")

#: DuckDB's names for text (``TEXT`` and ``STRING`` are aliases of VARCHAR,
#: but the scan may report them as the source did).
_TEXT_TYPES = ("VARCHAR", "TEXT", "STRING", "CHAR", "BPCHAR")


@dataclass(frozen=True)
class ColumnMask:
    column: str
    #: "mask" or "hide".
    action: str
    #: For "mask": one of :data:`MASK_KINDS`.
    mask: str = "redact"

    @classmethod
    def parse(cls, entries: Any) -> list[ColumnMask]:
        out: list[ColumnMask] = []
        if not isinstance(entries, list):
            return out
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            column = entry.get("column")
            action = entry.get("action")
            if not isinstance(column, str) or not column or action not in ("mask", "hide"):
                continue
            mask = entry.get("mask")
            out.append(
                cls(column, str(action), mask if mask in MASK_KINDS else "redact"),
            )
        return out


class ColumnsHiddenError(ValueError):
    """Every column of a table is hidden from the person."""


def _is_text(type_name: str) -> bool:
    upper = type_name.strip().upper()
    return any(upper == t or upper.startswith(f"{t}(") for t in _TEXT_TYPES)


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def mask_expression(column: str, type_name: str, mask: str, salt: str) -> str:
    """The DuckDB expression that shows ``column`` masked, named as itself."""
    q = quote_identifier(column)
    null = f"CAST(NULL AS {type_name})" if type_name else "NULL"
    if mask == "hash":
        expr = (
            f"CASE WHEN {q} IS NULL THEN NULL "
            f"ELSE left(sha256({_literal(salt)} || CAST({q} AS VARCHAR)), 16) END"
        )
    elif mask == "null" or not _is_text(type_name):
        # A number, a date or a struct has no "partly hidden" form.
        expr = null
    elif mask == "partial":
        expr = (
            f"CASE WHEN {q} IS NULL THEN NULL "
            f"WHEN length({q}) <= 4 THEN repeat('•', length({q})) "
            f"ELSE repeat('•', length({q}) - 4) || right({q}, 4) END"
        )
    else:
        expr = f"CASE WHEN {q} IS NULL THEN NULL ELSE '****' END"
    return f"{expr} AS {q}"


def masked_projection(
    columns: list[tuple[str, str]],
    masks: list[ColumnMask],
    salt: str,
) -> str | None:
    """The SELECT list of a table's view, or None when nothing is masked.

    ``columns`` are ``(name, type)`` as DuckDB describes the table. Masks name
    columns as the scan recorded them: matched exactly, then without case.
    Masks for columns the table no longer has change nothing.
    """
    if not masks:
        return None
    exact = {m.column: m for m in masks}
    folded = {m.column.lower(): m for m in masks}
    parts: list[str] = []
    touched = False
    for name, type_name in columns:
        found = exact.get(name) or folded.get(name.lower())
        if found is None:
            parts.append(quote_identifier(name))
        elif found.action == "hide":
            touched = True
        else:
            touched = True
            parts.append(mask_expression(name, type_name, found.mask, salt))
    if not touched:
        return None
    if not parts:
        raise ColumnsHiddenError("Every column of this table is hidden from you.")
    return ", ".join(parts)
