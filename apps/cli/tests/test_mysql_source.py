from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.mysql.source import MySQLSource, TableRef


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "MYSQL",
        "required": {"host": "localhost", "port": 3306},
        "masked": {
            "username": "root",
            "password": "example",
        },
        "optional": {
            "scope": {"database": "app_db"},
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePyMySQL:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.mysql.source.require_module",
        lambda **_kwargs: _FakePyMySQL(),
    )


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

    def __enter__(self) -> _DummyCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _DummyConnection:
    def cursor(self) -> _DummyCursor:
        return _DummyCursor()

    def autocommit(self, _enabled: bool) -> None:
        return None

    def close(self) -> None:
        return None

    def __enter__(self) -> _DummyConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_mysql_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = MySQLSource(_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["app_db"])
    monkeypatch.setattr(source, "_connect", lambda _database=None: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_mysql_requires_database_when_not_include_all() -> None:
    source = MySQLSource(
        _recipe(
            optional={
                "scope": {
                    "database": "",
                    "include_all_databases": False,
                }
            }
        )
    )

    with pytest.raises(ValueError, match=r"requires optional\.scope\.database"):
        source._resolve_databases()


@pytest.mark.asyncio
async def test_mysql_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MySQLSource(_recipe())
    tables = [
        TableRef(database="app_db", table="users"),
        TableRef(database="app_db", table="orders"),
        TableRef(database="analytics", table="events"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_foreign_key_links",
        lambda _tables: {
            ("app_db", "orders"): {("app_db", "users")},
        },
    )

    original_batch_size = MySQLSource.BATCH_SIZE
    MySQLSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        MySQLSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert batches[0][0].name == "app_db.users"
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    users_hash = source.generate_hash_id("app_db_#_users")
    assert users_hash in batches[0][1].links
    assert batches[1][0].name == "analytics.events"


@pytest.mark.asyncio
async def test_mysql_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MySQLSource(_recipe())
    table_ref = TableRef(database="app_db", table="users")
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


def test_mysql_latest_sampling_falls_back_to_random() -> None:
    source = MySQLSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "fallback_to_random": True,
            }
        )
    )
    table_ref = TableRef(database="app_db", table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "ORDER BY RAND()" in query
    assert params == [10]


@pytest.mark.asyncio
async def test_mysql_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via LIMIT/OFFSET batches."""
    source = MySQLSource(
        _recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    table_ref = TableRef(database="app_db", table="users")
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

        def __enter__(self) -> _BatchCursor:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    class _BatchConnection:
        def cursor(self) -> _BatchCursor:
            return _BatchCursor()

        def autocommit(self, _enabled: bool) -> None:
            return None

        def close(self) -> None:
            return None

        def __enter__(self) -> _BatchConnection:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(source, "_connect", lambda _db=None: _BatchConnection())

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 3
    assert "COUNT" in queries_issued[0][0]
    assert all("LIMIT" in q and "OFFSET" in q for q, _ in queries_issued[1:])
    assert len(pages) == 2
    assert "user1" in pages[0]
    assert "user12" in pages[1]


def test_mysql_sample_table_rows_no_batching_for_random_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=RANDOM, a single LIMIT query is used — no OFFSET batching."""
    source = MySQLSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    table_ref = TableRef(database="app_db", table="users")

    queries_issued: list[str] = []

    class _SingleCursor:
        def __init__(self) -> None:
            self.description = [("id", None, None, None, None, None, None)]
            self._rows: list[tuple[Any, ...]] = [(1,), (2,)]

        def execute(self, query: str, params: Any = None) -> None:
            queries_issued.append(query)

        def fetchall(self) -> list[tuple[Any, ...]]:
            return list(self._rows)

        def __enter__(self) -> _SingleCursor:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    class _SingleConnection:
        def cursor(self) -> _SingleCursor:
            return _SingleCursor()

        def autocommit(self, _enabled: bool) -> None:
            return None

        def close(self) -> None:
            return None

        def __enter__(self) -> _SingleConnection:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id"])
    monkeypatch.setattr(source, "_connect", lambda _db=None: _SingleConnection())

    result = source._sample_table_rows(table_ref)

    assert result is not None
    assert len(queries_issued) == 1
    assert "OFFSET" not in queries_issued[0]
    assert "LIMIT" in queries_issued[0]


def test_mysql_hash_avoids_cross_database_collisions() -> None:
    source = MySQLSource(_recipe())
    hash_app = source.generate_hash_id("app_db_#_users")
    hash_analytics = source.generate_hash_id("analytics_#_users")

    assert hash_app != hash_analytics


@pytest.mark.asyncio
async def test_mysql_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MySQLSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [TableRef(database="app_db", table="users")],
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
