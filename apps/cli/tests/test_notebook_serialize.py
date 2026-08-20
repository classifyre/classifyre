"""Cells to a module, and module coordinates back to cell coordinates."""

from __future__ import annotations

import ast

from src.notebook.scaffold import scaffold_cells
from src.notebook.serialize import (
    cell_id_of,
    code_cells,
    to_module_source,
)


def _cell(cell_id: str, source: str, cell_type: str = "code") -> dict[str, str]:
    return {"id": cell_id, "type": cell_type, "source": source}


def test_assembled_module_is_valid_standard_python() -> None:
    # The whole point of the `# %%` convention: the productized artifact must
    # run under plain `python workflow.py`, with no notebook runtime.
    module = to_module_source(scaffold_cells())
    ast.parse(module.text)
    compile(module.text, "workflow.py", "exec")


def test_markdown_becomes_comments() -> None:
    module = to_module_source([_cell("doc", "Title\n\nBody", "markdown")])
    assert "# Title" in module.text
    assert "# Body" in module.text
    ast.parse(module.text)


def test_code_is_emitted_verbatim() -> None:
    source = "def f():\n    return 1\n"
    module = to_module_source([_cell("f", source)])
    assert source.rstrip("\n") in module.text


def test_locate_maps_module_lines_to_cell_lines() -> None:
    module = to_module_source(
        [
            _cell("first", "a = 1\nb = 2\n"),
            _cell("second", "c = 3\nd = 4\ne = 5\n"),
        ]
    )

    first, second = module.spans
    assert module.locate(first.start_line) == ("first", 1)
    assert module.locate(first.start_line + 1) == ("first", 2)
    assert module.locate(second.start_line) == ("second", 1)
    assert module.locate(second.start_line + 2) == ("second", 3)


def test_locate_returns_nothing_for_marker_lines() -> None:
    module = to_module_source([_cell("only", "x = 1\n")])
    # Line 1 is the `# %% id=only` marker we inserted, not the author's code.
    assert module.locate(1) == (None, None)


def test_empty_cell_never_claims_a_line() -> None:
    # A zero-length span must not swallow the next cell's first line.
    module = to_module_source([_cell("blank", ""), _cell("real", "x = 1\n")])
    blank = module.span_for("blank")
    real = module.span_for("real")
    assert blank is not None and real is not None
    assert blank.line_count == 0
    assert not blank.contains(blank.start_line)
    assert module.locate(real.start_line) == ("real", 1)


def test_code_cells_drops_markdown() -> None:
    cells = [_cell("a", "x = 1"), _cell("doc", "prose", "markdown"), _cell("b", "y = 2")]
    assert [cell_id_of(cell) for cell in code_cells(cells)] == ["a", "b"]


def test_round_trip_preserves_cell_order() -> None:
    cells = [_cell(f"c{index}", f"v{index} = {index}\n") for index in range(5)]
    module = to_module_source(cells)
    assert [span.cell_id for span in module.spans] == [f"c{index}" for index in range(5)]
