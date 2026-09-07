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

from typing import Final

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


def detector_engine_version(detector_type: str) -> int:
    """Engine version for a detector type; 0 for types added without a stamp."""
    return DETECTOR_ENGINE_VERSION.get(detector_type.strip().upper(), 0)


def is_cacheable_detector_type(detector_type: str) -> bool:
    """False when the detector's result can change without the asset changing."""
    return detector_type.strip().upper() not in NON_CACHEABLE_DETECTOR_TYPES
