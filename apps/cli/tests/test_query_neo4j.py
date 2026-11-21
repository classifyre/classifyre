"""Neo4j labels and relationship types as tables (docs/prd/QC-query-connectors.md §5.6, §5.7).

The driver is faked (the ``neo4j`` package is an optional group); the
Cypher it is handed is checked as text, and its rows go through the real
DuckDB session: projection, local filters, views and joins.
"""

from __future__ import annotations

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

pa = pytest.importorskip("pyarrow")

from src.query.connectors.arrow import Predicate  # noqa: E402
from src.query.connectors.neo4j import build_cypher  # noqa: E402
from src.sources.neo4j.source import Neo4jSource  # noqa: E402

PERSONS = [
    {"element_id": f"4:p:{i}", "id": i, "name": f"Person {i}", "country": ["AT", "DE"][i % 2]}
    for i in range(30)
]
MOVIES = [{"element_id": f"4:m:{i}", "id": i, "title": f"Movie {i}"} for i in range(10)]
RATED = [
    {
        "source_element_id": f"4:p:{i % 30}",
        "target_element_id": f"4:m:{i % 10}",
        "source_id": i % 30,
        "target_id": i % 10,
        "stars": i % 5 + 1,
        "source_label": "Person",
        "target_label": "Movie",
    }
    for i in range(120)
]
PERSON_COLUMNS = [
    {"name": "element_id", "type": "VARCHAR"},
    {"name": "id", "type": "BIGINT"},
    {"name": "name", "type": "VARCHAR"},
    {"name": "country", "type": "VARCHAR"},
]
MOVIE_COLUMNS = [
    {"name": "element_id", "type": "VARCHAR"},
    {"name": "id", "type": "BIGINT"},
    {"name": "title", "type": "VARCHAR"},
]
RATED_COLUMNS = [
    {"name": "source_element_id", "type": "VARCHAR"},
    {"name": "target_element_id", "type": "VARCHAR"},
    {"name": "source_id", "type": "BIGINT"},
    {"name": "target_id", "type": "BIGINT"},
    {"name": "stars", "type": "BIGINT"},
    {"name": "source_label", "type": "VARCHAR"},
    {"name": "target_label", "type": "VARCHAR"},
]


class ServiceUnavailable(Exception):  # noqa: N818 - the driver's name
    pass


class AuthError(Exception):  # the driver's name
    pass


class FakeQuery:
    def __init__(self, text: str, timeout: float | None = None) -> None:
        self.text = text
        self.timeout = timeout


class FakeNeo4j:
    """The parts of the ``neo4j`` module the source and the connector use."""

    TRUST_ALL_CERTIFICATES = "TRUST_ALL_CERTIFICATES"
    TRUST_SYSTEM_CA_SIGNED_CERTIFICATES = "TRUST_SYSTEM_CA_SIGNED_CERTIFICATES"
    Query = FakeQuery

    class exceptions:  # noqa: N801 - the module's name
        ServiceUnavailable = ServiceUnavailable
        AuthError = AuthError

    @staticmethod
    def basic_auth(username: str, password: str) -> tuple[str, str]:
        return (username, password)

    class GraphDatabase:
        driver_instance: Any = None

        @classmethod
        def driver(cls, _uri: str, **_kwargs: Any) -> Any:
            return cls.driver_instance


