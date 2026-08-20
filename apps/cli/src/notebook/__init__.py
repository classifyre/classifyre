"""Notebook runtime for the CUSTOM source.

A notebook is a list of cells, not a running kernel. Every execution assembles
the current cell sources into one ordinary Python module, runs it in a fresh
process, serializes what the target cell produced, and exits. Nothing survives
between executions except the cell sources themselves -- which is what keeps
"what you see" and "what runs" the same thing.
"""

from .contract import ContractReport, ContractViolation, validate_notebook
from .protocol import ExecutionMode, ExecutionRequest, ExecutionResponse
from .redact import Redactor
from .scaffold import cell_for_function, scaffold_cells
from .serialize import CellSpan, ModuleSource, to_module_source

__all__ = [
    "CellSpan",
    "ContractReport",
    "ContractViolation",
    "ExecutionMode",
    "ExecutionRequest",
    "ExecutionResponse",
    "ModuleSource",
    "Redactor",
    "cell_for_function",
    "scaffold_cells",
    "to_module_source",
    "validate_notebook",
]
