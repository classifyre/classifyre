"""The interface an augmentation notebook must cover.

An augmentation is not a connector: it never answers "can you connect?" or
"what is there?", so the connector contract's ``test_connection``/``extract``
would be the wrong shape to check. What it must answer is "what do you add to
this asset?", which is ``augment(asset)`` — required — plus the two lifecycle
hooks ``setup()`` (once, before the first asset) and ``finalize()`` (once, at
the end, when both sides of a computed relationship are finally known).

The check itself is the connector one, parametrised: ``validate_module`` and
``validate_notebook`` already take a ``required`` iterable rather than
hardcoding the connector names, so this module passes its own names instead of
copying the parser. Only the *shape* is checked here as well — isolation is a
process boundary and a scrubbed environment, not a blocklist.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from ..notebook.contract import (
    ContractReport,
    NotebookContractError,
    validate_module,
    validate_notebook,
)
from ..notebook.serialize import ModuleSource

#: Without this the notebook cannot answer "what do you add to this asset?",
#: which is the whole of the augmentation contract.
REQUIRED_FUNCTIONS = ("augment",)

#: Implemented when the notebook needs them; absence is not an error. ``setup``
#: builds per-run state (lookup tables in ``ctx.state``) before the first
#: asset; ``finalize`` runs once at the end and may yield edges that needed
#: every asset to have been seen first.
OPTIONAL_FUNCTIONS = ("setup", "finalize")


def validate_augmentation_module(module: ModuleSource) -> ContractReport:
    """Parse the assembled module and check ``augment()`` exists."""
    return validate_module(module, required=REQUIRED_FUNCTIONS)


def validate_augmentation_notebook(
    cells: Iterable[Mapping[str, object] | object],
    *,
    required: Iterable[str] = REQUIRED_FUNCTIONS,
) -> ContractReport:
    """Validate a notebook's cells against the augmentation contract."""
    return validate_notebook(cells, required=required)


def defined_functions(cells: Iterable[Mapping[str, object] | object]) -> frozenset[str]:
    """Names the notebook defines, without failing a notebook that parses badly."""
    try:
        return validate_notebook(list(cells), required=()).defined_functions
    except Exception:
        # A notebook that will not parse has already failed louder elsewhere.
        return frozenset()


__all__ = [
    "OPTIONAL_FUNCTIONS",
    "REQUIRED_FUNCTIONS",
    "NotebookContractError",
    "defined_functions",
    "validate_augmentation_module",
    "validate_augmentation_notebook",
]
