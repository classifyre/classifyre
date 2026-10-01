"""Version stamps that invalidate the scan cache when *our* behaviour changes.

The scan cache skips an asset when its content and each detector's configuration
fingerprint still match the previous successful run.  Neither of those changes
when the change is ours — a new pattern in the PII detector, a new file format in
``utils/file_parser.py`` — so the fingerprint carries an explicit version that a
developer bumps by hand.

- Bump ``DETECTOR_ENGINE_VERSION[<type>]`` when a detector's rules, models,
  thresholds or finding shape change.  Every asset is then re-scanned by that
  detector alone; the others stay cached.
- Bump ``PARSER_ENGINE_VERSION`` when text extraction changes what it produces —
  a newly supported format, a different OCR path, a changed truncation rule.
  That changes the *input* to every detector, so it invalidates everything.

Forgetting a bump is not a correctness bug, but it is an invisible one: the
improvement ships and silently does not apply to already-scanned assets.  It
belongs on the release checklist.
"""

from __future__ import annotations

from typing import Any, Final

PARSER_ENGINE_VERSION: Final[int] = 1

DETECTOR_ENGINE_VERSION: Final[dict[str, int]] = {
    "SECRETS": 1,
    "PII": 1,
    "YARA": 1,
    "BROKEN_LINKS": 1,
    "CODE_SECURITY": 1,
    "CUSTOM": 2,
}

# Detectors whose verdict depends on state outside the asset, so identical
# content plus identical config does not imply an identical result.
#
# BROKEN_LINKS resolves URLs over the network: a link that answered 200 last week
# can 404 today with the document untouched.  Caching it would freeze link health
# at whatever it was on first scan, which is the opposite of what the detector is
# for.  These always run, even on an otherwise fully cached asset.
NON_CACHEABLE_DETECTOR_TYPES: Final[frozenset[str]] = frozenset({"BROKEN_LINKS"})

# Custom detectors all report type CUSTOM, so a change to one engine's semantics
# cannot be expressed through DETECTOR_ENGINE_VERSION without re-running every
# custom detector. These stamp one pipeline type instead.
PIPELINE_ENGINE_VERSION: Final[dict[str, int]] = {
    # The code-detector runtime: SDK surface, finding mapping, payload shapes.
    "CODE_DETECTOR": 1,
}


def detector_engine_version(detector_type: str) -> int:
    """Engine version for a detector type; 0 for types added without a stamp."""
    return DETECTOR_ENGINE_VERSION.get(detector_type.strip().upper(), 0)


def is_cacheable_detector_type(detector_type: str) -> bool:
    """False when the detector's result can change without the asset changing."""
    return detector_type.strip().upper() not in NON_CACHEABLE_DETECTOR_TYPES


def pipeline_type_of(config: Any) -> str | None:
    """A custom detector's pipeline type (``CODE_DETECTOR``, ``LLM``, ...)."""
    if not isinstance(config, dict):
        return None
    schema = config.get("pipeline_schema")
    if not isinstance(schema, dict):
        return None
    value = schema.get("type")
    return str(value).strip().upper() if isinstance(value, str) and value.strip() else None


def pipeline_engine_version(config: Any) -> int:
    """Engine version for a custom detector's pipeline type; 0 when unstamped."""
    pipeline_type = pipeline_type_of(config)
    return PIPELINE_ENGINE_VERSION.get(pipeline_type, 0) if pipeline_type else 0


def is_cacheable_detector(detector_type: str, config: Any) -> bool:
    """Type-level cacheability, plus a code detector's own ``deterministic`` flag.

    A code detector that reads a live list, the clock or the network declares
    ``deterministic: false``; its verdict can change with the asset untouched,
    exactly like BROKEN_LINKS, so it always runs.
    """
    if not is_cacheable_detector_type(detector_type):
        return False
    if pipeline_type_of(config) == "CODE_DETECTOR":
        schema = config.get("pipeline_schema") if isinstance(config, dict) else None
        return not (isinstance(schema, dict) and schema.get("deterministic") is False)
    return True
