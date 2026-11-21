"""Meilisearch indexes as tables (docs/prd/QC-query-connectors.md §5.5, §5.7).

The scan records each index's top-level fields as its columns; a query reads
the index live through ``/documents/fetch``, asking only for the fields it
reads and filtering on the source by its filterable attributes. The HTTP
API is faked at ``requests.Session``; DuckDB, the gate and the views are real.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
import requests

from src.query.runner import ensure_dependencies, run_query
from src.utils.uv_sync import auto_install_enabled, sync_group

if auto_install_enabled():
    for _group in ("file-processing", "lineage"):
        sync_group(_group)
try:
    ensure_dependencies()
except Exception as exc:  # auto-install off and the groups absent
    pytest.skip(f"query dependencies unavailable: {exc}", allow_module_level=True)

pa = pytest.importorskip("pyarrow")

from src.sources.meilisearch.source import MeilisearchSource  # noqa: E402

URL = "http://meili.test:7700"
MOVIES = [
    {
        "id": i,
        "title": f"Movie {i}",
        "genre": ["Drama", "Horror", "Sci-Fi"][i % 3],
        "year": 2000 + i % 25,
        "studio": {"name": f"Studio {i % 4}"},
        "tags": ["a", "b"] if i % 2 else ["c"],
        "rating": 4.5 if i % 2 else 3,
    }
    for i in range(2500)
]
COLUMNS = [
    {"name": "id", "type": "BIGINT"},
    {"name": "title", "type": "VARCHAR"},
    {"name": "genre", "type": "VARCHAR"},
    {"name": "year", "type": "BIGINT"},
    {"name": "studio", "type": "JSON"},
    {"name": "tags", "type": "VARCHAR[]"},
    {"name": "rating", "type": "DOUBLE"},
]


class _Response:
    def __init__(self, payload: Any, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            response = requests.Response()
            response.status_code = self.status_code
            raise requests.exceptions.HTTPError(
                f"{self.status_code} Client Error: secret body text", response=response
            )

    def json(self) -> Any:
        return self._payload


class FakeMeilisearch:
    def __init__(self) -> None:
        self.filterable: Any = ["genre", "year", "id"]
        self.fetches: list[dict[str, Any]] = []
        self.gets: list[tuple[str, dict[str, Any]]] = []
        self.status = 200
        self.fetch_missing = False
        self.unreachable = False
        self.headers: dict[str, str] = {}

    def get(self, session: requests.Session, url: str, **kwargs: Any) -> _Response:
        self._check(session)
        params = kwargs.get("params") or {}
        self.gets.append((url, dict(params)))
        if url.endswith("/settings/filterable-attributes"):
            return _Response(self.filterable, self.status)
        if url.endswith("/indexes/movies/documents"):
            offset, limit = int(params.get("offset", 0)), int(params.get("limit", 20))
            fields = str(params.get("fields") or "")
            docs = [_only(d, fields.split(",") if fields else None) for d in MOVIES]
            return _Response({"results": docs[offset : offset + limit], "total": len(docs)})
        raise AssertionError(f"unexpected GET {url}")

    def post(self, session: requests.Session, url: str, **kwargs: Any) -> _Response:
        self._check(session)
        body = kwargs.get("json") or {}
        if url.endswith("/indexes/movies/documents/fetch"):
            self.fetches.append(body)
            if self.fetch_missing:
                return _Response({"message": "not found"}, 404)
            if self.status >= 400:
                return _Response({"message": "secret body text"}, self.status)
            docs = [d for d in MOVIES if _filter(d, body.get("filter"))]
            offset, limit = int(body.get("offset", 0)), int(body.get("limit", 20))
            page = [_only(d, body.get("fields")) for d in docs[offset : offset + limit]]
            return _Response(
                {"results": page, "offset": offset, "limit": limit, "total": len(docs)}
            )
        raise AssertionError(f"unexpected POST {url}")

    def _check(self, session: requests.Session) -> None:
        self.headers = dict(session.headers)
        if self.unreachable:
            raise requests.exceptions.ConnectionError("connect to meili.test refused")


def _only(doc: dict[str, Any], fields: list[str] | None) -> dict[str, Any]:
    return doc if not fields or fields == ["*"] else {k: doc[k] for k in fields if k in doc}


def _filter(doc: dict[str, Any], expression: str | None) -> bool:
    """Enough of Meilisearch's filter syntax for what the connector sends."""
    if not expression:
        return True
    for part in expression.split(" AND "):
        name, op, raw = part.split(" ", 2)
        value: Any
        if op == "IN":
            value = json.loads(raw)
            if doc.get(name) not in value:
                return False
            continue
        value = json.loads(raw)
        actual = doc.get(name)
        ok = {
            "=": actual == value,
            "!=": actual != value,
            ">": actual is not None and actual > value,
            ">=": actual is not None and actual >= value,
            "<": actual is not None and actual < value,
            "<=": actual is not None and actual <= value,
        }[op]
        if not ok:
            return False
    return True


