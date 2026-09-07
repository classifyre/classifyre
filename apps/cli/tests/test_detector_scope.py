"""A detector can be restricted to part of a source.

A custom detector attaches to a SOURCE, so without a scope it runs on every
asset that source produces. For an LLM detector that is not a tuning problem
but a design problem: pointing one at a documents source meant a model call per
filed PDF and per raw XML blob — 3 to 25 seconds each, on inputs the model had
no business reading — and the run spent its whole life in the detector pool. The
only workaround was splitting one source into two, which is defensible
architecture but was forced rather than chosen.
"""

from __future__ import annotations

from types import SimpleNamespace

from src.pipeline.detector_pipeline import (
    _detector_covers_asset,
    _detector_covers_content_type,
)


def _detector(scope: object | None):
    """A detector shaped like CustomDetector as far as scoping can see."""
    return SimpleNamespace(
        custom_config=SimpleNamespace(pipeline_schema=SimpleNamespace(scope=scope))
    )


def _asset(*, kind: str | None = "record", metadata: dict | None = None):
    return SimpleNamespace(asset_kind=kind, metadata=metadata or {}, name="asset")


def _scope(**kwargs):
    return SimpleNamespace(
        asset_kinds=kwargs.get("asset_kinds"),
        content_types=kwargs.get("content_types"),
        metadata=kwargs.get("metadata"),
    )


def test_an_unscoped_detector_covers_everything() -> None:
    # Every detector that existed before scoping must be unaffected.
    detector = _detector(None)
    assert _detector_covers_asset(detector, _asset(kind="document")) is True
    assert _detector_covers_content_type(detector, "application/pdf") is True


def test_a_detector_that_is_not_custom_at_all_covers_everything() -> None:
    assert _detector_covers_asset(SimpleNamespace(), _asset()) is True


def test_asset_kinds_narrow_to_derived_records() -> None:
    # The actual fix for the split-source workaround: run the AI detector on the
    # short derived record, not on the filed PDF it came from.
    detector = _detector(_scope(asset_kinds=["record"]))
    assert _detector_covers_asset(detector, _asset(kind="record")) is True
    assert _detector_covers_asset(detector, _asset(kind="document")) is False


def test_asset_kinds_are_matched_case_insensitively() -> None:
    detector = _detector(_scope(asset_kinds=["Record"]))
    assert _detector_covers_asset(detector, _asset(kind="record")) is True


def test_a_metadata_predicate_must_match_every_named_key() -> None:
    detector = _detector(_scope(metadata={"doc_type": "jab", "taxonomy": "4.0"}))
    assert (
        _detector_covers_asset(detector, _asset(metadata={"doc_type": "jab", "taxonomy": "4.0"}))
        is True
    )
    assert _detector_covers_asset(detector, _asset(metadata={"doc_type": "jab"})) is False


def test_an_absent_metadata_key_is_not_a_match() -> None:
    detector = _detector(_scope(metadata={"doc_type": "jab"}))
    assert _detector_covers_asset(detector, _asset(metadata={})) is False


def test_metadata_values_are_compared_as_strings() -> None:
    # Connector-authored JSON puts a year through as 2024 or "2024" depending on
    # how it was parsed. A scope that silently stopped matching on that would be
    # a worse trap than the one scoping exists to fix.
    detector = _detector(_scope(metadata={"year": "2024"}))
    assert _detector_covers_asset(detector, _asset(metadata={"year": 2024})) is True


def test_content_types_match_by_prefix() -> None:
    detector = _detector(_scope(content_types=["text/"]))
    assert _detector_covers_content_type(detector, "text/plain") is True
    assert _detector_covers_content_type(detector, "text/xml; charset=utf-8") is True
    assert _detector_covers_content_type(detector, "application/pdf") is False


def test_an_unknown_content_type_fails_a_content_scope() -> None:
    detector = _detector(_scope(content_types=["application/pdf"]))
    assert _detector_covers_content_type(detector, "") is False


def test_predicates_and_together() -> None:
    detector = _detector(_scope(asset_kinds=["record"], metadata={"source": "jab"}))
    assert (
        _detector_covers_asset(detector, _asset(kind="record", metadata={"source": "jab"})) is True
    )
    assert (
        _detector_covers_asset(detector, _asset(kind="record", metadata={"source": "evi"})) is False
    )
    assert (
        _detector_covers_asset(detector, _asset(kind="document", metadata={"source": "jab"}))
        is False
    )
