"""Keep secret values out of everything a human or a log file will see.

Re-exported from :mod:`src.utils.redaction` (the canonical home, kept in
``utils`` so recipe validation can use it without importing the notebook
package, which would be a circular import). Import from either location;
new code outside the notebook runtime should prefer ``utils.redaction``.
"""

from __future__ import annotations

from ..utils.redaction import (
    ENCODED_SECRET_MIN_LENGTH,
    ENCRYPTED_CONFIG_PATHS,
    MAX_LOG_ID_CHARS,
    MIN_REDACTABLE_LENGTH,
    PLACEHOLDER,
    RedactingStream,
    Redactor,
    redact_generic,
    redact_with_recipe,
    sanitize_for_logging,
    short_id_for_log,
)

__all__ = [
    "ENCODED_SECRET_MIN_LENGTH",
    "ENCRYPTED_CONFIG_PATHS",
    "MAX_LOG_ID_CHARS",
    "MIN_REDACTABLE_LENGTH",
    "PLACEHOLDER",
    "RedactingStream",
    "Redactor",
    "redact_generic",
    "redact_with_recipe",
    "sanitize_for_logging",
    "short_id_for_log",
]