class FakeSession:
    def __init__(self, driver: FakeDriver, database: str) -> None:
        self.driver = driver
        self.database = database

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def run(self, query: Any, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        text = query.text if isinstance(query, FakeQuery) else query
        self.driver.queries.append((text, dict(params or {}), query, self.database))
        if self.driver.fail is not None:
            raise self.driver.fail
        for marker, rows in self.driver.tables.items():
            if marker in text:
                return [{"row": row} for row in rows]
        return []


class FakeDriver:
    tables: ClassVar[dict[str, list[dict[str, Any]]]] = {
        "(n:`Person`)": PERSONS,
        "(n:`Movie`)": MOVIES,
        "[r:`RATED`]": RATED,
    }

    def __init__(self) -> None:
        self.queries: list[tuple[str, dict[str, Any], Any, str]] = []
        self.fail: Exception | None = None

    def session(self, database: str, **_kwargs: Any) -> FakeSession:
        return FakeSession(self, database)

    def close(self) -> None:
        pass


@pytest.fixture()
def driver(monkeypatch: pytest.MonkeyPatch) -> FakeDriver:
    fake = FakeDriver()
    FakeNeo4j.GraphDatabase.driver_instance = fake
    monkeypatch.setattr("src.sources.neo4j.source.require_module", lambda **_: FakeNeo4j)
    return fake


def _table(table: str, schema: str, name: str, columns: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "source": "graph",
        "schema": schema,
        "table": table,
        "location": {
            "kind": "connector",
            "schema": schema,
            "table": name,
            "database": "neo4j",
            "columns": columns,
        },
    }


def _request(sql: str) -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 5000,
        "timeoutSeconds": 30,
        "sources": [
            {
                "alias": "graph",
                "sourceId": "src-1",
                "recipe": {
                    "type": "NEO4J",
                    "required": {"uri": "bolt://graph.test:7687", "database": "neo4j"},
                    "masked": {"username": "neo4j", "password": "s3cret"},
                    "sampling": {"strategy": "RANDOM"},
                },
            }
        ],
        "tables": [
            _table("person", "nodes", "Person", PERSON_COLUMNS),
            _table("movie", "nodes", "Movie", MOVIE_COLUMNS),
            _table("rated", "relationships", "RATED", RATED_COLUMNS),
        ],
    }


def _rows(payload: dict[str, Any], result: Any) -> list[dict[str, Any]]:
    assert payload["status"] == "success", payload
    return pa.ipc.open_stream(result.arrow).read_all().to_pylist()


# ── Cypher ─────────────────────────────────────────────────────────────


def test_a_node_table_reads_its_label_with_parameters_only() -> None:
    cypher, params = build_cypher(
        "nodes",
        "Person",
        ("name", "element_id"),
        (Predicate("country", "=", "AT"), Predicate("name", "in", ("a", "b"))),
    )
    # country is not among the columns read: not sent.
    assert cypher == (
        "MATCH (n:`Person`) WHERE n.`name` IN $p0 "
        "RETURN {`name`: n.`name`, `element_id`: elementId(n)} AS row"
    )
    assert params == {"p0": ["a", "b"]}


def test_a_relationship_table_reads_its_endpoints() -> None:
    cypher, params = build_cypher(
        "relationships",
        "RATED",
        ("source_id", "stars", "target_label"),
        (Predicate("stars", ">=", 4), Predicate("source_id", "!=", 3)),
    )
    assert cypher == (
        "MATCH (a)-[r:`RATED`]->(b) WHERE r.`stars` >= $p0 AND a.`id` <> $p1 "
        "RETURN {`source_id`: a.`id`, `stars`: r.`stars`, `target_label`: head(labels(b))} AS row"
    )
    assert params == {"p0": 4, "p1": 3}


def test_labels_and_properties_are_escaped() -> None:
    cypher, _ = build_cypher("nodes", "We`ird", ("a`b",), ())
    assert cypher == "MATCH (n:`We``ird`) RETURN {`a``b`: n.`a``b`} AS row"


# ── queries ────────────────────────────────────────────────────────────


