"""Turn a code detector's finding payloads into ``DetectionResult`` rows.

The child is never trusted to build a ``DetectionResult`` itself: it hands back
plain payloads and this module -- in the parent -- decides what each becomes.
That is where the detector's configuration is enforced:

- the severity is a CEILING (field report P9): a finding may ask for less,
  never more; a refused promotion is recorded on the finding as
  ``metadata.severity_requested`` rather than lost;
- only declared ``fields`` survive, and each undeclared key warns once per run;
- ``identity`` becomes the wire ``identity_key`` (contract C1), so the API keys
  the finding on it instead of on the matched text;
- ``normalized_value`` goes to ``metadata.normalized_value`` (contract C2): the
  only way a code detector's finding enters the value index;
- ``row`` / ``column_name`` land where the PII detector puts table cells.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

from ...models.generated_detectors import Severity
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
)

RUNNER = "CODE_DETECTOR"

_SEVERITY_ORDER = ("critical", "high", "medium", "low", "info")
_DEFAULT_SEVERITY = "medium"

#: How much of a message is kept; the finding is not the place for a report.
MAX_MESSAGE_CHARS = 2000
MAX_VALUE_CHARS = 10_000
MAX_IDENTITY_CHARS = 256


def _identity_key(identity: str) -> str:
    """A wire ``identity_key`` of at most 256 chars; longer keys hash.

    Mirrors ``generateDetectionIdentity``'s ``hashIdentityKey`` on the API:
    short keys travel verbatim (readable in the UI), long ones as their
    SHA-256 hex digest, so every layer keys the same finding the same way.
    """
    if len(identity) <= MAX_IDENTITY_CHARS:
        return identity
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _severity_name(value: Any) -> str | None:
    if isinstance(value, Severity):
        return value.value
    if isinstance(value, str):
        name = value.strip().lower()
        if name in _SEVERITY_ORDER:
            return name
    return None


def bound_severity(ceiling: str, requested: Any) -> tuple[str, bool]:
    """The severity to apply, and whether the request had to be refused."""
    if requested is None:
        return ceiling, False
    asked = _severity_name(requested)
    if asked is None:
        return ceiling, True
    if _SEVERITY_ORDER.index(asked) < _SEVERITY_ORDER.index(ceiling):
        return ceiling, True
    return asked, False


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _location(raw: Any) -> tuple[Location | None, dict[str, Any]]:
    """Split a payload location into the wire Location and tabular metadata."""
    if not isinstance(raw, Mapping):
        return None, {}
    tabular: dict[str, Any] = {}
    row = _coerce_int(raw.get("row"))
    if row is not None:
        tabular["tabular_row_index"] = row
    column_name = raw.get("column_name")
    if isinstance(column_name, str) and column_name:
        tabular["tabular_column_name"] = column_name
    wire: dict[str, Any] = {}
    for key in ("path", "description"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            wire[key] = value
    for key in ("line", "column", "start", "end"):
        value = _coerce_int(raw.get(key))
        if value is not None:
            wire[key] = value
    if not wire.get("description") and tabular:
        parts = []
        if "tabular_row_index" in tabular:
            parts.append(f"row {tabular['tabular_row_index']}")
        if "tabular_column_name" in tabular:
            parts.append(f"column {tabular['tabular_column_name']}")
        wire["description"] = ", ".join(parts)
    return (Location(**wire) if wire else None), tabular


def _field_matches(kind: str, value: Any) -> bool:
    if value is None:
        return True
    if kind in {"string", "date"}:
        return isinstance(value, str)
    if kind == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "list[string]":
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    if kind == "list[number]":
        return isinstance(value, list) and all(
            isinstance(item, int | float) and not isinstance(item, bool) for item in value
        )
    return True


class FindingMapper:
    """Maps payloads for one detector; remembers what it already warned about."""

    def __init__(
        self,
        *,
        key: str,
        name: str,
        severity: Any = None,
        category: Any = None,
        fields: Iterable[Mapping[str, Any]] | None = None,
        max_findings: int = 200,
        warn: Callable[[str], None] | None = None,
    ) -> None:
        self.key = key
        self.name = name
        self.ceiling = _severity_name(severity) or _DEFAULT_SEVERITY
        self.category = str(getattr(category, "value", category) or "QUALITY")
        self.fields: dict[str, str] = {}
        for entry in fields or []:
            field_name = str(entry.get("name") or "").strip()
            if field_name:
                raw_type = entry.get("type") or "string"
                self.fields[field_name] = str(getattr(raw_type, "value", raw_type))
        self.max_findings = max(1, int(max_findings))
        self._warn = warn or (lambda _message: None)
        self._warned: set[str] = set()

    def _warn_once(self, key: str, message: str) -> None:
        if key in self._warned:
            return
        self._warned.add(key)
        self._warn(message)

    def map(self, payloads: Iterable[Any], *, asset_name: str = "") -> list[DetectionResult]:
        results: list[DetectionResult] = []
        detected_at = datetime.now(UTC)
        for index, payload in enumerate(payloads):
            if index >= self.max_findings:
                self._warn(
                    f"Detector {self.key!r} produced more than {self.max_findings} findings on "
                    f"{asset_name or 'an asset'}; the rest were dropped"
                )
                break
            if not isinstance(payload, Mapping):
                raise ValueError(f"Malformed finding payload: {type(payload).__name__}")
            results.append(self._one(payload, detected_at))
        return results

    def _one(self, payload: Mapping[str, Any], detected_at: datetime) -> DetectionResult:
        label = str(payload.get("label") or "").strip()
        if not label:
            raise ValueError("Malformed finding payload: empty label")
        value = str(payload.get("value") if payload.get("value") is not None else "")
        value = value[:MAX_VALUE_CHARS]
        try:
            confidence = float(payload.get("confidence", 1.0))
        except (TypeError, ValueError):
            confidence = 1.0
        confidence = min(1.0, max(0.0, confidence))

        requested = payload.get("severity")
        applied, refused = bound_severity(self.ceiling, requested)

        location, tabular = _location(payload.get("location"))

        metadata: dict[str, Any] = {"runner": RUNNER, "label": label, **tabular}
        message = payload.get("message")
        if isinstance(message, str) and message:
            metadata["message"] = message[:MAX_MESSAGE_CHARS]
        normalized = payload.get("normalized_value")
        if isinstance(normalized, str) and normalized.strip():
            metadata["normalized_value"] = normalized.strip()[:MAX_VALUE_CHARS]
        if refused and requested is not None:
            metadata["severity_requested"] = str(requested).strip().lower()
        if applied != self.ceiling:
            metadata["severity_applied"] = applied

        extracted = self._fields(payload.get("fields"))

        identity = payload.get("identity")
        # Overlong keys are hashed, never truncated: truncation collides
        # ("row-111..." vs "row-111..." with a different tail become one
        # finding), and the API applies the same hash, so both sides agree.
        identity_key = (
            _identity_key(str(identity)) if identity not in (None, "") else None
        )
        if identity_key is not None:
            metadata["identity"] = identity_key

        return DetectionResult(
            detector_type=DetectorType.CUSTOM,
            finding_type=label,
            category=self.category,
            severity=applied,
            confidence=confidence,
            matched_content=value,
            location=location,
            custom_detector_key=self.key,
            custom_detector_name=self.name,
            detected_at=detected_at,
            metadata=metadata,
            extracted_data=extracted,
            extraction_method=RUNNER,
            identity_key=identity_key,
        )

    def _fields(self, raw: Any) -> dict[str, Any] | None:
        if not isinstance(raw, Mapping) or not raw:
            return None
        kept: dict[str, Any] = {}
        for field_name, value in raw.items():
            name = str(field_name)
            declared = self.fields.get(name)
            if declared is None:
                self._warn_once(
                    f"undeclared:{name}",
                    f"Detector {self.key!r} emitted field {name!r}, which it does not declare; "
                    "the field was dropped. Declare it under 'fields' to keep it.",
                )
                continue
            if not _field_matches(declared, value):
                self._warn_once(
                    f"type:{name}",
                    f"Detector {self.key!r} emitted field {name!r} as "
                    f"{type(value).__name__}, but declares it {declared}; the value was dropped.",
                )
                continue
            kept[name] = value
        return kept or None


__all__ = ["RUNNER", "FindingMapper", "bound_severity", "_identity_key"]
