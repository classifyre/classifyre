"""Editing the augmentation notebook invalidates the scan cache.

A cached asset is skipped before augmentation would run, so a code change that
did not invalidate the cache would silently not re-augment anything. The
augmentation revision rides in the content shape next to the detector-outcome
manifest, so a revision bump reads as "everything moved" — the same
invalidation a detector edit gets.
"""

from __future__ import annotations

from typing import Any

from src.pipeline.scan_cache import ScanCache, _content_shape


def _recipe(revision: int | None, *, enabled: bool = True) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "sampling": {"strategy": "ALL"},
        "detectors": [{"type": "PII", "enabled": True}],
    }
    if revision is not None:
        recipe["augmentation"] = {
            "enabled": enabled,
            "notebook": {"revision": revision, "cells": []},
        }
    return recipe


class _Source:
    SUPPORTS_SCAN_CACHE = True
    SCAN_CACHE_VERIFY = "metadata"


def test_revision_bump_changes_the_content_shape() -> None:
    before = _content_shape(_recipe(1))
    after = _content_shape(_recipe(2))
    assert before != after
    assert after["augmentation"] == {"enabled": True, "revision": 2}


def test_absent_augmentation_has_a_stable_shape() -> None:
    assert _content_shape(_recipe(None))["augmentation"] == {"enabled": False}
    assert _content_shape({})["augmentation"] == {"enabled": False}


def test_revision_bump_changes_detector_fingerprints() -> None:
    # Fingerprints are what the cache compares against the prior run: when
    # they move, the asset re-runs in full instead of skipping.
    first = ScanCache._build_fingerprints(_recipe(1))
    second = ScanCache._build_fingerprints(_recipe(2))
    assert first[0] != second[0]
    # Same revision, same fingerprints: the cache still hits.
    assert ScanCache._build_fingerprints(_recipe(1))[0] == first[0]


def test_disabling_invalidates_like_a_code_change() -> None:
    on = ScanCache._build_fingerprints(_recipe(1))[0]
    off = ScanCache._build_fingerprints(_recipe(1, enabled=False))[0]
    assert on != off
