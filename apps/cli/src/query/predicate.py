"""One condition a query puts on a live table: ``column op value``.

Shared by the connector tier (:mod:`.connectors.arrow`, which reads them out
of the filter DuckDB pushes) and the notebook SDK (``classifyre.Filter``,
what a custom source's ``scan()`` is handed). No dependencies: the notebook
runtime imports it on every run.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Literal, get_args

Op = Literal["=", "!=", "<", "<=", ">", ">=", "in"]
OPS: tuple[str, ...] = get_args(Op)


@dataclass(frozen=True)
class Predicate:
    """A condition every row the query keeps meets.

    ``op`` is one of ``=``, ``!=``, ``<``, ``<=``, ``>``, ``>=`` or ``in``
    (then ``value`` is a tuple). Values are typed: a date is a
    ``datetime.date``, a timestamp a ``datetime.datetime``.
    """

    column: str
    op: Op
    value: Any

    def __str__(self) -> str:
        if self.op == "in":
            return f"{self.column} IN ({', '.join(shown(v) for v in self.value)})"
        return f"{self.column} {self.op} {shown(self.value)}"


def shown(value: Any) -> str:
    """A value as SQL writes it: ``'text'``, ``DATE '2026-11-16'``, ``5``."""
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, dt.datetime):
        kind = "TIMESTAMPTZ" if value.tzinfo is not None else "TIMESTAMP"
        return f"{kind} '{value.isoformat(sep=' ')}'"
    if isinstance(value, dt.date):
        return f"DATE '{value.isoformat()}'"
    return str(value)
