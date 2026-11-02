"""ctx.query_*() reads and ctx.tag()/ctx.link() writes across sources.

The SDK half only: a fake relay stands in for the parent process. The relay
table and the API are exercised by test_custom_source.py and the API specs.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.notebook.sdk import (
    AssetQueryError,
    AugmentationError,
    Context,
    QueriedAsset,
    Tag,
)

A1 = "11111111-1111-4111-8111-111111111111"
A2 = "22222222-2222-4222-8222-222222222222"


def recording(responses: dict[str, Any] | None = None):
    calls: list[tuple[str, dict[str, Any]]] = []
    answers = responses or {}

    def relay(op: str, payload: dict[str, Any]) -> Any:
        calls.append((op, payload))
        answer = answers.get(op, {"items": [], "nextCursor": None})
        if callable(answer):
            return answer(payload)
        return answer

    return relay, calls


def asset(asset_id: str = A1) -> QueriedAsset:
    return QueriedAsset(
        id=asset_id,
        asset_hash="h",
        urn=None,
        source_id="s",
        source_name="S",
        external_id=None,
        name="n",
        kind="record",
        url="",
        metadata={},
    )


def test_assets_can_be_filtered_by_findings_terms_and_meaning() -> None:
    relay, calls = recording()
    Context(relay=relay).query_assets(
        search="acme",
        status=["NEW"],
        term="pii",
        include_narrower=True,
        findings={"detector": "qa-flag", "severity": ["HIGH", "CRITICAL"], "asserted_by": "src-1"},
        semantic="invoices about delayed payment",
        include=["findings"],
        cohort=False,
    )
    assert calls == [
        (
            "query_assets",
            {
                "limit": 1000,
                "search": "acme",
                "status": ["NEW"],
                "term": {"keys": ["pii"], "includeNarrower": True},
                "findings": {
                    "customDetectorKey": ["qa-flag"],
                    "severity": ["HIGH", "CRITICAL"],
                    "assertedBySourceId": ["src-1"],
                },
                "semantic": {"query": "invoices about delayed payment", "mode": "hybrid"},
                "include": ["findings"],
            },
        )
    ]


def test_an_unknown_finding_filter_names_the_valid_ones() -> None:
    relay, _ = recording()
    with pytest.raises(AssetQueryError, match="detector"):
        Context(relay=relay).query_assets(findings={"colour": "red"})


def test_reads_work_for_sources_findings_and_detectors_and_page_by_cursor() -> None:
    pages = iter(
        [
            {
                "items": [{"id": "f1", "assetId": A1, "customDetectorKey": "qa-flag"}],
                "nextCursor": "c1",
            },
            {
                "items": [{"id": "f2", "assetId": A2, "assertedBySourceId": "src-1"}],
                "nextCursor": None,
            },
        ]
    )
    relay, calls = recording(
        {
            "query_findings": lambda _payload: next(pages),
            "query_sources": {
                "items": [{"id": "s1", "name": "Docs", "type": "S3", "runnerStatus": "COMPLETED"}]
            },
            "query_detectors": {
                "items": [
                    {
                        "id": "d1",
                        "key": "qa-flag",
                        "name": "QA",
                        "type": "TAG",
                        "isActive": True,
                        "version": 2,
                    }
                ]
            },
        }
    )
    ctx = Context(relay=relay)

    assert [f.id for f in ctx.each_finding(detector="qa-flag")] == ["f1", "f2"]
    assert calls[0][1]["customDetectorKey"] == ["qa-flag"] and "cursor" not in calls[0][1]
    assert calls[1][1]["cursor"] == "c1"
    assert ctx.query_sources(type="S3").items[0].run_status == "COMPLETED"
    detector = ctx.query_detectors(type="TAG").items[0]
    assert (detector.key, detector.type, detector.version) == ("qa-flag", "TAG", 2)


def test_findings_walk_back_to_the_asset_and_its_author() -> None:
    relay, _ = recording(
        {
            "query_findings": {
                "items": [
                    {"id": "f", "assetId": A1, "assertedBySourceId": "src-9", "confidence": "1"}
                ]
            }
        }
    )
    finding = Context(relay=relay).query_findings(asserted_by="src-9").items[0]
    assert finding.asset_id == A1 and finding.asserted_by_source_id == "src-9"


def test_reads_and_writes_need_a_scan() -> None:
    ctx = Context()
    for read in (ctx.query_sources, ctx.query_findings, ctx.query_detectors):
        with pytest.raises(AssetQueryError, match="scans only"):
            read()
    ctx.tag(A1, "qa-flag", "x")
    with pytest.raises(AugmentationError, match="scan"):
        ctx.flush_augmentations()


def test_tags_are_joined_per_key_and_sent_with_severity_once() -> None:
    relay, calls = recording({"augment_tags": {"written": 2}})
    ctx = Context(relay=relay)
    ctx.tag(asset(A1), "qa-flag", "needs review")
    ctx.tag(A1, "qa-flag", "stale")
    ctx.tag(A1, "qa-flag", "stale")  # a repeat adds nothing
    ctx.tag(A2, "owner", Tag("legal", "high"))
    ctx.tags(A2, {"region": "EU"})

    assert calls == []  # buffered
    stats = ctx.flush_augmentations()

    [(op, payload)] = calls
    assert op == "augment_tags"
    assert sorted(
        (t["assetId"], t["key"], t["value"], t.get("severity")) for t in payload["tags"]
    ) == [
        (A1, "qa-flag", "needs review, stale", None),
        (A2, "owner", "legal", "HIGH"),
        (A2, "region", "EU", None),
    ]
    assert stats["tags"] == 2  # what the API says it wrote


def test_links_take_assets_ids_or_urns_and_glossary_terms() -> None:
    relay, calls = recording({"augment_edges": {"written": 3, "skipped": 0}})
    ctx = Context(relay=relay)
    ctx.link(asset(A1), A2, "references", confidence=0.8, evidence={"why": "same invoice"})
    ctx.link(A1, "urn:classifyre:db:orders", "SAME_AS")
    ctx.means(asset(A2), "Invoice")
    ctx.flush_augmentations()

    [(op, payload)] = calls
    assert op == "augment_edges"
    assert payload["edges"] == [
        {
            "relationType": "REFERENCES",
            "fromId": A1,
            "toId": A2,
            "confidence": 0.8,
            "evidence": {"why": "same invoice"},
        },
        {"relationType": "SAME_AS", "fromId": A1, "toUrn": "urn:classifyre:db:orders"},
        {
            "relationType": "MEANS",
            "fromId": A2,
            "toUrn": "term://glossary/invoice",
            "relationClass": "REFERENCE",
        },
    ]


def test_bad_arguments_fail_before_anything_is_sent() -> None:
    relay, calls = recording()
    ctx = Context(relay=relay)
    with pytest.raises(AugmentationError, match="needs an asset"):
        ctx.tag("not-an-id", "k", "v")
    with pytest.raises(AugmentationError, match="non-empty"):
        ctx.tag(A1, "k", "  ")
    with pytest.raises(AugmentationError, match="URN"):
        ctx.link(A1, "plain words")
    assert calls == []


def test_a_large_buffer_is_sent_in_bounded_calls() -> None:
    relay, calls = recording({"augment_tags": {"written": 1000}})
    ctx = Context(relay=relay)
    for i in range(2500):
        ctx.tag(f"{i:08d}-1111-4111-8111-111111111111", "k", "v")
    ctx.flush_augmentations()
    assert [len(c[1]["tags"]) for c in calls] == [1000, 1000, 500]


def test_a_refused_write_reaches_the_notebook_as_an_augmentation_error() -> None:
    def refuse(_op: str, _payload: dict[str, Any]) -> Any:
        raise AssetQueryError("augment_tags was refused (400): No active Tag detector")

    ctx = Context(relay=refuse)
    ctx.tag(A1, "nope", "v")
    with pytest.raises(AugmentationError, match="No active Tag detector"):
        ctx.flush_augmentations()


def test_a_query_in_augment_does_not_declare_partial_coverage_unless_asked() -> None:
    relay, _ = recording()
    ctx = Context(relay=relay)
    ctx.set_phase("augment")
    ctx.query_assets()
    assert ctx.partial_coverage is False
    ctx.query_assets(cohort=True)
    assert ctx.partial_coverage is True
    ctx.set_phase("extract")
    other = Context(relay=relay)
    other.query_assets()
    assert other.partial_coverage is True


def test_a_notebook_that_only_augments_needs_no_extract() -> None:
    from src.notebook.contract import validate_notebook

    def cells(source: str) -> list[dict[str, str]]:
        return [{"id": "c1", "type": "code", "source": source}]

    augment_only = "def test_connection():\n    return {}\n\ndef augment_sources():\n    pass\n"
    assert validate_notebook(cells(augment_only)).ok
    # Without augment_sources, extract is still required.
    report = validate_notebook(cells("def test_connection():\n    return {}\n"))
    assert [v.kind for v in report.violations] == ["missing_function"]
