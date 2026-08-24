"""The interface a notebook must cover to be a source.

A notebook that does not define ``test_connection()`` and ``extract()`` is not a
connector, so this check runs at three moments: on save, before an execution
that depends on those functions, and again before every scan. Enforcing it once
at save time would not be enough -- the notebook is editable through the API and
the recipe travels to a job that has to defend itself.

Only the *shape* is checked. This is not a sandbox: nothing here tries to decide
whether the code is safe, because that question is not answerable by reading an
AST. Isolation is a process boundary and a scrubbed environment (see
``sources/custom/runner.py``), not a blocklist.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, field

from .serialize import ModuleSource, cell_id_of, to_module_source

#: Without these the notebook cannot answer "can you connect?" and "what is
#: there?", which is the whole of the source contract.
REQUIRED_FUNCTIONS = ("test_connection", "extract")

#: Implemented when the source can support them; absence is not an error.
OPTIONAL_FUNCTIONS = ("discover", "fetch_content", "relationships")

MISSING_FUNCTION = "missing_function"
SYNTAX_ERROR = "syntax_error"
DUPLICATE_CELL_ID = "duplicate_cell_id"
EMPTY_NOTEBOOK = "empty_notebook"
NOT_A_FUNCTION = "not_a_function"


@dataclass(frozen=True)
class ContractViolation:
    kind: str
    message: str
    cell_id: str | None = None
    line: int | None = None
    column: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass(frozen=True)
class ContractReport:
    violations: tuple[ContractViolation, ...] = ()
    defined_functions: frozenset[str] = field(default_factory=frozenset)

    @property
    def ok(self) -> bool:
        return not self.violations

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(
            violation.message.split("'")[1]
            for violation in self.violations
            if violation.kind == MISSING_FUNCTION
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "violations": [violation.to_dict() for violation in self.violations],
            "definedFunctions": sorted(self.defined_functions),
        }

    def raise_if_invalid(self) -> None:
        if self.ok:
            return
        raise NotebookContractError(self)


class NotebookContractError(Exception):
    """Raised when a notebook does not satisfy the source contract."""

    def __init__(self, report: ContractReport) -> None:
        self.report = report
        detail = "; ".join(
            f"{violation.message}"
            + (f" (cell {violation.cell_id}, line {violation.line})" if violation.cell_id else "")
            for violation in report.violations
        )
        super().__init__(f"Notebook does not satisfy the source contract: {detail}")


def _top_level_functions(tree: ast.Module) -> dict[str, ast.stmt]:
    return {
        node.name: node
        for node in tree.body
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    }


def _top_level_names(tree: ast.Module) -> set[str]:
    """Every name bound at module level, however it was bound.

    Used to tell "you never wrote extract" from "extract is a variable, not a
    function" -- two mistakes that deserve different messages.
    """
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, ast.Import | ast.ImportFrom):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
    return names


def validate_module(
    module: ModuleSource,
    *,
    required: Iterable[str] = REQUIRED_FUNCTIONS,
) -> ContractReport:
    """Parse the assembled module and check the required functions exist."""
    try:
        tree = ast.parse(module.text, filename="notebook.py")
    except SyntaxError as exc:
        # IPython magics (%time, !pip install) land here: they are not Python,
        # so the "cells stay valid standard Python" rule is enforced by the
        # parser rather than by a pattern match we would have to maintain.
        module_line = exc.lineno or 1
        cell_id, cell_line = module.locate(module_line)
        return ContractReport(
            violations=(
                ContractViolation(
                    kind=SYNTAX_ERROR,
                    message=exc.msg or "invalid syntax",
                    cell_id=cell_id,
                    line=cell_line,
                    column=exc.offset,
                ),
            )
        )

    functions = _top_level_functions(tree)
    names = _top_level_names(tree)
    violations: list[ContractViolation] = []

    for name in required:
        if name in functions:
            continue
        if name in names:
            violations.append(
                ContractViolation(
                    kind=NOT_A_FUNCTION,
                    message=(
                        f"'{name}' is defined but is not a function. "
                        f"The source contract needs 'def {name}(...)' at the top level."
                    ),
                )
            )
            continue
        violations.append(
            ContractViolation(
                kind=MISSING_FUNCTION,
                message=(
                    f"'{name}' is not defined. Every notebook must define "
                    f"'def {name}(...)' at the top level of a code cell."
                ),
            )
        )

    return ContractReport(
        violations=tuple(violations),
        defined_functions=frozenset(functions),
    )


def validate_notebook(
    cells: Iterable[Mapping[str, object] | object],
    *,
    required: Iterable[str] = REQUIRED_FUNCTIONS,
) -> ContractReport:
    """Validate a notebook's cells against the source contract."""
    cells = list(cells)
    if not cells:
        return ContractReport(
            violations=(
                ContractViolation(kind=EMPTY_NOTEBOOK, message="The notebook has no cells."),
            )
        )

    seen: set[str] = set()
    duplicates: list[ContractViolation] = []
    for cell in cells:
        cell_id = cell_id_of(cell)
        if cell_id in seen:
            duplicates.append(
                ContractViolation(
                    kind=DUPLICATE_CELL_ID,
                    message=f"Duplicate cell id '{cell_id}'.",
                    cell_id=cell_id,
                )
            )
        seen.add(cell_id)

    report = validate_module(to_module_source(cells), required=required)
    if not duplicates:
        return report
    return ContractReport(
        violations=tuple(duplicates) + report.violations,
        defined_functions=report.defined_functions,
    )
