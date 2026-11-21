"""Connector tables: sources read live through their API (docs/prd/QC-query-connectors.md §5.3).

A connector (Meilisearch, Neo4j, …) is a Python object DuckDB scans as an
Arrow dataset. DuckDB itself decides what it needs: the columns it reads and
the filters it can push are handed to the connector's ``scan``; whatever the
connector does with them, DuckDB's answer stays exact, because every batch is
filtered again before DuckDB sees it. These tests use an in-memory connector
next to a file table, through the same ``run_query`` the job and the worker run.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

import pytest

from src.query.runner import ensure_dependencies, run_query
from src.utils.uv_sync import auto_install_enabled, sync_group

if auto_install_enabled():
    for _group in ("file-processing", "lineage"):
        sync_group(_group)
try:
    ensure_dependencies()
except Exception as exc:  # auto-install off and the groups absent
    pytest.skip(f"query dependencies unavailable: {exc}", allow_module_level=True)

duckdb = pytest.importorskip("duckdb")
pa = pytest.importorskip("pyarrow")

from src.query import bindings  # noqa: E402
from src.query.connectors.arrow import (  # noqa: E402
    ArrowConnector,
    ConnectorError,
    Predicate,
    ScanRequest,
    predicates_of,
)
from src.query.connectors.base import TableLocation  # noqa: E402

MOVIES = [
    {
        "id": i,
        "title": f"Movie {i}",
        "genre": ["Drama", "Horror", "Sci-Fi"][i % 3],
        "year": 2000 + i % 25,
        "email": f"owner{i}@example.test",
        "studio": {"name": f"Studio {i % 4}"},
        "tags": ["a", "b"] if i % 2 else ["c"],
    }
    for i in range(300)
]
COLUMNS = [
    {"name": "id", "type": "BIGINT"},
    {"name": "title", "type": "VARCHAR"},
    {"name": "genre", "type": "VARCHAR"},
    {"name": "year", "type": "BIGINT"},
    {"name": "email", "type": "VARCHAR"},
    {"name": "studio", "type": "JSON"},
    {"name": "tags", "type": "VARCHAR[]"},
]


class FakeConnector(ArrowConnector):
    """Pages over :data:`MOVIES`; records what it was asked."""

    rows: ClassVar[list[dict[str, Any]]] = MOVIES
    page_size = 50
    honour_filters = True
    requests: ClassVar[list[ScanRequest]] = []
    pages_read = 0
    fail_after: int | None = None

    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        FakeConnector.requests.append(request)
        if self.honour_filters:
            request.sent(request.predicates)
        rows = [r for r in self.rows if not self.honour_filters or _matches(r, request.predicates)]
        for start in range(0, len(rows), self.page_size):
            if self.fail_after is not None and FakeConnector.pages_read >= self.fail_after:
                raise ConnectorError("Fake source example returned HTTP 503")
            FakeConnector.pages_read += 1
            request.stats.requests += 1
            yield rows[start : start + self.page_size]


def _matches(row: dict[str, Any], predicates: tuple[Predicate, ...]) -> bool:
    ops = {
        "=": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
        "<": lambda a, b: a < b,
        "<=": lambda a, b: a <= b,
        ">": lambda a, b: a > b,
        ">=": lambda a, b: a >= b,
        "in": lambda a, b: a in b,
    }
    return all(ops[p.op](row.get(p.column), p.value) for p in predicates)


@pytest.fixture(autouse=True)
def fake_connector(monkeypatch: pytest.MonkeyPatch) -> None:
    original = bindings.binding_class

    def binding_class(source_type: str) -> Any:
        return FakeConnector if source_type == "FAKE_SEARCH" else original(source_type)

    monkeypatch.setattr(bindings, "binding_class", binding_class)
    FakeConnector.requests = []
    FakeConnector.pages_read = 0
    FakeConnector.honour_filters = True
    FakeConnector.fail_after = None
    FakeConnector.rows = MOVIES


@pytest.fixture()
def folder(tmp_path: Path) -> Path:
    conn = duckdb.connect()
    conn.execute(
        "COPY (SELECT range AS oid, range % 300 AS movie_id, range * 2 AS amount "
        f"FROM range(900)) TO '{tmp_path / 'orders.parquet'}'"
    )
    conn.close()
    return tmp_path


def _request(
    folder: Path, sql: str, *, movies: dict[str, Any] | None = None, **extra: Any
) -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 1000,
        "timeoutSeconds": 30,
        "sources": [
            {
                "alias": "files",
                "sourceId": "src-1",
                "recipe": {"type": "LOCAL_FOLDER", "required": {"path": str(folder)}},
            },
            {
                "alias": "search",
                "sourceId": "src-2",
                "recipe": {"type": "FAKE_SEARCH", "required": {"url": "http://search.test"}},
            },
        ],
        "tables": [
            {
                "source": "files",
                "schema": "local",
                "table": "orders",
                "location": {"kind": "file", "format": "parquet", "objectKey": "orders.parquet"},
            },
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
                **(movies or {}),
            },
        ],
        **extra,
    }


def _rows(payload: dict[str, Any], result: Any) -> list[dict[str, Any]]:
    assert payload["status"] == "success", payload
    return pa.ipc.open_stream(result.arrow).read_all().to_pylist()


def test_a_connector_table_joins_a_file_table(folder: Path) -> None:
    payload, result = run_query(
        _request(
            folder,
            "SELECT m.genre, count(*) AS orders FROM files.local.orders o "
            "JOIN search.indexes.movies m ON m.id = o.movie_id GROUP BY ALL ORDER BY 1",
        )
    )
    assert _rows(payload, result) == [
        {"genre": "Drama", "orders": 300},
        {"genre": "Horror", "orders": 300},
        {"genre": "Sci-Fi", "orders": 300},
    ]
    assert payload["tables"] == ["files.local.orders", "search.indexes.movies"]
    # Only the columns the query reads are asked for.
    assert FakeConnector.requests[0].columns == ("id", "genre")
    (scan,) = payload["scans"]
    assert scan["table"] == "search.indexes.movies"
    assert scan["requests"] == 6
    assert scan["rows"] == 300


def test_filters_duckdb_pushes_reach_the_connector(folder: Path) -> None:
    payload, result = run_query(
        _request(
            folder,
            "SELECT id FROM search.indexes.movies "
            "WHERE genre IN ('Drama', 'Sci-Fi') AND year >= 2020 AND title <> 'x' ORDER BY id",
        )
    )
    rows = _rows(payload, result)
    expected = [m["id"] for m in MOVIES if m["genre"] in ("Drama", "Sci-Fi") and m["year"] >= 2020]
    assert [r["id"] for r in rows] == expected
    pushed = set(FakeConnector.requests[0].predicates)
    assert Predicate("year", ">=", 2020) in pushed
    assert Predicate("genre", "in", ("Drama", "Sci-Fi")) in pushed
    assert payload["scans"][0]["rows"] == len(expected)
    assert "year >= 2020" in payload["scans"][0]["pushed"]


def test_the_answer_is_exact_when_the_connector_ignores_filters(folder: Path) -> None:
    FakeConnector.honour_filters = False
    payload, result = run_query(
        _request(folder, "SELECT count(*) AS n FROM search.indexes.movies WHERE genre = 'Horror'")
    )
    assert _rows(payload, result) == [{"n": 100}]


def test_a_limit_stops_reading_pages(folder: Path) -> None:
    payload, result = run_query(_request(folder, "SELECT id FROM search.indexes.movies LIMIT 5"))
    assert len(_rows(payload, result)) == 5
    assert FakeConnector.pages_read == 1


def test_a_masked_column_is_never_filtered_at_the_source(folder: Path) -> None:
    payload, result = run_query(
        _request(
            folder,
            "SELECT count(*) AS n FROM search.indexes.movies WHERE email = 'owner1@example.test'",
            movies={
                "columns": [{"column": "email", "action": "mask", "mask": "hash"}],
                "knownColumns": [c["name"] for c in COLUMNS],
            },
            maskSalt="salt",
        )
    )
    assert _rows(payload, result) == [{"n": 0}]
    assert all(p.column != "email" for r in FakeConnector.requests for p in r.predicates)


def test_a_row_filter_is_pushed_and_still_holds(folder: Path) -> None:
    FakeConnector.honour_filters = False
    payload, result = run_query(
        _request(
            folder,
            "SELECT DISTINCT genre FROM search.indexes.movies",
            movies={"rows": {"anyOf": [[{"column": "genre", "op": "in", "values": ["Drama"]}]]}},
        )
    )
    assert _rows(payload, result) == [{"genre": "Drama"}]
    assert Predicate("genre", "in", ("Drama",)) in FakeConnector.requests[0].predicates or (
        Predicate("genre", "=", "Drama") in FakeConnector.requests[0].predicates
    )


def test_nested_values_read_as_json_text_and_lists(folder: Path) -> None:
    payload, result = run_query(
        _request(folder, "SELECT studio, tags FROM search.indexes.movies WHERE id = 1")
    )
    assert _rows(payload, result) == [{"studio": '{"name": "Studio 1"}', "tags": ["a", "b"]}]


def test_a_self_join_reads_the_table_twice(folder: Path) -> None:
    payload, _ = run_query(
        _request(
            folder,
            "SELECT count(*) AS n FROM search.indexes.movies a "
            "JOIN search.indexes.movies b ON a.genre = b.genre AND a.id < b.id "
            "WHERE a.year = 2020",
        )
    )
    assert payload["status"] == "success", payload
    assert len(FakeConnector.requests) == 2
    assert payload["scans"][0]["scans"] == 2


def test_more_rows_than_a_connector_may_read_is_a_refusal_not_a_cut(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CLASSIFYRE_QUERY_CONNECTOR_MAX_ROWS", "120")
    payload, _ = run_query(_request(folder, "SELECT count(*) FROM search.indexes.movies"))
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "connector_limit"
    assert "search.indexes.movies" in payload["error"]["message"]
    assert "120" in payload["error"]["message"]


def test_a_source_error_is_reported_as_the_connector_said_it(folder: Path) -> None:
    FakeConnector.fail_after = 2
    payload, _ = run_query(_request(folder, "SELECT count(*) FROM search.indexes.movies"))
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "source_unavailable"
    assert payload["error"]["message"] == (
        "Failed to read search.indexes.movies: Fake source example returned HTTP 503"
    )


def test_a_value_of_another_type_than_recorded_names_the_column(folder: Path) -> None:
    FakeConnector.rows = [{"id": "not-a-number", "genre": "Drama"}]
    payload, _ = run_query(_request(folder, "SELECT id FROM search.indexes.movies"))
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "source_unavailable"
    assert "id" in payload["error"]["message"]
    assert "not-a-number" not in payload["error"]["message"]
    assert "scan the source again" in payload["error"]["message"]


def test_every_request_gets_at_most_the_time_left(folder: Path) -> None:
    payload, _ = run_query(_request(folder, "SELECT count(*) FROM search.indexes.movies"))
    assert payload["status"] == "success", payload
    request = FakeConnector.requests[0]
    assert 0 < request.timeout(600) <= 30


# ── the filter DuckDB hands over, as predicates ────────────────────────


def _schema() -> Any:
    return pa.schema(
        [
            ("id", pa.int64()),
            ("genre", pa.string()),
            ("score", pa.float64()),
            ("seen", pa.bool_()),
            ("day", pa.date32()),
            ("at", pa.timestamp("us")),
        ]
    )


def _pushed(sql: str) -> tuple[tuple[Predicate, ...], bool]:
    seen: list[Any] = []
    schema = _schema()

    import pyarrow.dataset as ds

    class Probe(ds.Dataset):  # type: ignore[misc]
        @property
        def schema(self) -> Any:
            return schema

        def scanner(self, columns: Any = None, filter: Any = None, **_: Any) -> Any:
            seen.append(filter)
            return ds.dataset(schema.empty_table()).scanner(columns=columns)

    conn = duckdb.connect()
    conn.register("t", Probe.__new__(Probe))
    conn.sql(sql).fetchall()
    return predicates_of(seen[0], schema)


@pytest.mark.parametrize(
    ("where", "expected", "complete"),
    [
        ("id = 3", (Predicate("id", "=", 3),), True),
        ("genre = 'a\"b\\c''d'", (Predicate("genre", "=", "a\"b\\c'd"),), True),
        (
            "score = 2.5::DOUBLE AND seen = true",
            (Predicate("score", "=", 2.5), Predicate("seen", "=", True)),
            True,
        ),
        ("id BETWEEN 1 AND 3", (Predicate("id", ">=", 1), Predicate("id", "<=", 3)), True),
        ("genre IN ('x', 'y')", (Predicate("genre", "in", ("x", "y")),), True),
        (
            "genre IN ('a\"b', 'c\\d', 'e''f')",
            (Predicate("genre", "in", ('a"b', "c\\d", "e'f")),),
            True,
        ),
        # Printed, this value set reads as four values; it holds three.
        (
            "genre IN ('a\",\n  \"b', 'q', 'r')",
            (Predicate("genre", "in", ('a",\n  "b', "q", "r")),),
            True,
        ),
        ("day >= DATE '2020-01-02'", None, True),
        ("id = 3 OR genre = 'x'", (), False),
        ("id = 3 AND (genre = 'x' OR genre = 'y')", (Predicate("id", "=", 3),), False),
        ("genre IS NOT NULL", (), False),
    ],
)
def test_pushed_filters_become_predicates(
    where: str, expected: tuple[Predicate, ...] | None, complete: bool
) -> None:
    predicates, fully = _pushed(f"SELECT id FROM t WHERE {where}")
    if expected is None:
        import datetime

        assert predicates == (Predicate("day", ">=", datetime.date(2020, 1, 2)),)
    else:
        assert set(predicates) == set(expected)
    assert fully is complete


def test_no_filter_means_no_predicates() -> None:
    assert predicates_of(None, _schema()) == ((), True)


def test_a_value_shaped_like_a_value_set_separator_still_reaches_its_row(folder: Path) -> None:
    # The reviewer's case (QC review c1): read from the printed filter, the
    # set became four values and the row holding the first never arrived.
    FakeConnector.rows = [{"id": 1, "genre": 'a",\n  "b'}, {"id": 2, "genre": "q"}]
    payload, result = run_query(
        _request(
            folder,
            "SELECT id FROM search.indexes.movies WHERE genre IN ('a\",\n  \"b', 'q', 'r') "
            "ORDER BY id",
        )
    )
    assert [r["id"] for r in _rows(payload, result)] == [1, 2]


def test_a_row_filter_on_a_masked_column_is_not_sent_to_the_source(folder: Path) -> None:
    # The view filters on the raw value and DuckDB pushes that filter; the
    # column is masked for the reader, so it stays here (QC review c7). The
    # mask names the column in another case, as a steward may.
    payload, result = run_query(
        _request(
            folder,
            "SELECT count(*) AS n FROM search.indexes.movies",
            movies={
                "columns": [{"column": "GENRE", "action": "mask", "mask": "redact"}],
                "knownColumns": [c["name"] for c in COLUMNS],
                "rows": {"anyOf": [[{"column": "genre", "op": "in", "values": ["Drama"]}]]},
            },
        )
    )
    assert _rows(payload, result) == [{"n": 100}]
    assert FakeConnector.requests, "the table was read"
    assert all(p.column != "genre" for r in FakeConnector.requests for p in r.predicates)


def test_a_shared_dataset_s_reads_are_reported_without_its_filters(folder: Path) -> None:
    # The dataset's input carries its owning group's row filter: the reader
    # sees what the read cost, under the dataset's name, never those values
    # (QC review c5, DQ §5.10).
    request = _request(folder, "SELECT count(*) AS n FROM shared.films.drama")
    movies = request["tables"][1]
    request["tables"].append(
        {
            "source": "shared",
            "schema": "films",
            "table": "drama",
            "dataset": {
                "sql": "SELECT id, genre FROM search.indexes.movies WHERE year >= 2010",
                "inputs": [
                    {
                        **movies,
                        "rows": {"anyOf": [[{"column": "genre", "op": "in", "values": ["Drama"]}]]},
                    }
                ],
            },
        }
    )
    payload, result = run_query(request)
    assert _rows(payload, result) == [
        {"n": sum(1 for m in MOVIES if m["genre"] == "Drama" and m["year"] >= 2010)}
    ]
    assert [s["table"] for s in payload["scans"]] == ["shared.films.drama"]
    assert payload["scans"][0]["pushed"] == []
    assert payload["scans"][0]["requests"] > 0


def test_only_conditions_the_connector_sent_are_reported(folder: Path) -> None:
    FakeConnector.honour_filters = False
    payload, _ = run_query(
        _request(folder, "SELECT count(*) FROM search.indexes.movies WHERE year >= 2020")
    )
    assert payload["status"] == "success", payload
    assert payload["scans"][0]["pushed"] == []


def test_the_row_limit_holds_per_scan(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Two scans of 300 rows each under a limit of 350: each is within it.
    monkeypatch.setenv("CLASSIFYRE_QUERY_CONNECTOR_MAX_ROWS", "350")
    payload, _ = run_query(
        _request(
            folder,
            "SELECT count(*) FROM search.indexes.movies a "
            "JOIN search.indexes.movies b ON a.id = b.id",
        )
    )
    assert payload["status"] == "success", payload
    assert payload["scans"][0]["rows"] == 600
