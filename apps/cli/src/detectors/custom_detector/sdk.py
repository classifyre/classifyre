"""What a code detector sees: ``detect(asset, ctx)``, ``Finding`` and ``ctx``.

A code detector (pipeline type ``CUSTOM_DETECTOR``) is the judging half of the
notebook story. Augmentation *adds* to an asset; a detector *judges* it. So the
surface here is the augmentation one with the writers taken away:

- ``asset`` is a :class:`DetectorAsset`: every reader of the augmentation
  ``AugmentedAsset`` (``payload()``, ``raw_pages()``, ``rows()``, ``text()``,
  ``pages()``, ``metadata``, ...) and none of its writers. Calling ``set`` or
  ``tag`` raises, rather than being silently dropped, because a rule that
  thinks it recorded something would be wrong for as long as nobody noticed.
  With ``needs_findings`` it also carries ``asset.findings``: what the other
  detectors found on this asset in this run.
- ``ctx`` is a :class:`DetectorContext`: the notebook ``Context`` (``var``,
  ``secret``, ``file``, ``files``, ``log``, ``now``) plus ``state``, a per-run
  dictionary ``setup(ctx)`` fills once.
- ``detect`` yields (or returns a list of) :class:`Finding`.
"""

from __future__ import annotations

import json
import math
import types
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from ...augmentation.sdk import AugmentContext, AugmentedAsset, NeedsFetcher
from ...notebook.files import ParsedContent, pages, parse
from ...notebook.sdk import MODULE_NAME, NotebookFile

#: The severities a finding may name, most severe first.
SEVERITIES = ("critical", "high", "medium", "low", "info")

_LOCATION_KEYS = ("path", "description", "line", "column", "start", "end", "row", "column_name")


@dataclass(frozen=True)
class Location:
    """Where a finding sits inside the asset.

    ``row`` and ``column_name`` address a table cell; they land in
    ``metadata.tabular_row_index`` / ``tabular_column_name``, the convention the
    PII detector already uses, so the UI shows them the same way.
    """

    path: str | None = None
    description: str | None = None
    line: int | None = None
    column: int | None = None
    start: int | None = None
    end: int | None = None
    row: int | None = None
    column_name: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return {key: getattr(self, key) for key in _LOCATION_KEYS if getattr(self, key) is not None}