@pytest.fixture()
def meili(monkeypatch: pytest.MonkeyPatch) -> FakeMeilisearch:
    fake = FakeMeilisearch()

    # Functions, not the fake's bound methods: those would not be handed
    # the session they are called on.
    def get(session: requests.Session, url: str, **kwargs: Any) -> _Response:
        return fake.get(session, url, **kwargs)

    def post(session: requests.Session, url: str, **kwargs: Any) -> _Response:
        return fake.post(session, url, **kwargs)

    monkeypatch.setattr(requests.Session, "get", get)
    monkeypatch.setattr(requests.Session, "post", post)
    return fake


def _recipe(**masked: Any) -> dict[str, Any]:
    return {
        "type": "MEILISEARCH",
        "required": {"auth_mode": "API_KEY" if masked else "NONE", "url": URL},
        **({"masked": masked} if masked else {}),
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }


def _request(sql: str, *, recipe: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 5000,
        "timeoutSeconds": 30,
        "sources": [{"alias": "search", "sourceId": "src-1", "recipe": recipe or _recipe()}],
        "tables": [
            {
                "source": "search",
                "schema": "indexes",
                "table": "movies",
                "location": {
                    "kind": "connector",
                    "schema": "indexes",
                    "table": "movies",
                    "columns": COLUMNS,
                },
            }
        ],
        **extra,
    }


def _rows(payload: dict[str, Any], result: Any) -> list[dict[str, Any]]:
    assert payload["status"] == "success", payload
    return pa.ipc.open_stream(result.arrow).read_all().to_pylist()


def test_an_index_reads_as_a_table_page_by_page(meili: FakeMeilisearch) -> None:
    payload, result = run_query(
        _request("SELECT genre, count(*) AS n FROM search.indexes.movies GROUP BY ALL ORDER BY 1")
    )
    assert _rows(payload, result) == [
        {"genre": "Drama", "n": 834},
        {"genre": "Horror", "n": 833},
        {"genre": "Sci-Fi", "n": 833},
    ]
    # Only the field the query reads, 1,000 documents a page.
    assert {tuple(b["fields"]) for b in meili.fetches} == {("genre",)}
    assert [b["offset"] for b in meili.fetches] == [0, 1000, 2000]
    assert payload["scans"][0]["requests"] == 3
    assert payload["scans"][0]["rows"] == 2500


def test_filters_on_filterable_attributes_are_sent_to_meilisearch(meili: FakeMeilisearch) -> None:
    payload, result = run_query(
        _request(
            "SELECT id FROM search.indexes.movies "
            "WHERE genre = 'Drama' AND year >= 2020 AND title <> 'x' ORDER BY id"
        )
    )
    expected = [m["id"] for m in MOVIES if m["genre"] == "Drama" and m["year"] >= 2020]
    assert [r["id"] for r in _rows(payload, result)] == expected
    (body,) = meili.fetches
    # title is not filterable: DuckDB filters it, Meilisearch does not.
    assert set(body["filter"].split(" AND ")) == {'genre = "Drama"', "year >= 2020"}
    assert payload["scans"][0]["rows"] == len(expected)


def test_strings_in_a_filter_are_escaped(meili: FakeMeilisearch) -> None:
    payload, result = run_query(
        _request("SELECT id FROM search.indexes.movies WHERE genre IN ('a\"b', 'c\\d')")
    )
    assert _rows(payload, result) == []
    assert meili.fetches[0]["filter"] == 'genre IN ["a\\"b", "c\\\\d"]'


