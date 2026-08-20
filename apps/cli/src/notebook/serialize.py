"""Cells to one ordinary Python module, and back to cell coordinates.

The `# %%` convention is deliberate: the assembled module is valid standard
Python that any editor or `python workflow.py` will run, so "productize" is a
download rather than a translation step.

The span map is the other half. A traceback from the assembled module reports a
module line number, which is meaningless to someone looking at cell 3 -- so
every execution path maps it back through :meth:`ModuleSource.locate`.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

MARKER = "# %%"
MARKDOWN_MARKER = "# %% [markdown]"

CODE = "code"
MARKDOWN = "markdown"


@dataclass(frozen=True)
class CellSpan:
    """Where one cell's source landed in the assembled module (1-based lines)."""

    cell_id: str
    cell_type: str
    start_line: int
    line_count: int

    @property
    def end_line(self) -> int:
        return self.start_line + self.line_count - 1

    def contains(self, module_line: int) -> bool:
        return self.line_count > 0 and self.start_line <= module_line <= self.end_line


@dataclass(frozen=True)
class ModuleSource:
    """The assembled module plus the map back to cell coordinates."""

    text: str
    spans: tuple[CellSpan, ...]

    def locate(self, module_line: int) -> tuple[str | None, int | None]:
        """Map a module line number to ``(cell_id, line_within_cell)``.

        Returns ``(None, None)`` for a line that belongs to no cell body -- a
        marker comment or a blank separator we inserted ourselves.
        """
        for span in self.spans:
            if span.contains(module_line):
                return span.cell_id, module_line - span.start_line + 1
        return None, None

    def span_for(self, cell_id: str) -> CellSpan | None:
        for span in self.spans:
            if span.cell_id == cell_id:
                return span
        return None


def _cell_field(cell: Mapping[str, object] | object, name: str, default: str = "") -> str:
    if isinstance(cell, Mapping):
        value = cell.get(name, default)
    else:
        value = getattr(cell, name, default)
    return value if isinstance(value, str) else default


def _comment(line: str) -> str:
    return f"# {line}" if line.strip() else "#"


def to_module_source(cells: Iterable[Mapping[str, object] | object]) -> ModuleSource:
    """Assemble cells into one `# %%`-delimited module.

    Markdown becomes comments so the result stays runnable as-is. Code is
    emitted verbatim -- reindenting or wrapping it would make every reported
    line number a lie.
    """
    lines: list[str] = []
    spans: list[CellSpan] = []

    for cell in cells:
        cell_id = _cell_field(cell, "id")
        cell_type = _cell_field(cell, "type", CODE) or CODE
        source = _cell_field(cell, "source")

        if lines:
            lines.append("")

        if cell_type == MARKDOWN:
            lines.append(f"{MARKDOWN_MARKER} id={cell_id}")
            body = [_comment(line) for line in source.splitlines()]
        else:
            lines.append(f"{MARKER} id={cell_id}")
            body = source.splitlines()

        start_line = len(lines) + 1
        lines.extend(body)
        spans.append(
            CellSpan(
                cell_id=cell_id,
                cell_type=cell_type,
                start_line=start_line,
                line_count=len(body),
            )
        )

    text = "\n".join(lines)
    if text and not text.endswith("\n"):
        text += "\n"
    return ModuleSource(text=text, spans=tuple(spans))


def code_cells(
    cells: Iterable[Mapping[str, object] | object],
) -> list[Mapping[str, object] | object]:
    """Only the cells that execute. Markdown is prose, not a step."""
    return [cell for cell in cells if _cell_field(cell, "type", CODE) != MARKDOWN]


def cell_id_of(cell: Mapping[str, object] | object) -> str:
    return _cell_field(cell, "id")


def cell_source_of(cell: Mapping[str, object] | object) -> str:
    return _cell_field(cell, "source")


def cell_type_of(cell: Mapping[str, object] | object) -> str:
    return _cell_field(cell, "type", CODE) or CODE
