"""The cells a new CUSTOM source starts with.

Seeding the contract instead of documenting it is deliberate: the first thing an
author sees is a notebook that already satisfies ``validate_notebook`` and
already runs, so the job is to edit working code rather than to discover, from a
validation error, which functions were expected.

The cells themselves live in ``all_input_examples.json`` under ``CUSTOM``, next
to every other source's examples -- the CLI reads them here, the API serves them
from the same file, and the web bundles it. One copy, so the starter notebook
and the contract cannot drift apart.
"""

from __future__ import annotations

from functools import cache
from typing import Any

from ..utils.validation import _load_schema

#: Without these the notebook cannot answer "can you connect?" and "what is
#: there?". Mirrors ``contract.REQUIRED_FUNCTIONS``.
STARTER_EXAMPLE_NAME = "Starter notebook"


@cache
def _custom_examples() -> list[dict[str, Any]]:
    examples = _load_schema("all_input_examples.json").get("CUSTOM")
    return examples if isinstance(examples, list) else []


@cache
def _starter_cells() -> tuple[dict[str, Any], ...]:
    for example in _custom_examples():
        if example.get("name") != STARTER_EXAMPLE_NAME:
            continue
        cells = example.get("config", {}).get("required", {}).get("notebook", {}).get("cells")
        if isinstance(cells, list) and cells:
            return tuple(cells)
    raise RuntimeError(
        f"all_input_examples.json has no CUSTOM example named {STARTER_EXAMPLE_NAME!r}; "
        "the starter notebook is defined there so the CLI, API and web share one copy."
    )


def scaffold_cells() -> list[dict[str, Any]]:
    """A fresh copy of the starter cells."""
    return [dict(cell) for cell in _starter_cells()]


def cell_for_function(name: str) -> dict[str, Any] | None:
    """A replacement cell defining ``name``, for repairing a broken notebook.

    Matched by what the cell defines rather than by its id, so renaming a cell
    in the example does not silently break the repair path.
    """
    marker = f"def {name}("
    for cell in _starter_cells():
        if cell.get("type") == "code" and marker in str(cell.get("source", "")):
            return dict(cell)
    return None
