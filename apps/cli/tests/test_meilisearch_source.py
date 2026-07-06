from __future__ import annotations

import base64
import json
from typing import Any

import pytest
import requests

from src.sources.meilisearch.source import MeilisearchSource

_INDEX_LIST_PAGE1 = {
    "results": [
        {
            "uid": "products",
            "primaryKey": "id",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
        },
        {
            "uid": "internal_logs",
            "primaryKey": "id",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
        },
    ],
    "offset": 0,
    "limit": 100,
    "total": 2,
}

_STATS = {
    "products": {"numberOfDocuments": 12, "isIndexing": False},
    "internal_logs": {"numberOfDocuments": 5, "isIndexing": True},
}

_DOCS = [{"id": i, "value": f"row-{i}"} for i in range(12)]


class _FakeResponse:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> Any:
        return self._payload


class _FakeHTTPErrorResponse:
    def raise_for_status(self) -> None:
        raise requests.exceptions.HTTPError("400 Client Error: sort not allowed")

    def json(self) -> Any:
        return {}


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "MEILISEARCH",
        "required": {"auth_mode": "NONE", "url": "http://localhost:7700"},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture
def _patch_requests(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: dict[str, Any] = {"search_bodies": []}

    def fake_get(self: requests.Session, url: str, **_kwargs: Any) -> _FakeResponse:
        calls["headers"] = dict(self.headers)
        calls["verify"] = self.verify
        if url.endswith("/indexes"):
            return _FakeResponse(_INDEX_LIST_PAGE1)
        if url.endswith("/health"):
            return _FakeResponse({"status": "available"})
        for uid, stats in _STATS.items():
            if url.endswith(f"/indexes/{uid}/stats"):
                return _FakeResponse(stats)
        raise AssertionError(f"unexpected GET {url}")

    def fake_post(_self: requests.Session, _url: str, **kwargs: Any) -> _FakeResponse:
        body = kwargs.get("json") or {}
        calls["search_bodies"].append(body)
        calls["search_body"] = body
        if calls.get("force_sort_error") and "sort" in body:
            return _FakeHTTPErrorResponse()
        limit = body.get("limit", len(_DOCS))
        offset = body.get("offset", 0)
        page = _DOCS[offset : offset + limit]
        return _FakeResponse({"hits": page, "offset": offset, "limit": limit})

    monkeypatch.setattr(requests.Session, "get", fake_get)
    monkeypatch.setattr(requests.Session, "post", fake_post)
    return calls


def test_meilisearch_test_connection_success(_patch_requests: dict[str, Any]) -> None:
    src = MeilisearchSource(_recipe())
    result = src.test_connection()
    assert result["status"] == "SUCCESS"
    assert "available" in result["message"]


def test_meilisearch_excludes_via_scope(_patch_requests: dict[str, Any]) -> None:
    src = MeilisearchSource(_recipe(optional={"scope": {"exclude_indices": ["internal_logs"]}}))
    rows = src._list_indices()
    assert [r["uid"] for r in rows] == ["products"]


async def test_meilisearch_extract_emits_index_assets(_patch_requests: dict[str, Any]) -> None:
    src = MeilisearchSource(_recipe())
    assets = [a async for batch in src.extract_raw() for a in batch]
    names = {a.name for a in assets}
    assert names == {"products", "internal_logs"}
    products = next(a for a in assets if a.name == "products")
    assert products.asset_kind == "index"
    assert products.metadata["doc_count"] == 12
    assert products.metadata["primary_key"] == "id"
    assert products.metadata["is_indexing"] is False


async def test_meilisearch_fetch_content_samples_documents(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)
    assert result is not None
    _raw, text = result
    assert text.count("document_") == 10


def test_meilisearch_api_key_auth_sets_authorization_header(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(
        _recipe(
            required={"auth_mode": "API_KEY", "url": "https://ms.example.com"},
            masked={"api_key": "my-key"},
        )
    )
    src.test_connection()
    assert _patch_requests["headers"]["Authorization"] == "Bearer my-key"


# ── Sampling strategies ──────────────────────────────────────────────────


def test_meilisearch_random_strategy_picks_bounded_random_offset(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    docs = src._sample_documents("products", 10)
    body = _patch_requests["search_body"]
    # products has 12 docs (stats), so offset must be within [0, 12-10]
    assert 0 <= body["offset"] <= 2
    assert body["limit"] == 10
    assert len(docs) == 10


def test_meilisearch_latest_strategy_sorts_by_order_by_column(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "order_by_column": "updated_at",
            }
        )
    )
    src._sample_documents("products", 10)
    body = _patch_requests["search_body"]
    assert body["sort"] == ["updated_at:desc"]


def test_meilisearch_latest_strategy_without_order_by_column_has_no_sort(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10}))
    src._sample_documents("products", 10)
    body = _patch_requests["search_body"]
    assert "sort" not in body


def test_meilisearch_latest_strategy_falls_back_when_sort_fails(
    _patch_requests: dict[str, Any],
) -> None:
    _patch_requests["force_sort_error"] = True
    src = MeilisearchSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "order_by_column": "not_sortable",
            }
        )
    )
    docs = src._sample_documents("products", 10)
    bodies = _patch_requests["search_bodies"]
    # First attempt included sort and failed; second (fallback) has no sort.
    assert bodies[0]["sort"] == ["not_sortable:desc"]
    assert "sort" not in bodies[1]
    assert len(docs) == 10


def test_meilisearch_automatic_strategy_starts_at_offset_zero(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    docs = src._sample_documents("products", 10)
    body = _patch_requests["search_body"]
    assert body["offset"] == 0
    assert body["limit"] == 10
    assert len(docs) == 10
    assert src.current_sampling_cursor() == {"index:products": 10}


def test_meilisearch_automatic_strategy_resumes_and_wraps_on_underfill(
    _patch_requests: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    saved_cursor = base64.b64encode(json.dumps({"index:products": 10}).encode()).decode()
    monkeypatch.setenv("CLASSIFYRE_SAMPLING_CURSOR", saved_cursor)

    src = MeilisearchSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    docs = src._sample_documents("products", 10)
    body = _patch_requests["search_body"]
    assert body["offset"] == 10
    assert len(docs) == 2
    assert src.current_sampling_cursor() == {"index:products": 0}


async def test_meilisearch_all_strategy_batches_and_stops_on_underfill(
    _patch_requests: dict[str, Any],
) -> None:
    src = MeilisearchSource(_recipe(sampling={"strategy": "ALL", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    target = next(a for a in assets if a.name == "products")
    pages = [p async for p in src.fetch_content_pages(target.hash)]

    assert len(pages) == 12

    bodies = _patch_requests["search_bodies"]
    assert len(bodies) == 2
    assert bodies[0]["offset"] == 0
    assert bodies[0]["limit"] == 10
    assert bodies[1]["offset"] == 10
    assert bodies[1]["limit"] == 10
