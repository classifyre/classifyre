"""The interface a code detector's notebook must cover.

A code detector answers one question -- "what is wrong with this asset?" -- so
``detect(asset, ctx)`` is required and ``setup(ctx)`` optional. Checked at the
three moments the connector contract is: on save (the API's cheap check),
before a preview, and before every scan, because the recipe travels to a job
that has to defend itself.

Only the shape is checked, through the shared ``validate_module`` /
``validate_notebook``. Isolation is the child process and its scrubbed
environment, not anything an AST can decide.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from ...notebook.contract import ContractReport, validate_module, validate_notebook
from ...notebook.serialize import ModuleSource

REQUIRED_FUNCTIONS = ("detect",)

#: ``setup(ctx)`` runs once per worker before the first asset: load a list,
#: a model, a lookup table into ``ctx.state``.
OPTIONAL_FUNCTIONS = ("setup",)


def validate_detector_module(module: ModuleSource) -> ContractReport:
    """Parse the assembled module and check ``detect()`` exists."""
    return validate_module(module, required=REQUIRED_FUNCTIONS)


def validate_detector_notebook(
    cells: Iterable[Mapping[str, object] | object],
) -> ContractReport:
    """Validate a code detector's cells."""
    return validate_notebook(cells, required=REQUIRED_FUNCTIONS)


__all__ = [
    "OPTIONAL_FUNCTIONS",
    "REQUIRED_FUNCTIONS",
    "validate_detector_module",
    "validate_detector_notebook",
]
