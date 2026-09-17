"""Keep secret values out of everything a human or a log file will see.

The CLI is handed real credentials (every source's ``masked`` bag, the
notebook's secrets), so a stray ``print(token)`` -- or a library that
echoes a request header on error -- would otherwise put a live secret into
runner logs, the API console, stored run errors and cell output, all of
which are retained and readable by people who never had the credential.

Redaction is centralized here rather than left to each call site because
the call site is not the only one writing to those streams.

This lives in ``utils`` (not ``notebook``) so recipe validation can use it
without importing the notebook package, which would be a circular import.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Iterable, Mapping
from typing import Any, TextIO

PLACEHOLDER = "••••"

#: Generic credential patterns, applied even when the exact secret value is
#: not known (short secrets, secrets from the environment, driver-echoed
#: connection strings). Value-based redaction above stays primary; these are
#: defense in depth so a secret never reaches logs or stored run errors.
_URL_CREDENTIALS_RE = re.compile(r"(://[^/\s:@?#]+:)([^@/\s?#]+)(@)")
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/=]+")
_SENSITIVE_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|secrets|token|api[_-]?key|apikey|"
    r"auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
    r"private[_-]?key|credentials?)\b(\s*[\"']?\s*[:=]\s*[\"']?)"
    r"([^\"'\s,};\]]+)"
)

#: Below this length a "secret" is more likely to collide with ordinary text
#: than to be worth hiding. Redacting the value "1" would blank out every digit
#: in the output and hide the bug the user is trying to read.
MIN_REDACTABLE_LENGTH = 4

#: Minimum secret length for the encoded-variant check below. Decoding every
#: base64-looking run and substring-matching short values would nuke benign
#: hashes on coincidental 4-char overlaps; real credential blobs are longer.
ENCODED_SECRET_MIN_LENGTH = 8

#: Runs that look like base64 / base64url payloads (padding often stripped,
#: as in asset hashes). Decoded and inspected by redact_encoded.
_B64_RUN_RE = re.compile(r"[A-Za-z0-9_+\-/]{24,}={0,2}")

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
        # Long secrets are also matched in their base64 form (see
        # redact_encoded): asset hashes reversibly encode the raw id.
        self._encoded_values = sorted(
            {
                value
                for value in secrets
                if isinstance(value, str) and len(value.strip()) >= ENCODED_SECRET_MIN_LENGTH
            },
            key=len,
            reverse=True,
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
        if not text:
            return text
        cleaned = self._pattern.sub(self._placeholder, text) if self._pattern is not None else text
        return self.redact_encoded(cleaned)

    def redact_encoded(self, text: str) -> str:
        """Hide base64 blobs whose decoded form contains a known secret.

        Asset hashes are reversible base64 over the connector's raw id, so a
        notebook that builds ids from secrets leaks the secret *encoded* --
        which plain substring matching never sees. Each long base64-looking
        run is decoded; when the decoded text is printable and carries a
        known secret, the whole run is replaced. Benign blobs (hashes over
        plain ids, checksums) decode clean and pass through untouched.
        """
        if not text or not self._encoded_values:
            return text

        def _scrub(match: re.Match[str]) -> str:
            run = match.group(0)
            padded = run + "=" * (-len(run) % 4)
            try:
                decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
            except (binascii.Error, ValueError, UnicodeDecodeError):
                try:
                    decoded = base64.b64decode(padded).decode("utf-8")
                except (binascii.Error, ValueError, UnicodeDecodeError):
                    return run
            if not decoded.isprintable():
                return run
            if any(secret in decoded for secret in self._encoded_values):
                return self._placeholder
            return run

        return _B64_RUN_RE.sub(_scrub, text)

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


def redact_generic(text: str, placeholder: str = PLACEHOLDER) -> str:
    """Hide credential-shaped substrings without knowing exact values.

    Covers ``user:password@host`` URLs, ``Bearer <token>`` headers and
    ``password=...`` / ``"api_key": "..."`` assignments. Safe to run after
    value-based redaction; already-hidden placeholders are left alone.
    """
    if not text:
        return text
    redacted = _URL_CREDENTIALS_RE.sub(r"\1" + placeholder + r"\3", text)
    redacted = _BEARER_RE.sub("Bearer " + placeholder, redacted)
    redacted = _SENSITIVE_ASSIGNMENT_RE.sub(
        lambda match: (
            match.group(1) + match.group(2) + placeholder
            if match.group(3) != placeholder and "[REDACTED]" not in match.group(3)
            else match.group(0)
        ),
        redacted,
    )
    return redacted


def redact_with_recipe(
    text: str,
    recipe: Mapping[str, Any] | None,
    placeholder: str = PLACEHOLDER,
) -> str:
    """Redact known recipe secrets plus credential-shaped patterns."""
    if not isinstance(text, str) or not text:
        return text
    redactor = Redactor.from_recipe(recipe, placeholder=placeholder)
    return redact_generic(redactor.redact(text), placeholder)


def sanitize_for_logging(value: Any, redactor: Redactor | None = None) -> Any:
    """Copy ``value`` with the credential bag structurally hidden.

    Every leaf under ``masked`` and ``augmentation.secrets`` becomes
    ``PLACEHOLDER`` regardless of length, so a short secret the value
    redactor would skip still never reaches logs. Remaining strings are
    passed through the value redactor (when given) plus generic patterns.
    """

    def _mask(node: Any, hide: bool) -> Any:
        if isinstance(node, Mapping):
            return {
                key: _mask(item, hide or key in {"masked", "secrets"}) for key, item in node.items()
            }
        if isinstance(node, list):
            return [_mask(item, hide) for item in node]
        if isinstance(node, tuple):
            return tuple(_mask(item, hide) for item in node)
        if hide:
            return PLACEHOLDER
        if isinstance(node, str):
            cleaned = redactor.redact(node) if redactor is not None else node
            return redact_generic(cleaned)
        return node

    # ``masked`` is all credentials so it hides whole; ``secrets`` covers the
    # augmentation notebook's secrets subtree. Anything else stays readable.
    return _mask(value, False)


#: Max characters of one asset id/URL kept in a log line. Real URLs survive
#: whole; long opaque blobs -- where embedded credential material hides, and
#: what a reversible base64 asset hash becomes when the notebook builds ids
#: from secrets -- are cut with a marker. Keeps the actionable head (which
#: document), drops the tail (where the secret rides).
MAX_LOG_ID_CHARS = 120


def short_id_for_log(
    value: Any,
    redactor: Redactor | None = None,
    max_chars: int = MAX_LOG_ID_CHARS,
) -> str:
    """Render an asset id/URL for logs without leaking embedded secrets."""
    raw = value if isinstance(value, str) else str(value)
    cleaned = redactor.redact(raw) if redactor is not None else raw
    cleaned = redact_generic(cleaned)
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars]}… [{len(cleaned) - max_chars} chars omitted]"


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
