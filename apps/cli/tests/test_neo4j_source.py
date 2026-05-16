from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from src.sources.neo4j.source import LabelRef, Neo4jSource


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "NEO4J",
        "required": {
            "uri": "bolt://localhost:7687",
            "database": "neo4j",
        },
        "masked": {
            "username": "neo4j",
            "password": "secret",
        },
        "optional": {
            "scope": {
                "include_relationships": True,
            },
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


class _FakeNeo4j:
    """Minimal neo4j module stub."""

    TRUST_ALL_CERTIFICATES = "TRUST_ALL_CERTIFICATES"
    TRUST_SYSTEM_CA_SIGNED_CERTIFICATES = "TRUST_SYSTEM_CA_SIGNED_CERTIFICATES"

    @staticmethod
    def basic_auth(username: str, password: str) -> tuple[str, str]:
        return (username, password)

    class GraphDatabase:
        _driver: Any = None

        @classmethod
        def driver(cls, uri: str, auth: Any = None, **kwargs: Any) -> Any:
            if cls._driver is None:
                raise AssertionError("GraphDatabase.driver must be set by test")
            return cls._driver


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.neo4j.source.require_module",
        lambda **_kwargs: _FakeNeo4j(),
    )


def _make_driver(labels: list[str], nodes_by_label: dict[str, list[dict[str, Any]]] | None = None) -> MagicMock:
    """Build a mock neo4j driver that returns specified labels and nodes."""

    def _make_session_cm(label_results: list[str], nodes: dict[str, list[dict[str, Any]]]) -> Any:
        class _FakeResult:
            def __init__(self, records: list[dict[str, Any]]) -> None:
                self._records = records

            def __iter__(self):
                return iter(self._records)

        class _FakeSession:
            def __init__(self) -> None:
                self._queries: list[str] = []

            def run(self, cypher: str, **kwargs: Any) -> _FakeResult:
                self._queries.append(cypher)
                # Route by query content
                if "db.labels" in cypher:
                    return _FakeResult([{"label": lbl} for lbl in label_results])
                if "RETURN DISTINCT target_label" in cypher:
                    return _FakeResult([])  # no relationships by default
                # Node fetch: extract label from backtick-quoted MATCH
                for lbl, node_list in (nodes or {}).items():
                    if f"`{lbl}`" in cypher or f":{lbl})" in cypher:
                        # Parse SKIP/LIMIT if present
                        skip = 0
                        limit = len(node_list)
                        parts = cypher.upper().split()
                        if "SKIP" in parts:
                            idx = parts.index("SKIP")
                            skip = int(parts[idx + 1])
                        if "LIMIT" in parts:
                            idx = parts.index("LIMIT")
                            limit = int(parts[idx + 1])
                        sliced = node_list[skip: skip + limit]
                        return _FakeResult([{"n": p} for p in sliced])
                return _FakeResult([])

            def __enter__(self) -> _FakeSession:
                return self

            def __exit__(self, *args: Any) -> None:
                pass

        class _FakeDriver:
            def __init__(self) -> None:
                self._sessions: list[_FakeSession] = []
                self._closed = False

            def session(self, **kwargs: Any) -> _FakeSession:
                s = _FakeSession()
                self._sessions.append(s)
                return s

            def verify_connectivity(self) -> None:
                pass

            def close(self) -> None:
                self._closed = True

        return _FakeDriver()

    return _make_session_cm(labels, nodes_by_label or {})


def _inject_driver(source: Neo4jSource, driver: Any) -> None:
    source._driver_instance = driver


# ---------------------------------------------------------------------------
# Connection tests
# ---------------------------------------------------------------------------

def test_neo4j_connection_success() -> None:
    source = Neo4jSource(_recipe())
    driver = _make_driver(["Person", "Organization"])
    _inject_driver(source, driver)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "bolt://localhost:7687" in result["message"]
    assert "2" in result["message"]


def test_neo4j_connection_failure() -> None:
    source = Neo4jSource(_recipe())

    bad_driver = MagicMock()
    bad_driver.verify_connectivity.side_effect = RuntimeError("connection refused")
    _inject_driver(source, bad_driver)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "connection refused" in result["message"]


# ---------------------------------------------------------------------------
# Label discovery / extraction tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_label_discovery() -> None:
    source = Neo4jSource(_recipe(
        optional={"scope": {"include_relationships": False}},
    ))
    driver = _make_driver(["Person", "Transaction"])
    _inject_driver(source, driver)

    batches: list[list[Any]] = []
    async for batch in source.extract_raw():
        batches.append(batch)

    all_assets = [a for b in batches for a in b]
    assert len(all_assets) == 2
    names = {a.name for a in all_assets}
    assert names == {"neo4j:Person", "neo4j:Transaction"}


@pytest.mark.asyncio
async def test_neo4j_exclude_labels() -> None:
    source = Neo4jSource(_recipe(
        optional={
            "scope": {
                "exclude_labels": ["Transaction"],
                "include_relationships": False,
            }
        },
    ))
    driver = _make_driver(["Person", "Transaction", "Organization"])
    _inject_driver(source, driver)

    batches: list[list[Any]] = []
    async for batch in source.extract_raw():
        batches.append(batch)

    names = {a.name for b in batches for a in b}
    assert "neo4j:Transaction" not in names
    assert "neo4j:Person" in names
    assert "neo4j:Organization" in names


