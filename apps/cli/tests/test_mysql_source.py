from __future__ import annotations

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
            "sampling": {
                "rows": 10,
                "strategy": "RANDOM",
                "max_columns": 10,
                "max_cell_chars": 256,
            },
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
            optional={
                "scope": {"database": "app_db"},
                "sampling": {
                    "rows": 5,
                    "strategy": "LATEST",
                    "fallback_to_random": True,
                },
            }
        )
    )
    table_ref = TableRef(database="app_db", table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "ORDER BY RAND()" in query
    assert params == [5]


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

    monkeypatch.setattr(
        "src.pipeline.detector_pipeline.DetectorPipeline.from_recipe",
        lambda *_args, **_kwargs: _Pipeline(),
    )

    batches: list[list[Any]] = []
    async for batch in source.extract():
        batches.append(batch)

    assert [len(batch) for batch in batches] == [1]
    assert processed_batches == [1]
