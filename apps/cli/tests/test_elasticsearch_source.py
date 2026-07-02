from __future__ import annotations

import base64
import json
from typing import Any

import pytest
import requests

from src.sources.elasticsearch.source import ElasticsearchSource

_INDICES = [
    {
        "index": "orders",
        "health": "green",
        "docs.count": "42",
        "store.size": "1024",
        "pri": "1",
        "rep": "1",
    },
    {
        "index": ".kibana_1",
        "health": "green",
        "docs.count": "3",
        "store.size": "100",
        "pri": "1",
        "rep": "0",
    },
]

_DOCS = [{"id": i, "value": f"row-{i}"} for i in range(12)]


class _FakeResponse:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> Any:
        return self._payload


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "ELASTICSEARCH",
        "required": {"auth_mode": "NONE", "url": "http://localhost:9200"},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture
def _patch_requests(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: dict[str, Any] = {"search_bodies": []}

    def fake_get(self: requests.Session, url: str, **_kwargs: Any) -> _FakeResponse:
        calls["auth"] = self.auth
        calls["headers"] = dict(self.headers)
        calls["verify"] = self.verify
        if url.endswith("/_cat/indices"):
            return _FakeResponse(_INDICES)
        if url.endswith("/_cluster/health"):
            return _FakeResponse({"status": "green"})
        if url.endswith("/_count"):
            return _FakeResponse({"count": len(_DOCS)})
        raise AssertionError(f"unexpected GET {url}")

    def fake_post(_self: requests.Session, _url: str, **kwargs: Any) -> _FakeResponse:
        body = kwargs.get("json") or {}
        calls["search_bodies"].append(body)
        calls["search_body"] = body
        size = body.get("size", len(_DOCS))
        offset = body.get("from", 0)
        page = _DOCS[offset : offset + size]
        hits = [{"_source": doc} for doc in page]
        return _FakeResponse({"hits": {"hits": hits}})

    monkeypatch.setattr(requests.Session, "get", fake_get)
    monkeypatch.setattr(requests.Session, "post", fake_post)
    return calls


def test_elasticsearch_test_connection_success(_patch_requests: dict[str, Any]) -> None:
    src = ElasticsearchSource(_recipe())
    result = src.test_connection()
    assert result["status"] == "SUCCESS"
    assert "green" in result["message"]


def test_elasticsearch_excludes_system_indices_by_default(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe())
    rows = src._list_indices()
    assert [r["index"] for r in rows] == ["orders"]


async def test_elasticsearch_extract_emits_index_assets(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe())
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "index"
    assert asset.name == "orders"
    meta = asset.metadata
    assert meta["doc_count"] == 42
    assert meta["store_size_bytes"] == 1024
    assert meta["primary_shards"] == 1
    assert meta["replica_shards"] == 1
    assert meta["health"] == "green"


async def test_elasticsearch_fetch_content_samples_documents(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)
    assert result is not None
    _raw, text = result
    assert text.count("document_") == 10
    assert "row-0" in text


def test_elasticsearch_basic_auth_sets_session_auth(_patch_requests: dict[str, Any]) -> None:
    src = ElasticsearchSource(
        _recipe(
            required={"auth_mode": "BASIC", "url": "https://es.example.com:9200"},
            masked={"username": "elastic", "password": "secret"},
        )
    )
    src.test_connection()
    assert _patch_requests["auth"] == ("elastic", "secret")


def test_elasticsearch_api_key_auth_sets_authorization_header(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(
        _recipe(
            required={"auth_mode": "API_KEY", "url": "https://es.example.com:9200"},
            masked={"api_key": "my-key"},
        )
    )
    src.test_connection()
    assert _patch_requests["headers"]["Authorization"] == "ApiKey my-key"


# ── Sampling strategies ──────────────────────────────────────────────────


def test_elasticsearch_random_strategy_uses_random_score_query(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    src._sample_documents("orders", 10)
    body = _patch_requests["search_body"]
    assert "random_score" in body["query"]["function_score"]
    assert "from" not in body
    assert "sort" not in body


def test_elasticsearch_latest_strategy_sorts_by_order_by_column(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "order_by_column": "updated_at",
            }
        )
    )
    src._sample_documents("orders", 10)
    body = _patch_requests["search_body"]
    assert body["sort"] == [{"updated_at": {"order": "desc", "unmapped_type": "date"}}]


def test_elasticsearch_latest_strategy_falls_back_to_doc_sort(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10}))
    src._sample_documents("orders", 10)
    body = _patch_requests["search_body"]
    assert body["sort"] == [{"_doc": "desc"}]


def test_elasticsearch_automatic_strategy_starts_at_offset_zero(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    docs = src._sample_documents("orders", 10)
    body = _patch_requests["search_body"]
    assert body["from"] == 0
    assert body["size"] == 10
    assert len(docs) == 10
    # A full page was fetched (10 == rows_per_page) → cursor advances, no wrap.
    assert src.current_sampling_cursor() == {"index:orders": 10}


def test_elasticsearch_automatic_strategy_resumes_and_wraps_on_underfill(
    _patch_requests: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    saved_cursor = base64.b64encode(json.dumps({"index:orders": 10}).encode()).decode()
    monkeypatch.setenv("CLASSIFYRE_SAMPLING_CURSOR", saved_cursor)

    src = ElasticsearchSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    docs = src._sample_documents("orders", 10)
    body = _patch_requests["search_body"]
    assert body["from"] == 10
    # Only 2 of 12 docs remain from offset 10 → underfilled page → wraps to 0.
    assert len(docs) == 2
    assert src.current_sampling_cursor() == {"index:orders": 0}


async def test_elasticsearch_all_strategy_batches_and_stops_on_underfill(
    _patch_requests: dict[str, Any],
) -> None:
    src = ElasticsearchSource(_recipe(sampling={"strategy": "ALL", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    pages = [p async for p in src.fetch_content_pages(assets[0].hash)]

    # 12 documents total, one page yielded per document.
    assert len(pages) == 12

    bodies = _patch_requests["search_bodies"]
    # Exactly 2 underlying _search calls (batch 1: 10 docs, batch 2: 2 docs).
    assert len(bodies) == 2
    assert bodies[0]["from"] == 0
    assert bodies[0]["size"] == 10
    assert bodies[1]["from"] == 10
    assert bodies[1]["size"] == 10
