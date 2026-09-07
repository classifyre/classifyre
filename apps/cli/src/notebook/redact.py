"""Keep secret values out of everything a human or a log file will see.

The notebook is handed real credentials, so a stray ``print(token)`` -- or a
library that echoes a request header on error -- would otherwise put a live
secret into runner logs, the API console and the cell output panel, all of which
are retained and readable by people who never had the credential.

Redaction is centralized here rather than left to the author because the author
is not the only one writing to those streams.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any, TextIO

PLACEHOLDER = "••••"

#: Below this length a "secret" is more likely to collide with ordinary text
#: than to be worth hiding. Redacting the value "1" would blank out every digit
#: in the output and hide the bug the user is trying to read.
MIN_REDACTABLE_LENGTH = 4

#: Recipe paths whose leaf strings are secrets. ``masked`` is every source's
#: credential bag; ``augmentation.secrets`` is the augmentation notebook's, kept
#: at the top level (rather than under ``masked``) so the 38 ``*Masked``
#: definitions do not all need the field. Driven from this one constant so the
#: path knowledge does not scatter across consumers.
ENCRYPTED_CONFIG_PATHS = ("masked", "augmentation.secrets")


def _leaves_at_path(recipe: Mapping[str, Any], path: str) -> list[str]:
    node: Any = recipe
    for key in path.split("."):
        if not isinstance(node, Mapping):
            return []
        node = node.get(key)
    return _leaf_strings(node)


class Redactor:
    """Replaces known secret values with a placeholder."""

    def __init__(
        self,
        secrets: Iterable[str] = (),
        *,
        placeholder: str = PLACEHOLDER,
        min_length: int = MIN_REDACTABLE_LENGTH,
    ) -> None:
        values = sorted(
            {
                value
                for value in secrets
                if isinstance(value, str) and len(value.strip()) >= min_length
            },
            key=len,
            reverse=True,  # longest first, so a secret containing another still wins
        )
        self._placeholder = placeholder
        self._pattern = (
            re.compile("|".join(re.escape(value) for value in values)) if values else None
        )

    @classmethod
    def from_recipe(cls, recipe: Mapping[str, Any] | None, **kwargs: Any) -> Redactor:
        """Build a redactor from every secret leaf in the recipe.

        Covers every path in ``ENCRYPTED_CONFIG_PATHS`` — the source's
        ``masked`` bag and the augmentation notebook's ``secrets`` alike.
        """
        recipe = recipe or {}
        secrets = [
            leaf for path in ENCRYPTED_CONFIG_PATHS for leaf in _leaves_at_path(recipe, path)
        ]
        return cls(secrets, **kwargs)

    @property
    def active(self) -> bool:
        return self._pattern is not None

    def __call__(self, text: str) -> str:
        return self.redact(text)

    def redact(self, text: str) -> str:
        if self._pattern is None or not text:
            return text
        return self._pattern.sub(self._placeholder, text)

    def redact_deep(self, value: Any) -> Any:
        """Redact every string inside an arbitrary JSON-shaped value."""
        if self._pattern is None:
            return value
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, Mapping):
            return {key: self.redact_deep(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.redact_deep(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self.redact_deep(item) for item in value)
        return value


def _leaf_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        return [item for nested in value.values() for item in _leaf_strings(nested)]
    if isinstance(value, list | tuple):
        return [item for nested in value for item in _leaf_strings(nested)]
    return []


class RedactingStream:
    """A text stream that redacts on the way out.

    Wraps stderr for the whole notebook process: CLI stderr is streamed verbatim
    into runner-log storage, so this is the last point where a secret can be
    stopped.
    """

    def __init__(self, stream: TextIO, redactor: Redactor) -> None:
        self._stream = stream
        self._redactor = redactor

    def write(self, text: str) -> int:
        self._stream.write(self._redactor.redact(text))
        return len(text)

    def writelines(self, lines: Iterable[str]) -> None:
        for line in lines:
            self.write(line)

    def flush(self) -> None:
        self._stream.flush()

    def isatty(self) -> bool:
        return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)