def test_granular_filterable_attributes_are_read(meili: FakeMeilisearch) -> None:
    # Meilisearch 1.14: patterns and the operators each one allows.
    meili.filterable = [
        {"attributePatterns": ["gen*"], "features": {"filter": {"equality": True}}},
        {
            "attributePatterns": ["year"],
            "features": {"filter": {"equality": True, "comparison": False}},
        },
    ]
    payload, _ = run_query(
        _request("SELECT id FROM search.indexes.movies WHERE genre = 'Drama' AND year > 2020")
    )
    assert payload["status"] == "success", payload
    assert meili.fetches[0]["filter"] == 'genre = "Drama"'


def test_without_a_filterable_attribute_nothing_is_filtered_at_the_source(
    meili: FakeMeilisearch,
) -> None:
    meili.filterable = []
    payload, result = run_query(
        _request("SELECT count(*) AS n FROM search.indexes.movies WHERE genre = 'Horror'")
    )
    assert _rows(payload, result) == [{"n": 833}]
    assert all("filter" not in body for body in meili.fetches)


@pytest.mark.usefixtures("meili")
def test_nested_fields_read_as_json_and_lists() -> None:
    payload, result = run_query(
        _request("SELECT studio, tags, rating FROM search.indexes.movies WHERE id = 1")
    )
    assert _rows(payload, result) == [
        {"studio": '{"name": "Studio 1"}', "tags": ["a", "b"], "rating": 4.5}
    ]


def test_a_limit_reads_one_page(meili: FakeMeilisearch) -> None:
    payload, result = run_query(_request("SELECT title FROM search.indexes.movies LIMIT 3"))
    assert len(_rows(payload, result)) == 3
    assert len(meili.fetches) == 1


def test_the_api_key_authenticates_every_request(meili: FakeMeilisearch) -> None:
    payload, _ = run_query(
        _request("SELECT count(*) FROM search.indexes.movies", recipe=_recipe(api_key="k-123"))
    )
    assert payload["status"] == "success", payload
    assert meili.headers["Authorization"] == "Bearer k-123"


def test_an_http_error_is_reported_without_the_body(meili: FakeMeilisearch) -> None:
    meili.status = 403
    payload, _ = run_query(_request("SELECT count(*) FROM search.indexes.movies"))
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "source_unavailable"
    assert payload["error"]["message"] == (
        "Failed to read search.indexes.movies: Meilisearch at http://meili.test:7700/ "
        "returned HTTP 403."
    )


def test_an_unreachable_server_is_said_so(meili: FakeMeilisearch) -> None:
    meili.unreachable = True
    payload, _ = run_query(_request("SELECT count(*) FROM search.indexes.movies"))
    assert payload["error"]["message"] == (
        "Failed to read search.indexes.movies: Meilisearch at http://meili.test:7700/ "
        "is unreachable."
    )


def test_a_server_before_1_2_is_read_without_filters(meili: FakeMeilisearch) -> None:
    meili.fetch_missing = True
    payload, result = run_query(
        _request("SELECT count(*) AS n FROM search.indexes.movies WHERE genre = 'Horror'")
    )
    assert _rows(payload, result) == [{"n": 833}]
    pages = [params for url, params in meili.gets if url.endswith("/documents")]
    assert [p["offset"] for p in pages] == [0, 1000, 2000]
    assert "genre" in pages[0]["fields"].split(",")


# ── the scan records the columns ───────────────────────────────────────


async def test_the_scan_records_each_index_s_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(_self: requests.Session, url: str, **kwargs: Any) -> _Response:
        if url.endswith("/indexes"):
            return _Response({"results": [{"uid": "movies", "primaryKey": "id"}], "total": 1})
        if url.endswith("/indexes/movies/stats"):
            return _Response({"numberOfDocuments": len(MOVIES), "isIndexing": False})
        if url.endswith("/indexes/movies/documents"):
            return _Response({"results": MOVIES[: int(kwargs["params"]["limit"])]})
        raise AssertionError(url)

    monkeypatch.setattr(requests.Session, "get", fake_get)
    source = MeilisearchSource(_recipe())
    (asset,) = [a async for batch in source.extract_raw() for a in batch]
    assert asset.metadata["columns"] == COLUMNS
