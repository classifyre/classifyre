from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.oracle.source import ObjectRef, OracleSource


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "ORACLE",
        "required": {
            "host": "localhost",
            "port": 1521,
            "service_name": "some_db",
        },
        "masked": {
            "username": "classifyre",
            "password": "oracletest",
        },
        "optional": {
            "scope": {
                "include_tables": True,
                "include_views": True,
                "include_view_lineage": True,
                "include_view_column_lineage": True,
            }
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeOracleDB:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.oracle.source.require_module",
        lambda **_kwargs: _FakeOracleDB(),
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


def test_oracle_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = OracleSource(_recipe())
    monkeypatch.setattr(
        source,
        "_iter_objects",
        lambda: [
            ObjectRef(service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE")
        ],
    )
    monkeypatch.setattr(source, "_connect", _DummyConnection)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable objects: 1" in result["message"]


@pytest.mark.asyncio
async def test_oracle_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = OracleSource(_recipe())
    objects = [
        ObjectRef(service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE"),
        ObjectRef(service_name="some_db", schema="HR", name="DEPARTMENTS", object_type="TABLE"),
        ObjectRef(service_name="some_db", schema="HR", name="test_v", object_type="VIEW"),
    ]
    monkeypatch.setattr(source, "_iter_objects", lambda: objects)
    monkeypatch.setattr(
        source,
        "_collect_foreign_key_links",
        lambda _objects: {("HR", "EMPLOYEES"): {("HR", "DEPARTMENTS")}},
    )
    monkeypatch.setattr(
        source,
        "_collect_view_links",
        lambda _objects: {("HR", "test_v"): {("HR", "EMPLOYEES")}},
    )

    original_batch_size = OracleSource.BATCH_SIZE
    OracleSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        OracleSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(objects)
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    dept_hash = source.generate_hash_id("some_db_#_HR_#_DEPARTMENTS")
    emp_hash = source.generate_hash_id("some_db_#_HR_#_EMPLOYEES")
    assert dept_hash in batches[0][0].links
    assert emp_hash in batches[1][0].links


@pytest.mark.asyncio
async def test_oracle_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = OracleSource(_recipe())
    object_ref = ObjectRef(
        service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE"
    )
    asset = source._object_to_asset(object_ref)
    source._table_lookup[asset.hash] = object_ref

    call_count = 0

    def _sample(_object_ref: ObjectRef) -> tuple[str, str]:
        nonlocal call_count
        call_count += 1
        return ('{"rows":[]}', "sample rows payload")

    monkeypatch.setattr(source, "_sample_object_rows", _sample)

    first = await source.fetch_content(asset.hash)
    second = await source.fetch_content(asset.hash)

    assert first == second
    assert first is not None
    assert "sample rows payload" in first[1]
    assert call_count == 1


def test_oracle_latest_sampling_falls_back_to_random() -> None:
    source = OracleSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 5,
                "fallback_to_random": True,
            },
        )
    )
    object_ref = ObjectRef(
        service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE"
    )

    query, params = source._build_sampling_query(object_ref, ["ID", "NAME"])

    assert "ORDER BY DBMS_RANDOM.VALUE" in query
    assert "FETCH FIRST 5 ROWS ONLY" in query
    assert params == []


def test_oracle_all_strategy_omits_limit() -> None:
    source = OracleSource(_recipe(sampling={"strategy": "ALL"}))
    object_ref = ObjectRef(
        service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE"
    )

    query, params = source._build_sampling_query(object_ref, ["ID", "NAME"])

    assert "FETCH FIRST" not in query
    assert params == []


def test_oracle_hash_avoids_service_and_schema_collisions() -> None:
    source = OracleSource(_recipe())
    hash_hr = source.generate_hash_id("some_db_#_HR_#_EMPLOYEES")
    hash_finance = source.generate_hash_id("some_db_#_FINANCE_#_EMPLOYEES")
    hash_service = source.generate_hash_id("ALT_PDB_#_HR_#_EMPLOYEES")

    assert hash_hr != hash_finance
    assert hash_hr != hash_service
    assert hash_finance != hash_service


@pytest.mark.asyncio
async def test_oracle_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = OracleSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_objects",
        lambda: [
            ObjectRef(service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE")
        ],
    )
    monkeypatch.setattr(source, "_collect_foreign_key_links", lambda _objects: {})
    monkeypatch.setattr(source, "_collect_view_links", lambda _objects: {})

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
async def test_oracle_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via OFFSET/FETCH batches."""
    source = OracleSource(
        _recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    object_ref = ObjectRef(
        service_name="some_db", schema="HR", name="EMPLOYEES", object_type="TABLE"
    )
    asset = source._object_to_asset(object_ref)

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

            m = re.search(r"OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+NEXT\s+(\d+)", query, re.IGNORECASE)
            if m:
                offset, batch_size = int(m.group(1)), int(m.group(2))
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
    monkeypatch.setattr(source, "_connect", lambda: _BatchConnection())

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 2
    assert all("OFFSET" in q and "FETCH NEXT" in q for q in queries_issued)
    assert len(pages) == 2
    assert "item1" in pages[0]
    assert "item12" in pages[1]
