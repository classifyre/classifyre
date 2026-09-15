"""``ctx.query_assets()`` in the SDK: what a notebook sends and gets back."""

from __future__ import annotations

from typing import Any

import pytest

from src.notebook.sdk import AssetQueryError, Context


def test_outside_a_scan_it_says_so() -> None:
    # A cell run in the editor has no run to scope the read to.
    with pytest.raises(AssetQueryError, match="during scans only"):
        Context().query_assets("Firmenbuch Register")


def test_it_sends_the_api_shape_and_reads_a_page() -> None:
    sent: list[dict[str, Any]] = []

    def relay(payload: dict[str, Any]) -> dict[str, Any]:
        sent.append(payload)
        return {
            "items": [
                {
                    "assetHash": "h1",
                    "externalId": "company:606601k",
                    "name": "Example GmbH",
                    "kind": "record",
                    "url": "https://example.com/606601k",
                    "metadata": {"firmenbuchnummer": "606601k"},
                }
            ],
            "nextCursor": "c-1",
            "callsRemaining": 99,
        }

    ctx = Context(query_assets=relay)
    page = ctx.query_assets(
        "Firmenbuch Register",
        kind="record",
        where={"legal_form_code": {"in": ["GES", "AG"]}},
        exclude_visited={"key": "firmenbuchnummer", "since_days": 90},
        select=["firmenbuchnummer"],
        limit=1200,
    )

    assert sent == [
        {
            "source": "Firmenbuch Register",
            "limit": 1200,
            "kind": "record",
            "where": {"legal_form_code": {"in": ["GES", "AG"]}},
            "excludeVisited": {"key": "firmenbuchnummer", "sinceDays": 90},
            "select": ["firmenbuchnummer"],
        }
    ]
    assert [item.metadata["firmenbuchnummer"] for item in page.items] == ["606601k"]
    assert page.items[0].external_id == "company:606601k"
    assert page.next_cursor == "c-1"
    assert page.calls_remaining == 99


def test_querying_a_cohort_declares_partial_coverage() -> None:
    # A connector that works from a query never sees the rest of its source;
    # left at "covered everything", the platform would retire what it skipped.
    ctx = Context(query_assets=lambda _payload: {"items": []})
    ctx.query_assets("Firmenbuch Register")
    assert ctx.partial_coverage is True
    assert "query_assets" in ctx.partial_coverage_reason


def test_it_keeps_a_reason_the_notebook_already_gave() -> None:
    ctx = Context(query_assets=lambda _payload: {"items": []})
    ctx.set_partial_coverage("weekly change feed")
    ctx.query_assets("Firmenbuch Register")
    assert ctx.partial_coverage_reason == "weekly change feed"
