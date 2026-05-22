from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.sqlite.source import SQLiteSource
from src.sources.tabular_utils import TableRef


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "SQLITE",
        "required": {"database_path": "/tmp/test.db"},
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


# ── Dummy cursor / connection stubs ────────────────────────────────────


class _DummyCursor:
    def __init__(self) -> None:
        self.description: list[tuple[str, Any, Any, Any, Any, Any, Any]] = []
        self._rows: list[tuple[Any, ...]] = []

    def execute(self, _query: str, _params: Any = None) -> None:
        self._rows = [(1,)]
        self.description = [("one", None, None, None, None, None, None)]

    def fetchone(self) -> tuple[int]:
        return (1,)

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._rows)

    def close(self) -> None:
        return None

    def __enter__(self) -> _DummyCursor:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None


class _DummyConnection:
    def cursor(self) -> _DummyCursor:
        return _DummyCursor()

    def execute(self, query: str, params: Any = None) -> _DummyCursor:
        cur = _DummyCursor()
        cur.execute(query, params)
        return cur

    def close(self) -> None:
        return None

    def __enter__(self) -> _DummyConnection:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        return None


# ── Tests ──────────────────────────────────────────────────────────────


def test_sqlite_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = SQLiteSource(_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["/tmp/test.db"])
    monkeypatch.setattr(source, "_connect", lambda _database=None: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_sqlite_resolve_databases_returns_path() -> None:
    source = SQLiteSource(_recipe(required={"database_path": "/data/my.db"}))
    assert source._resolve_databases() == ["/data/my.db"]


@pytest.mark.asyncio
async def test_sqlite_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SQLiteSource(_recipe())
    tables = [
        TableRef(database="/tmp/test.db", schema=None, table="users"),
        TableRef(database="/tmp/test.db", schema=None, table="orders"),
        TableRef(database="/tmp/test.db", schema=None, table="events"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_foreign_key_links",
        lambda _tables: {
            ("/tmp/test.db", "orders"): {("/tmp/test.db", "users")},
        },
    )

    original_batch_size = SQLiteSource.BATCH_SIZE
    SQLiteSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        SQLiteSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert batches[0][0].name == "/tmp/test.db.users"
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    users_hash = source.generate_hash_id("/tmp/test.db_#_users")
    assert users_hash in batches[0][1].links
    assert batches[1][0].name == "/tmp/test.db.events"


@pytest.mark.asyncio
async def test_sqlite_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SQLiteSource(_recipe())
    table_ref = TableRef(database="/tmp/test.db", schema=None, table="users")
    asset = source._table_to_asset(table_ref)
    source._table_lookup[asset.hash] = table_ref

    call_count = 0

    def _sample(_table_ref: TableRef) -> tuple[str, str]:
        nonlocal call_count
        call_count += 1
        return ('{"rows":[]}', "sample rows payload")

    monkeypatch.setattr(source, "_sample_table_rows", _sample)

    first = await source.fetch_content(asset.hash)
    second = await source.fetch_content(asset.hash)

    assert first == second
    assert first is not None
    assert "sample rows payload" in first[1]
    assert call_count == 1


def test_sqlite_latest_sampling_falls_back_to_random() -> None:
    source = SQLiteSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "fallback_to_random": True,
            },
        )
    )
    table_ref = TableRef(database="/tmp/test.db", schema=None, table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "ORDER BY RANDOM()" in query
    assert params == [10]


def test_sqlite_all_strategy_omits_limit() -> None:
    source = SQLiteSource(_recipe(sampling={"strategy": "ALL"}))
    table_ref = TableRef(database="/tmp/test.db", schema=None, table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "LIMIT" not in query
    assert params == []


def test_sqlite_hash_avoids_cross_database_collisions() -> None:
    source = SQLiteSource(_recipe())
    hash_a = source.generate_hash_id("/data/a.db_#_users")
    hash_b = source.generate_hash_id("/data/b.db_#_users")

    assert hash_a != hash_b


@pytest.mark.asyncio
async def test_sqlite_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SQLiteSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [TableRef(database="/tmp/test.db", schema=None, table="users")],
    )
    monkeypatch.setattr(source, "_collect_foreign_key_links", lambda _tables: {})

    processed_batches: list[int] = []

    class _Pipeline:
        async def process(self, batch: list[Any]) -> list[Any]:
            processed_batches.append(len(batch))
            return batch

        async def process_stream(self, batch: list[Any]) -> AsyncGenerator[Any, None]:
            processed_batches.append(len(batch))
            for item in batch:
                yield item

    monkeypatch.setattr(
        "src.pipeline.detector_pipeline.DetectorPipeline.from_recipe",
        lambda *_args, **_kwargs: _Pipeline(),
    )

    batches: list[list[Any]] = []
    async for batch in source.extract():
        batches.append(batch)

    assert [len(batch) for batch in batches] == [1]
    assert processed_batches == [1]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sqlite_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via LIMIT/OFFSET batches."""
    source = SQLiteSource(
        _recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    table_ref = TableRef(database="/tmp/test.db", schema=None, table="users")
    asset = source._table_to_asset(table_ref)

    all_rows: list[tuple[Any, ...]] = [(i, f"user{i}") for i in range(1, 13)]
    queries_issued: list[tuple[str, list[Any]]] = []

    class _BatchCursor:
        def __init__(self) -> None:
            self.description = [
                ("id", None, None, None, None, None, None),
                ("name", None, None, None, None, None, None),
            ]
            self._rows: list[tuple[Any, ...]] = []

        def execute(self, query: str, params: Any = None) -> None:
            p = list(params) if params else []
            queries_issued.append((query, p))
            batch_size = int(p[0]) if len(p) > 0 else len(all_rows)
            offset = int(p[1]) if len(p) > 1 else 0
            self._rows = all_rows[offset : offset + batch_size]

        def fetchall(self) -> list[tuple[Any, ...]]:
            return list(self._rows)

        def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
            return list(self._rows[:size])

        def close(self) -> None:
            return None

        def __enter__(self) -> _BatchCursor:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    class _BatchConnection:
        def cursor(self) -> _BatchCursor:
            return _BatchCursor()

        def execute(self, query: str, params: Any = None) -> _BatchCursor:
            cur = _BatchCursor()
            cur.execute(query, params)
            return cur

        def close(self) -> None:
            return None

        def __enter__(self) -> _BatchConnection:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(source, "_connect", lambda _db=None: _BatchConnection())
    monkeypatch.setattr(source, "_count_table_rows", lambda _ref: None)

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 2
    assert all("LIMIT" in q and "OFFSET" in q for q, _ in queries_issued)
    assert len(pages) == 12
    assert "user1" in pages[0]
    assert "user12" in pages[11]


def test_sqlite_table_ref_from_parts() -> None:
    source = SQLiteSource(_recipe())
    ref = source._table_ref_from_parts(["/tmp/test.db", "users"])
    assert ref is not None
    assert ref.database == "/tmp/test.db"
    assert ref.schema is None
    assert ref.table == "users"

    # Invalid: 3 parts
    assert source._table_ref_from_parts(["a", "b", "c"]) is None


def test_sqlite_quote_identifier() -> None:
    source = SQLiteSource(_recipe())
    assert source._quote_identifier("table") == '"table"'
    assert source._quote_identifier('my"table') == '"my""table"'


def test_sqlite_param_placeholder() -> None:
    source = SQLiteSource(_recipe())
    assert source._param_placeholder() == "?"


def test_sqlite_build_external_url() -> None:
    source = SQLiteSource(_recipe())
    ref = TableRef(database="/tmp/test.db", schema=None, table="users")
    url = source._build_external_url(ref)
    assert url == "sqlite:////tmp/test.db/users"