def test_a_relationship_joins_its_node_tables(driver: FakeDriver) -> None:
    payload, result = run_query(
        _request(
            "SELECT m.title, count(*) AS fans FROM graph.relationships.rated r "
            "JOIN graph.nodes.person p ON p.id = r.source_id "
            "JOIN graph.nodes.movie m ON m.id = r.target_id "
            "WHERE p.country = 'DE' AND r.stars >= 4 GROUP BY ALL ORDER BY fans DESC, m.title LIMIT 3"
        )
    )
    fans: dict[str, int] = {}
    for edge in RATED:
        person = PERSONS[edge["source_id"]]
        if person["country"] == "DE" and edge["stars"] >= 4:
            title = MOVIES[edge["target_id"]]["title"]
            fans[title] = fans.get(title, 0) + 1
    expected = sorted(fans.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
    assert [(r["title"], r["fans"]) for r in _rows(payload, result)] == expected
    texts = {text for text, *_ in driver.queries}
    assert any("WHERE r.`stars` >= $p0" in t for t in texts)
    assert any("WHERE n.`country` = $p0" in t for t in texts)
    assert {database for *_, database in driver.queries} == {"neo4j"}
    assert {s["table"] for s in payload["scans"]} == {
        "graph.nodes.movie",
        "graph.nodes.person",
        "graph.relationships.rated",
    }


def test_every_statement_has_a_timeout_within_the_query_s(driver: FakeDriver) -> None:
    payload, _ = run_query(_request("SELECT count(*) FROM graph.nodes.person"))
    assert payload["status"] == "success", payload
    (_, _, query, _) = driver.queries[0]
    assert 0 < query.timeout <= 30


def test_an_unreachable_server_is_said_so(driver: FakeDriver) -> None:
    driver.fail = ServiceUnavailable("Couldn't connect to graph.test:7687 (secret detail)")
    payload, _ = run_query(_request("SELECT count(*) FROM graph.nodes.person"))
    assert payload["error"] == {
        "code": "source_unavailable",
        "message": "Failed to read graph.nodes.person: Neo4j at bolt://graph.test:7687/ "
        "is unreachable.",
    }


def test_a_refused_statement_names_the_code_only(driver: FakeDriver) -> None:
    error = RuntimeError("Invalid input 'x' near $p0 = 'owner@example.test'")
    error.code = "Neo.ClientError.Statement.SyntaxError"  # type: ignore[attr-defined]
    driver.fail = error
    payload, _ = run_query(_request("SELECT count(*) FROM graph.nodes.person"))
    assert payload["error"]["message"] == (
        "Failed to read graph.nodes.person: Neo4j at bolt://graph.test:7687/ "
        "refused the query (Neo.ClientError.Statement.SyntaxError)."
    )


# ── the scan records the tables ────────────────────────────────────────


class ScanSession:
    """Answers the scan's own statements."""

    def __enter__(self) -> ScanSession:
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def run(self, cypher: str, **_: Any) -> Any:
        if "db.labels" in cypher:
            return [{"label": "Person"}]
        if "db.relationshipTypes" in cypher:
            return [{"relationshipType": "RATED"}]
        if "RETURN properties(n) AS p" in cypher:
            return [{"p": {k: v for k, v in p.items() if k != "element_id"}} for p in PERSONS]
        if "RETURN properties(r) AS p" in cypher:
            return [
                {
                    "p": {"stars": e["stars"]},
                    "al": ["Person"],
                    "bl": ["Movie"],
                    "aid": e["source_id"],
                    "bid": e["target_id"],
                }
                for e in RATED[:100]
            ]
        if "count(r)" in cypher:
            return _Single({"c": len(RATED)})
        return _Single(None) if "count(n)" in cypher else []


class _Single(list):  # type: ignore[type-arg]
    def __init__(self, record: Any) -> None:
        super().__init__()
        self.record = record

    def single(self) -> Any:
        return self.record


class ScanDriver:
    def session(self, **_: Any) -> ScanSession:
        return ScanSession()

    def close(self) -> None:
        pass


async def test_the_scan_records_label_and_relationship_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.sources.neo4j.source.require_module", lambda **_: FakeNeo4j)
    source = Neo4jSource(
        {
            "type": "NEO4J",
            "required": {"uri": "bolt://graph.test:7687", "database": "neo4j"},
            "masked": {"username": "neo4j", "password": "s3cret"},
            "optional": {"scope": {"include_relationships": True}},
            "sampling": {"strategy": "RANDOM"},
        }
    )
    source._driver_instance = ScanDriver()
    assets = [a async for batch in source.extract_raw() for a in batch]
    by_kind = {a.asset_kind: a for a in assets}
    assert by_kind["label"].metadata["columns"] == PERSON_COLUMNS
    rated = by_kind["relationship"]
    assert rated.name == "neo4j:[RATED]"
    assert rated.metadata["relationship_type"] == "RATED"
    assert rated.metadata["relationship_count"] == len(RATED)
    assert rated.metadata["source_labels"] == ["Person"]
    assert rated.metadata["target_labels"] == ["Movie"]
    assert rated.metadata["columns"] == RATED_COLUMNS
    # Linked to the label it starts from (Movie was not scanned here).
    assert rated.links == [by_kind["label"].hash]
    # A relationship type has no node content to scan for findings.
    assert await source.fetch_content(rated.hash) is None