@dataclass(frozen=True)
class Finding:
    """One thing the rule found.

    ``label`` names the kind of finding (it becomes the finding type) and
    ``value`` is what matched. ``identity`` keeps a finding stable across runs
    when its value text changes -- "total 523 != 520" and "total 524 != 520" on
    the same row are the same problem, so give both ``identity="row-17"``.
    ``normalized_value`` is what enters the value index (duplicates, entity
    resolution); findings without one stay out of it. ``fields`` must be
    declared on the detector.
    """

    label: str
    value: Any
    severity: str | None = None
    confidence: float = 1.0
    location: Location | Mapping[str, Any] | None = None
    message: str | None = None
    fields: Mapping[str, Any] | None = None
    normalized_value: str | None = None
    identity: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """The wire shape the parent validates. Raises on what cannot cross."""
        label = str(self.label or "").strip()
        if not label:
            raise ValueError("Finding needs a non-empty label")
        if self.value is None:
            raise ValueError(f"Finding {label!r} needs a value")
        value = self.value if isinstance(self.value, str) else _stringify(self.value)
        try:
            confidence = float(self.confidence)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Finding {label!r}: confidence must be a number") from exc
        if math.isnan(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError(f"Finding {label!r}: confidence must be between 0 and 1")
        payload: dict[str, Any] = {"label": label, "value": value, "confidence": confidence}
        if self.severity is not None:
            payload["severity"] = str(self.severity).strip().lower()
        location = _location_payload(self.location)
        if location:
            payload["location"] = location
        if self.message is not None:
            payload["message"] = str(self.message)
        if self.fields:
            if not isinstance(self.fields, Mapping):
                raise ValueError(f"Finding {label!r}: fields must be a dict")
            fields = {str(key): item for key, item in self.fields.items()}
            try:
                json.dumps(fields)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Finding {label!r}: fields must be JSON-serializable") from exc
            payload["fields"] = fields
        if self.normalized_value is not None:
            payload["normalized_value"] = str(self.normalized_value)
        if self.identity is not None:
            payload["identity"] = str(self.identity)
        return payload


def _stringify(value: Any) -> str:
    if isinstance(value, bool | int | float):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return str(value)


def _location_payload(location: Any) -> dict[str, Any]:
    if location is None:
        return {}
    if isinstance(location, Location):
        return location.to_payload()
    if isinstance(location, Mapping):
        unknown = sorted(str(key) for key in location if key not in _LOCATION_KEYS)
        if unknown:
            raise ValueError(
                f"Unknown location key(s) {', '.join(unknown)}; "
                f"expected any of {', '.join(_LOCATION_KEYS)}"
            )
        return {str(key): item for key, item in location.items() if item is not None}
    raise ValueError(f"location must be a Location or a dict, got {type(location).__name__}")


@dataclass(frozen=True)
class PriorFinding:
    """A finding another detector produced on this asset in this run."""

    detector: str
    type: str
    value: str
    severity: str
    confidence: float
    custom_detector_key: str | None = None
    location: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, raw: Mapping[str, Any]) -> PriorFinding:
        location = raw.get("location")
        metadata = raw.get("metadata")
        try:
            confidence = float(raw.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        return cls(
            detector=str(raw.get("detector") or ""),
            type=str(raw.get("type") or ""),
            value=str(raw.get("value") or ""),
            severity=str(raw.get("severity") or ""),
            confidence=confidence,
            custom_detector_key=(
                str(raw["custom_detector_key"]) if raw.get("custom_detector_key") else None
            ),
            location=types.MappingProxyType(
                dict(location) if isinstance(location, Mapping) else {}
            ),
            metadata=types.MappingProxyType(
                dict(metadata) if isinstance(metadata, Mapping) else {}
            ),
        )


_JUDGE_ONLY = (
    "A detector judges an asset; it never changes it. Record what you found by "
    "yielding Finding(...). To add metadata, tags or links, use the source's "
    "augmentation notebook instead."
)


class DetectorAsset(AugmentedAsset):
    """One asset, read-only. Every augmentation reader, no writer."""

    def __init__(
        self,
        *,
        findings: Iterable[PriorFinding] | None = None,
        findings_enabled: bool = False,
        need: NeedsFetcher | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(need=need, **kwargs)
        self._prior = tuple(findings or ())
        self._findings_enabled = findings_enabled

    @property
    def findings(self) -> tuple[PriorFinding, ...]:
        """What the other detectors found on this asset in this run.

        Only populated when the detector sets ``needs_findings``; reading it
        otherwise raises so an empty tuple is never mistaken for "nothing found".
        """
        if not self._findings_enabled:
            raise AttributeError(
                "asset.findings is only available when the detector enables needs_findings"
            )
        return self._prior

    def set(self, key: str, value: Any) -> None:
        raise TypeError(f"asset.set() is not available to a detector. {_JUDGE_ONLY}")

    def tag(self, key: str, value: str) -> None:
        raise TypeError(f"asset.tag() is not available to a detector. {_JUDGE_ONLY}")

    def link(self, other_hash: str) -> None:
        raise TypeError(f"asset.link() is not available to a detector. {_JUDGE_ONLY}")

    def set_urn(self, urn: str) -> None:
        raise TypeError(f"asset.set_urn() is not available to a detector. {_JUDGE_ONLY}")


class DetectorContext(AugmentContext):
    """The detector's window onto its configuration and this run.

    Everything the notebook ``Context`` offers, plus ``state`` (per-run scratch
    filled by ``setup(ctx)``), ``source`` (which source is being scanned) and
    ``detector`` (this detector's key and name).
    """

    def __init__(self, *, detector: Mapping[str, Any] | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        info = dict(detector or {})
        self._detector = {"key": str(info.get("key") or ""), "name": str(info.get("name") or "")}

    @property
    def detector(self) -> dict[str, str]:
        return dict(self._detector)


def iter_findings(value: Any) -> Iterator[dict[str, Any]]:
    """Normalize what ``detect()`` returned into wire payloads.

    Accepts a generator, a list or tuple, a single ``Finding``, or ``None``.
    A plain dict with ``label`` and ``value`` is accepted too, for rules that
    build findings from JSON. Anything else raises: a bare string return is
    almost always a forgotten ``Finding(...)``.
    """
    if value is None:
        return
    if isinstance(value, Finding | Mapping):
        value = [value]
    elif isinstance(value, str | bytes):
        raise TypeError(
            "detect() must yield Finding(...) objects, got a string. "
            "Wrap it: yield Finding(label='...', value=...)."
        )
    for item in value:
        if isinstance(item, Finding):
            yield item.to_payload()
        elif isinstance(item, Mapping):
            known = {key: item[key] for key in Finding.__dataclass_fields__ if key in item}
            if "label" not in known or "value" not in known:
                raise TypeError("A finding dict needs at least 'label' and 'value'")
            yield Finding(**known).to_payload()
        else:
            raise TypeError(f"detect() must yield Finding(...) objects, got {type(item).__name__}.")


def build_detector_module(context: DetectorContext) -> types.ModuleType:
    """The synthetic ``classifyre`` module a detector notebook imports."""
    module = types.ModuleType(MODULE_NAME)
    module.__doc__ = "Runtime helpers available to a Classifyre code detector."
    exports: dict[str, Any] = {
        "Finding": Finding,
        "Location": Location,
        "PriorFinding": PriorFinding,
        "Asset": DetectorAsset,
        "DetectorAsset": DetectorAsset,
        "Context": DetectorContext,
        "NotebookFile": NotebookFile,
        "ParsedContent": ParsedContent,
        "ctx": context,
        "parse": parse,
        "pages": pages,
    }
    for name, value in exports.items():
        setattr(module, name, value)
    module.__all__ = sorted(exports)  # type: ignore[attr-defined]
    return module


def detector_namespace(context: DetectorContext) -> dict[str, Any]:
    """Globals for the assembled detector module.

    ``Finding``, ``Location`` and ``ctx`` are pre-bound as well as importable,
    so a notebook that forgets ``from classifyre import Finding`` still runs.
    """
    import sys as _sys

    _sys.modules[MODULE_NAME] = build_detector_module(context)
    return {
        "__name__": "classifyre_detector_notebook",
        "__builtins__": __builtins__,
        "Finding": Finding,
        "Location": Location,
        "ctx": context,
        "parse": parse,
        "pages": pages,
    }


__all__ = [
    "SEVERITIES",
    "DetectorAsset",
    "DetectorContext",
    "Finding",
    "Location",
    "PriorFinding",
    "build_detector_module",
    "detector_namespace",
    "iter_findings",
]
