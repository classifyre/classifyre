"""Which table cell each line of a tabular sample belongs to.

Tabular sources hand detectors their sampled rows as text
(``sources/tabular_utils.format_tabular_sample_content``)::

    row_1:
      email: ana@example.com
      notes: first line
        continued line

A detector that reads line by line can tag a finding with the row and the
column it came from (``tabular_row_index``, ``tabular_column_name``), which is
what column classification and masking go by (docs/prd/DQ-data-query.md §5.8).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_ROW_RE = re.compile(r"^row_(\d+):$")
# Two spaces then a name that does not start with a space: a deeper line
# (``    password: x``) is a continuation of the cell above, not a column.
_CELL_RE = re.compile(r"^  ([^\s:][^:]*):(?: ?(.*))?$")
_CONTINUATION_RE = re.compile(r"^    ")


@dataclass(frozen=True)
class LineCell:
    row_index: int
    column_name: str


def cells_of_lines(lines: list[str]) -> list[LineCell | None]:
    """For each line, the cell it is part of; None outside any cell.

    Text that is not a tabular sample (no ``row_<n>:`` line) has no cells.
    A page of a sweep starts at its own row (``row_2:``, ``row_41:``), so
    any row header counts, not only the first.
    """
    out: list[LineCell | None] = [None] * len(lines)
    if not any(_ROW_RE.match(line) for line in lines):
        return out
    row: int | None = None
    column: str | None = None
    for index, line in enumerate(lines):
        row_match = _ROW_RE.match(line)
        if row_match:
            row, column = int(row_match.group(1)), None
            continue
        if row is None:
            continue
        cell_match = _CELL_RE.match(line)
        if cell_match:
            column = cell_match.group(1).strip()
        elif not line:
            column = None
            continue
        elif not _CONTINUATION_RE.match(line) and column is None:
            continue
        if column is not None:
            out[index] = LineCell(row, column)
    return out
