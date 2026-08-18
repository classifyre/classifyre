"""Execution context handed to a custom source notebook.

The notebook never reads ``os.environ``. Classifyre injects configuration as
``CLASSIFYRE_VAR_*`` / ``CLASSIFYRE_SECRET_*`` variables into the notebook
process and this module turns them back into two plain mappings, so the notebook
refers to a credential by name and never learns where it came from.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

VARIABLE_PREFIX = "CLASSIFYRE_VAR_"
SECRET_PREFIX = "CLASSIFYRE_SECRET_"

INTERACTIVE = "interactive"
SCAN = "scan"


class MissingSecretError(KeyError):
    """Raised when a notebook asks for a secret the source does not define."""

    def __init__(self, name: str, available: list[str]) -> None:
        self.name = name
        self.available = available
        known = ", ".join(available) if available else "none configured"
        super().__init__(
            f"No secret named {name!r} on this source. Add it under Secrets in the "
            f"source configuration. Currently defined: {known}."
        )

    def __str__(self) -> str:  # KeyError repr()s its arg, which hides the message
        return self.args[0]


class MissingVariableError(KeyError):
    """Raised when a notebook asks for a variable the source does not define."""

    def __init__(self, name: str, available: list[str]) -> None:
        self.name = name
        self.available = available
        known = ", ".join(available) if available else "none configured"
        super().__init__(
            f"No variable named {name!r} on this source. Add it under Variables in "
            f"the source configuration. Currently defined: {known}."
        )

    def __str__(self) -> str:
        return self.args[0]


class _Namespace(Mapping[str, str]):
    """A read-only string mapping with a helpful KeyError.

    Supports both ``ns["KEY"]`` and ``ns.KEY`` so notebook code reads naturally
    either way.
    """

    def __init__(self, values: Mapping[str, str], error: type) -> None:
        self._values = dict(values)
        self._error = error

    def __getitem__(self, name: str) -> str:
        try:
            return self._values[name]
        except KeyError:
            raise self._error(name, sorted(self._values)) from None

    def __getattr__(self, name: str) -> str:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        # Never render values: this type also carries secrets.
        return f"{type(self).__name__}({sorted(self._values)!r})"


@dataclass(frozen=True)
class ExecutionContext:
    """What the notebook is allowed to know about the run it is part of."""

    variables: _Namespace
    secrets: _Namespace
    source_id: str = ""
    run_id: str = ""
    mode: str = INTERACTIVE
    environment: str = ""
    workspace: str = ""
    #: Populated by the host when a run carries a saved sampling cursor.
    cursor: dict = field(default_factory=dict)

    @property
    def is_interactive(self) -> bool:
        """True while editing the notebook, False during a real scan.

        Use it to keep development cheap::

            limit = 10 if ctx.is_interactive else None
        """
        return self.mode == INTERACTIVE

    def __repr__(self) -> str:
        return (
            f"ExecutionContext(mode={self.mode!r}, source_id={self.source_id!r}, "
            f"run_id={self.run_id!r}, variables={sorted(self.variables)!r}, "
            f"secrets={sorted(self.secrets)!r})"
        )


def _collect(environ: Mapping[str, str], prefix: str) -> dict[str, str]:
    return {
        key[len(prefix) :]: value
        for key, value in environ.items()
        if key.startswith(prefix) and len(key) > len(prefix)
    }


def context(environ: Mapping[str, str] | None = None) -> ExecutionContext:
    """Build the execution context for the current process.

    Called once from the notebook's setup cell::

        with app.setup:
            from classifyre import context
            ctx = context()
    """
    env = os.environ if environ is None else environ
    cursor_raw = env.get("CLASSIFYRE_NOTEBOOK_CURSOR", "")
    cursor: dict = {}
    if cursor_raw:
        import json

        try:
            parsed = json.loads(cursor_raw)
            if isinstance(parsed, dict):
                cursor = parsed
        except ValueError:
            cursor = {}

    return ExecutionContext(
        variables=_Namespace(_collect(env, VARIABLE_PREFIX), MissingVariableError),
        secrets=_Namespace(_collect(env, SECRET_PREFIX), MissingSecretError),
        source_id=env.get("SOURCE_ID", ""),
        run_id=env.get("RUNNER_ID", ""),
        mode=env.get("CLASSIFYRE_NOTEBOOK_MODE", INTERACTIVE),
        environment=env.get("ENVIRONMENT", ""),
        workspace=env.get("CLASSIFYRE_NOTEBOOK_WORKSPACE", ""),
        cursor=MappingProxyType(cursor),  # type: ignore[arg-type]
    )
