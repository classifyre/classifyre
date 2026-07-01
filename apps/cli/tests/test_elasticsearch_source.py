from __future__ import annotations

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
    calls: dict[str, Any] = {}

    def fake_get(self: requests.Session, url: str, **_kwargs: Any) -> _FakeResponse:
        calls["auth"] = self.auth
        calls["headers"] = dict(self.headers)
        calls["verify"] = self.verify
        if url.endswith("/_cat/indices"):
            return _FakeResponse(_INDICES)
        if url.endswith("/_cluster/health"):
            return _FakeResponse({"status": "green"})
        raise AssertionError(f"unexpected GET {url}")

    def fake_post(_self: requests.Session, _url: str, **kwargs: Any) -> _FakeResponse:
        calls["search_body"] = kwargs.get("json")
        size = (kwargs.get("json") or {}).get("size", len(_DOCS))
        hits = [{"_source": doc} for doc in _DOCS[:size]]
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
