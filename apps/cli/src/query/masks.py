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

MASK_KINDS = ("redact", "partial", "hash", "null", "scrub")

#: What ``scrub`` removes from free text, in order (RE2, as DuckDB reads it):
#: the identifiers and credentials a pattern can tell apart. Names and other
#: words stay — scrub keeps a text readable, it does not anonymise it. Every
#: row is scrubbed, not only the rows a scan sampled.
SCRUB_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", "[private key]"),
    (r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}", "[token]"),
    (r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", "[key]"),
    (r"\b[sr]k_(?:live|test)_[0-9A-Za-z]{10,}\b", "[key]"),
    (r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b", "[key]"),
    (r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b", "[key]"),
    (
        r"(?i)\b(password|passwort|passwd|pwd|passcode|pin)(\s*(?:is|ist|:|=)\s*)\S+",
        "\\1\\2[secret]",
    ),
    # A long run of key characters: an AWS secret access key (40) and its
    # like. Words and URLs break such runs (spaces, dots, colons).
    (r"[A-Za-z0-9/+]{30,}={0,2}", "[secret]"),
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[email]"),
    (r"\b[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b", "[iban]"),
    (r"\b(?:[0-9][ -]?){12,18}[0-9]\b", "[card number]"),
    (r"\+[0-9][0-9 ()/-]{6,}[0-9]", "[phone]"),
    (r"\b[0-9]{4} ?[0-9]{6}\b", "[number]"),
    (r"\b[A-Z]{1,2}[0-9]{6,8}[A-Z]?\b", "[document number]"),
)

#: Shorter values are redacted whole by a ``partial`` mask: their last four
#: characters would be most of them.
PARTIAL_MIN_LENGTH = 9

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


def _top_level(type_name: str) -> list[tuple[int, str]]:
    """Positions of ``( ) [ ] ,`` outside quotes, with their nesting depth applied."""
    out: list[tuple[int, str]] = []
    quoted = False
    for index, char in enumerate(type_name):
        if char == '"':
            quoted = not quoted
        elif not quoted and char in "()[],":
            out.append((index, char))
    return out


def _split_fields(body: str) -> list[str]:
    """``a INT, "b c" STRUCT(x INT, y INT)`` → its top-level comma-separated parts."""
    parts: list[str] = []
    depth = 0
    start = 0
    for index, char in _top_level(body):
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif depth == 0:
            parts.append(body[start:index].strip())
            start = index + 1
    parts.append(body[start:].strip())
    return [part for part in parts if part]


def _field(part: str) -> tuple[str, str] | None:
    """``"my field" VARCHAR`` → ``("my field", "VARCHAR")``."""
    if part.startswith('"'):
        index = 1
        name = []
        while index < len(part):
            if part[index] == '"':
                if part[index + 1 : index + 2] == '"':
                    name.append('"')
                    index += 2
                    continue
                break
            name.append(part[index])
            index += 1
        rest = part[index + 1 :].strip()
        return ("".join(name), rest) if rest else None
    head, _, rest = part.partition(" ")
    return (head, rest.strip()) if head and rest.strip() else None


def _element_type(type_name: str) -> str | None:
    """``VARCHAR[]`` or ``INTEGER[2]`` → the element type; None for anything else."""
    if not type_name.endswith("]"):
        return None
    depth = 0
    for index, char in reversed(_top_level(type_name)):
        if char in ")]":
            depth += 1
        elif char in "([":
            depth -= 1
            if depth == 0:
                return type_name[:index].strip() if char == "[" else None
    return None


def _struct_fields(type_name: str) -> list[tuple[str, str]] | None:
    """``STRUCT(a INT, b VARCHAR)`` → its fields; None for anything else."""
    if not (type_name.upper().startswith("STRUCT(") and type_name.endswith(")")):
        return None
    fields = [_field(part) for part in _split_fields(type_name[len("STRUCT(") : -1])]
    if not fields or any(field is None for field in fields):
        return None
    return [field for field in fields if field is not None]


def _masked_leaf(expr: str, type_name: str, mask: str, salt: str) -> str:
    if mask == "hash":
        # Text is hashed lower-cased and trimmed: the same address spelt
        # differently in two systems must join (a hash is for joining).
        value = (
            f"lower(trim(CAST({expr} AS VARCHAR)))"
            if _is_text(type_name)
            else f"CAST({expr} AS VARCHAR)"
        )
        return (
            f"CASE WHEN {expr} IS NULL THEN NULL "
            f"ELSE left(sha256({_literal(salt)} || {value}), 16) END"
        )
    if mask == "scrub" and _is_text(type_name):
        scrubbed = expr
        for pattern, replacement in SCRUB_PATTERNS:
            scrubbed = (
                f"regexp_replace({scrubbed}, {_literal(pattern)}, {_literal(replacement)}, 'g')"
            )
        return scrubbed
    if mask == "null" or not _is_text(type_name):
        # A number, a date or a map has no "partly hidden" form.
        return f"CAST(NULL AS {type_name})" if type_name else "NULL"
    if mask == "partial":
        # Last four only of values long enough that four is under half of
        # them, behind a fixed run of dots so the length does not show.
        return (
            f"CASE WHEN {expr} IS NULL THEN NULL "
            f"WHEN length({expr}) < {PARTIAL_MIN_LENGTH} THEN '****' "
            f"ELSE '••••' || right({expr}, 4) END"
        )
    return f"CASE WHEN {expr} IS NULL THEN NULL ELSE '****' END"


def _masked_value(expr: str, type_name: str, mask: str, salt: str, depth: int) -> str:
    """``expr`` masked value by value: a struct keeps its fields and a list its
    elements, each masked as a column of its own type would be, so the shape
    (and, for ``hash``, every field's joinability) survives."""
    fields = _struct_fields(type_name)
    if fields is not None:
        packed = ", ".join(
            f"{quote_identifier(name)} := "
            + _masked_value(
                f"struct_extract({expr}, {_literal(name)})", field_type, mask, salt, depth
            )
            for name, field_type in fields
        )
        return f"CASE WHEN {expr} IS NULL THEN NULL ELSE struct_pack({packed}) END"
    element = _element_type(type_name)
    if element is not None:
        var = f"__mask_{depth}"
        inner = _masked_value(var, element, mask, salt, depth + 1)
        return f"list_transform({expr}, lambda {var}: {inner})"
    return _masked_leaf(expr, type_name, mask, salt)


def mask_expression(column: str, type_name: str, mask: str, salt: str) -> str:
    """The DuckDB expression that shows ``column`` masked, named as itself.

    Struct and list columns are masked field by field and element by element
    (``null`` aside, which empties the column whole); a map or a union has no
    fields of its own to keep and is masked whole.
    """
    q = quote_identifier(column)
    if mask == "null":
        expr = f"CAST(NULL AS {type_name})" if type_name else "NULL"
    else:
        expr = _masked_value(q, type_name.strip(), mask, salt, 0)
    return f"{expr} AS {q}"


def masked_projection(
    columns: list[tuple[str, str]],
    masks: list[ColumnMask],
    salt: str,
    known: list[str] | None = None,
) -> str | None:
    """The SELECT list of a table's view, or None when nothing is masked.

    ``columns`` are ``(name, type)`` as DuckDB describes the table. Masks name
    columns as the scan recorded them: matched exactly, then without case.
    ``known`` are the columns the scan recorded: one the table has now that
    is neither masked nor known (renamed at the source, or named differently
    by DuckDB) is hidden, because nothing says it is not what a mask was
    for. Masks for columns the table no longer has change nothing. With no
    masks, ``known`` alone still hides what is not known (a shared dataset's
    output columns, §5.12).
    """
    if not masks and known is None:
        return None
    exact = {m.column: m for m in masks}
    folded = {m.column.lower(): m for m in masks}
    known_exact = set(known or ())
    known_folded = {name.lower() for name in known_exact}
    parts: list[str] = []
    touched = False
    for name, type_name in columns:
        found = exact.get(name) or folded.get(name.lower())
        if found is None:
            if known is not None and name not in known_exact and name.lower() not in known_folded:
                touched = True
                continue
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
