from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.hive.source import HiveSource, TableRef


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "HIVE",
        "required": {"host": "localhost", "port": 10000},
        "masked": {"username": "hive", "password": "hive"},
        "optional": {
            "connection": {
                "scheme": "hive",
                "connect_args": {"auth": "LDAP"},
            },
            "scope": {
                "database": "default",
                "include_tables": True,
                "include_views": True,
            },
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeHiveModule:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.hive.source.require_module",
        lambda **_kwargs: _FakeHiveModule(),
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

    def close(self) -> None:
        return None

    def __enter__(self) -> _DummyConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_hive_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = HiveSource(_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["default"])
    monkeypatch.setattr(source, "_connect", lambda _database=None: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_hive_requires_database_when_not_include_all() -> None:
    source = HiveSource(
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
async def test_hive_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = HiveSource(_recipe())
    tables = [
        TableRef(database="default", table="customers", object_type="TABLE"),
        TableRef(database="default", table="orders", object_type="TABLE"),
        TableRef(database="default", table="v_orders", object_type="VIEW"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(source, "_collect_foreign_key_links", lambda _tables: {})

    original_batch_size = HiveSource.BATCH_SIZE
    HiveSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        HiveSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert batches[0][0].name == "default.customers"
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    assert batches[0][1].name == "default.orders"
    assert batches[1][0].name == "default.v_orders"


@pytest.mark.asyncio
async def test_hive_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = HiveSource(_recipe())
    table_ref = TableRef(database="default", table="customers", object_type="TABLE")
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


def test_hive_latest_sampling_falls_back_to_random() -> None:
    source = HiveSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 5,
                "fallback_to_random": True,
            },
        )
    )
    table_ref = TableRef(database="default", table="customers", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "ORDER BY rand()" in query
    assert "LIMIT 5" in query
    assert params == []


def test_hive_all_strategy_omits_limit() -> None:
    source = HiveSource(_recipe(sampling={"strategy": "ALL"}))
    table_ref = TableRef(database="default", table="customers", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "LIMIT" not in query
    assert params == []


def test_hive_hash_avoids_database_collisions() -> None:
    source = HiveSource(_recipe())
    hash_default = source.generate_hash_id("default_#_customers")
    hash_analytics = source.generate_hash_id("analytics_#_customers")

    assert hash_default != hash_analytics


@pytest.mark.asyncio
async def test_hive_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = HiveSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [TableRef(database="default", table="customers", object_type="TABLE")],
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


@pytest.mark.asyncio
async def test_hive_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via LIMIT/OFFSET batches."""
    source = HiveSource(
        _recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    table_ref = TableRef(database="app_db", table="events", object_type="TABLE")
    asset = source._table_to_asset(table_ref)

    all_rows: list[tuple[Any, ...]] = [(i, f"item{i}") for i in range(1, 13)]
    queries_issued: list[str] = []

    class _BatchCursor:
        def __init__(self) -> None:
            self.description = [
                ("id", None, None, None, None, None, None),
                ("name", None, None, None, None, None, None),
            ]
            self._rows: list[tuple[Any, ...]] = []

        def execute(self, query: str, params: Any = None) -> None:
            queries_issued.append(query)
            import re

            m = re.search(r"LIMIT\s+(\d+)\s+OFFSET\s+(\d+)", query, re.IGNORECASE)
            if m:
                batch_size, offset = int(m.group(1)), int(m.group(2))
            else:
                offset, batch_size = 0, len(all_rows)
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

        def close(self) -> None:
            return None

        def __enter__(self) -> _BatchConnection:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(source, "_connect", lambda _db=None: _BatchConnection())

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 2
    assert all("LIMIT" in q and "OFFSET" in q for q in queries_issued)
    assert len(pages) == 2
    assert "item1" in pages[0]
    assert "item12" in pages[1]