# ---------------------------------------------------------------------------
# Relationship link tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_relationship_links() -> None:
    """Relationships from Person→Transaction should populate links on the Person asset."""

    class _RelDriver:
        def session(self, **kwargs: Any) -> Any:
            return self._SessionCM(self._labels, self._related_by_label)

        def __init__(self, labels: list[str], related_by_label: dict[str, list[str]]) -> None:
            self._labels = labels
            self._related_by_label = related_by_label
            self._closed = False

        def verify_connectivity(self) -> None:
            pass

        def close(self) -> None:
            self._closed = True

        class _SessionCM:
            def __init__(self, labels: list[str], related_by_label: dict[str, list[str]]) -> None:
                self._labels = labels
                self._related_by_label = related_by_label

            def run(self, cypher: str, **kwargs: Any) -> Any:
                class _R:
                    def __init__(self, rows: list[dict[str, Any]]) -> None:
                        self._rows = rows
                    def __iter__(self):
                        return iter(self._rows)

                if "db.labels" in cypher:
                    return _R([{"label": lbl} for lbl in self._labels])
                if "RETURN DISTINCT target_label" in cypher:
                    for lbl, targets in self._related_by_label.items():
                        if f"`{lbl}`" in cypher:
                            return _R([{"target_label": t} for t in targets])
                    return _R([])
                return _R([])

            def __enter__(self) -> _RelDriver._SessionCM:
                return self

            def __exit__(self, *args: Any) -> None:
                pass

    driver = _RelDriver(
        labels=["Person", "Transaction"],
        related_by_label={"Person": ["Transaction"]},
    )

    source = Neo4jSource(_recipe(optional={"scope": {"include_relationships": True}}))
    _inject_driver(source, driver)

    batches: list[list[Any]] = []
    async for batch in source.extract_raw():
        batches.append(batch)

    all_assets = [a for b in batches for a in b]
    person_asset = next(a for a in all_assets if "Person" in a.name)
    transaction_asset = next(a for a in all_assets if "Transaction" in a.name)

    assert transaction_asset.hash in person_asset.links


# ---------------------------------------------------------------------------
# Content fetch tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_fetch_content() -> None:
    source = Neo4jSource(_recipe())
    nodes = [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]
    driver = _make_driver(["Person"], nodes_by_label={"Person": nodes})
    _inject_driver(source, driver)

    ref = LabelRef(label="Person", database="neo4j")
    asset = source._label_to_asset(ref, links=[])
    source._label_lookup[asset.hash] = ref

    content = await source.fetch_content(asset.hash)
    assert content is not None
    raw, text = content
    assert "Person" in text
    assert "Alice" in text or "Alice" in raw


# ---------------------------------------------------------------------------
# Batching test (SKILL mandatory: _fetch_all_nodes_batched)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neo4j_fetch_content_pages_batches_for_all_strategy() -> None:
    """
    With content_batch_size=10 and 12 nodes, exactly 2 Cypher queries should
    be issued each containing SKIP and LIMIT (pages: 0–9, then 10–11).
    """
    source = Neo4jSource(_recipe(
        sampling={"strategy": "ALL", "rows_per_page": 10},
        optional={"scope": {"include_relationships": False}},
    ))

    nodes = [{"id": i, "val": f"v{i}"} for i in range(12)]
    driver = _make_driver(["Person"], nodes_by_label={"Person": nodes})
    _inject_driver(source, driver)

    ref = LabelRef(label="Person", database="neo4j")
    asset = source._label_to_asset(ref, links=[])
    source._label_lookup[asset.hash] = ref

    pages: list[tuple[str, str]] = []
    async for page in source.fetch_content_pages(asset.hash):
        pages.append(page)

    # 12 nodes, one per page yield
    assert len(pages) == 12

    # Collect all MATCH queries from sessions
    node_queries = [
        q
        for session in driver._sessions
        for q in session._queries
        if "MATCH" in q and "SKIP" in q.upper() and "LIMIT" in q.upper()
    ]

    # Exactly 2 paginated fetch calls (0–9, then 10–11)
    assert len(node_queries) == 2, f"Expected 2 paginated queries, got {len(node_queries)}: {node_queries}"

    skips = []
    for q in node_queries:
        parts = q.upper().split()
        skip_idx = parts.index("SKIP")
        skips.append(int(parts[skip_idx + 1]))

    assert skips[0] == 0
    assert skips[1] == 10


# ---------------------------------------------------------------------------
# Cleanup / abort tests
# ---------------------------------------------------------------------------

def test_neo4j_cleanup_closes_driver() -> None:
    source = Neo4jSource(_recipe())
    driver = _make_driver([])
    _inject_driver(source, driver)

    # Access driver to ensure it's set
    _ = source._driver()
    source.cleanup()

    assert driver._closed is True
    assert source._driver_instance is None


@pytest.mark.asyncio
async def test_neo4j_abort_stops_extraction() -> None:
    source = Neo4jSource(_recipe(optional={"scope": {"include_relationships": False}}))
    driver = _make_driver(["Person", "Organization", "Transaction"])
    _inject_driver(source, driver)

    source._aborted = True

    batches: list[list[Any]] = []
    async for batch in source.extract_raw():
        batches.append(batch)

    assert batches == []
