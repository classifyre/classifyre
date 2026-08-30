"""Lineage loss has to be counted, not just logged.

The highest-impact finding of the productionisation run: a connector's
``relationships()`` raised, the runner logged a warning marked *non-fatal*, and
the run created 920 assets, reported ``COMPLETED``, and shipped **zero** edges.
Nothing in the runner summary, the source status or the UI said an entire
relationship pass had been discarded — the only trace was a line in a Kubernetes
job log.

These tests pin the two halves of the fix: the loss is counted at the point it
happens, and it travels to the API on finalize so the run can stop claiming an
unqualified success.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.main import _emit_relationships
from src.outputs.base import RelationshipReport


class _Sink:
    """Minimal stand-in for the REST sink: it only needs a report and edges."""

    def __init__(self, *, result: dict[str, int] | None = None, raise_on_emit: bool = False):
        self.relationship_report = RelationshipReport()
        self.emitted: list[Any] = []
        self._result = (
            result if result is not None else {"upserted": 0, "external": 0, "dropped": 0}
        )
        self._raise = raise_on_emit

    async def emit_edges(self, edges: list[Any]) -> dict[str, int]:
        if self._raise:
            raise RuntimeError("graph unreachable")
        self.emitted.extend(edges)
        return self._result


class _Source:
    def __init__(
        self,
        *,
        edges: list[Any] | None = None,
        collect_error: Exception | None = None,
        declares: bool = True,
    ):
        self._edges = edges or []
        self._collect_error = collect_error
        self._declares = declares

    def drain_edges(self) -> list[Any]:
        return list(self._edges)

    def declares_relationships(self) -> bool:
        return self._declares

    async def collect_relationships(self) -> list[Any]:
        if self._collect_error is not None:
            raise self._collect_error
        return []


@pytest.mark.asyncio
async def test_a_raising_relationships_pass_is_counted_not_swallowed() -> None:
    # The exact shape of the real failure: Ref.id() does not exist, the
    # AttributeError escapes relationships(), and the run keeps going.
    sink = _Sink()
    source = _Source(collect_error=AttributeError("type object 'Ref' has no attribute 'id'"))

    await _emit_relationships(source, sink)

    report = sink.relationship_report
    assert report.failed == 1
    # Passes, not edges: a pass that failed never got to say how many edges it
    # would have produced, so any edge count here would be invented.
    assert report.lost == 0
    assert report.degraded is True
    summary = report.summary()
    assert summary is not None
    assert "relationship pass(es) failed" in summary
    assert "Ref" in summary


@pytest.mark.asyncio
async def test_edges_that_cannot_be_sent_are_counted_as_edges() -> None:
    sink = _Sink(raise_on_emit=True)
    source = _Source(edges=["e1", "e2", "e3"])

    await _emit_relationships(source, sink)

    report = sink.relationship_report
    assert report.lost == 3
    assert report.failed == 0
    assert report.degraded is True


@pytest.mark.asyncio
async def test_a_clean_pass_is_not_degraded() -> None:
    sink = _Sink(result={"upserted": 2, "external": 0, "dropped": 0})
    source = _Source(edges=["e1", "e2"])

    await _emit_relationships(source, sink)

    report = sink.relationship_report
    assert report.emitted == 2
    assert report.degraded is False
    assert report.summary() is None


@pytest.mark.asyncio
async def test_unresolved_endpoints_are_reported_but_do_not_degrade_the_run() -> None:
    # The other half of a cross-source edge may simply not be ingested yet.
    # Counting that as a failure would make every correct multi-source scan
    # amber, which teaches operators to ignore the colour.
    sink = _Sink(result={"upserted": 1, "external": 0, "dropped": 1})
    source = _Source(edges=["e1", "e2"])

    await _emit_relationships(source, sink)

    report = sink.relationship_report
    assert report.dropped == 1
    assert report.emitted == 1
    assert report.degraded is False


@pytest.mark.asyncio
async def test_a_declared_but_empty_relationships_pass_is_recorded() -> None:
    sink = _Sink()
    source = _Source(edges=[], declares=True)

    await _emit_relationships(source, sink)

    report = sink.relationship_report
    # Not degraded — a cohort really can have nothing to relate — but stated,
    # so "no lineage" is an outcome rather than an absence of evidence.
    assert report.degraded is False
    assert report.errors == ["relationships() produced no edges"]


@pytest.mark.asyncio
async def test_a_connector_with_no_relationships_says_nothing() -> None:
    sink = _Sink()
    source = _Source(edges=[], declares=False)

    await _emit_relationships(source, sink)

    assert sink.relationship_report.errors == []


def test_error_strings_are_capped() -> None:
    report = RelationshipReport()
    for i in range(20):
        report.record_failure(f"error {i}")
    assert len(report.errors) == RelationshipReport.MAX_ERRORS
    assert report.failed == 20
