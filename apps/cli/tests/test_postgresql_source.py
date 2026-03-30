from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
    Severity,
)
from src.sources.postgresql.source import PostgreSQLSource, TableRef


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "POSTGRESQL",
        "required": {"host": "localhost", "port": 5432},
        "masked": {"username": "postgres", "password": "test"},
        "optional": {
            "scope": {"database": "postgres"},
        },
        "sampling": {
            "strategy": "RANDOM",
            "limit": 10,
            "max_columns": 10,
            "max_cell_chars": 256,
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePsycopg2:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.postgresql.source.require_module",
        lambda **_kwargs: _FakePsycopg2(),
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
    def __init__(self) -> None:
        self.autocommit = True

    def cursor(self) -> _DummyCursor:
        return _DummyCursor()

    def __enter__(self) -> _DummyConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_postgresql_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = PostgreSQLSource(_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["postgres"])
    monkeypatch.setattr(source, "_connect", lambda _database: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_postgresql_requires_database_when_not_include_all() -> None:
    source = PostgreSQLSource(
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


def test_postgresql_include_all_uses_configured_maintenance_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = PostgreSQLSource(
        _recipe(
            optional={
                "scope": {
                    "include_all_databases": True,
                    "maintenance_database": "app",
                }
            }
        )
    )

    connected_databases: list[str] = []

    class _ListCursor:
        def execute(self, _query: str, _params: Any = None) -> None:
            return None

        def fetchall(self) -> list[tuple[Any, ...]]:
            return [("db_a",), ("db_b",)]

        def __enter__(self) -> _ListCursor:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    class _ListConnection:
        autocommit = True

        def cursor(self) -> _ListCursor:
            return _ListCursor()

        def __enter__(self) -> _ListConnection:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    def _connect(database: str) -> _ListConnection:
        connected_databases.append(database)
        return _ListConnection()

    monkeypatch.setattr(source, "_connect", _connect)

    assert source._resolve_databases() == ["db_a", "db_b"]
    assert connected_databases == ["app"]


def test_postgresql_include_all_defaults_maintenance_database_to_postgres(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = PostgreSQLSource(_recipe(optional={"scope": {"include_all_databases": True}}))

    connected_databases: list[str] = []

    class _EmptyCursor:
        def execute(self, _query: str, _params: Any = None) -> None:
            return None

        def fetchall(self) -> list[tuple[Any, ...]]:
            return []

        def __enter__(self) -> _EmptyCursor:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    class _EmptyConnection:
        autocommit = True

        def cursor(self) -> _EmptyCursor:
            return _EmptyCursor()

        def __enter__(self) -> _EmptyConnection:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    def _connect(database: str) -> _EmptyConnection:
        connected_databases.append(database)
        return _EmptyConnection()

    monkeypatch.setattr(source, "_connect", _connect)

    assert source._resolve_databases() == ["postgres"]
    assert connected_databases == ["postgres"]


@pytest.mark.asyncio
async def test_postgresql_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = PostgreSQLSource(_recipe())
    tables = [
        TableRef(database="postgres", schema="public", table="users"),
        TableRef(database="postgres", schema="public", table="orders"),
        TableRef(database="postgres", schema="analytics", table="events"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_foreign_key_links",
        lambda _tables: {
            ("postgres", "public", "orders"): {("postgres", "public", "users")},
        },
    )

    original_batch_size = PostgreSQLSource.BATCH_SIZE
    PostgreSQLSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        PostgreSQLSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert batches[0][0].name == "postgres.public.users"
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    users_hash = source.generate_hash_id("postgres_#_public_#_users")
    assert users_hash in batches[0][1].links
    assert batches[1][0].name == "postgres.analytics.events"


@pytest.mark.asyncio
async def test_postgresql_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = PostgreSQLSource(_recipe())
    table_ref = TableRef(database="postgres", schema="public", table="users")
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


def test_postgresql_format_sample_content_renders_detector_friendly_cell_lines() -> None:
    source = PostgreSQLSource(_recipe())
    table_ref = TableRef(database="postgres", schema="public", table="training_set")

    raw_content, text_content = source._format_sample_content(
        table_ref,
        ["id", "name", "email"],
        [(5, "Patrick Clark", "patrick.clark@example.com")],
    )

    assert "row_1:" in text_content
    assert "  name: Patrick Clark" in text_content
    assert "  email: patrick.clark@example.com" in text_content
    assert "name=Patrick Clark" not in text_content
    assert "email=patrick.clark@example.com" not in text_content
    assert '"name": "Patrick Clark"' in raw_content


def test_postgresql_enrich_finding_location_uses_cached_row_and_column() -> None:
    source = PostgreSQLSource(_recipe())
    table_ref = TableRef(database="postgres", schema="public", table="training_set")
    asset = source._table_to_asset(table_ref)
    source._table_lookup[asset.hash] = table_ref
    source._content_cache[asset.hash] = source._format_sample_content(
        table_ref,
        ["id", "name", "email", "text"],
        [
            (
                5,
                "Patrick Clark",
                "patrick.clark@example.com",
                "Please contact Patrick Clark at patrick.clark@example.com",
            )
        ],
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(source, "_get_primary_key_columns", lambda _table_ref: ["id"])

    finding = DetectionResult(
        detector_type=DetectorType.PII,
        finding_type="PERSON",
        category="PII",
        severity=Severity.medium,
        confidence=0.99,
        matched_content="Patrick Clark",
        location=Location(path="line 1"),
    )

    source.enrich_finding_location(finding, asset, "")

    assert finding.location is not None
    assert finding.location.path == "public.training_set, id=5"
    assert finding.location.description == "column name"
    monkeypatch.undo()


def test_postgresql_enrich_finding_location_uses_tabular_metadata_hints() -> None:
    source = PostgreSQLSource(_recipe())
    table_ref = TableRef(database="postgres", schema="public", table="training_set")
    asset = source._table_to_asset(table_ref)
    source._table_lookup[asset.hash] = table_ref
    source._content_cache[asset.hash] = source._format_sample_content(
        table_ref,
        ["id", "email", "text"],
        [
            (
                4,
                "carlacherry@example.org",
                "Patrick Clark can be reached at carlacherry@example.org",
            )
        ],
    )
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(source, "_get_primary_key_columns", lambda _table_ref: ["id"])

    finding = DetectionResult(
        detector_type=DetectorType.PII,
        finding_type="EMAIL_ADDRESS",
        category="PII",
        severity=Severity.high,
        confidence=0.99,
        matched_content="carlacherry@example.org",
        location=Location(path="line 1"),
        metadata={
            "tabular_row_index": 1,
            "tabular_column_name": "text",
        },
    )

    source.enrich_finding_location(finding, asset, "")

    assert finding.location is not None
    assert finding.location.path == "public.training_set, id=4"
    assert finding.location.description == "column text"
    monkeypatch.undo()


def test_postgresql_latest_sampling_falls_back_to_random() -> None:
    source = PostgreSQLSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "limit": 5,
                "fallback_to_random": True,
            },
        )
    )
    table_ref = TableRef(database="postgres", schema="public", table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "ORDER BY RANDOM()" in query
    assert params == [5]


def test_postgresql_all_strategy_omits_limit() -> None:
    source = PostgreSQLSource(
        _recipe(
            sampling={
                "strategy": "ALL",
            },
        )
    )
    table_ref = TableRef(database="postgres", schema="public", table="users")

    query, params = source._build_sampling_query(table_ref, ["id", "email"])

    assert "LIMIT" not in query
    assert params == []


def test_postgresql_hash_avoids_schema_and_database_collisions() -> None:
    source = PostgreSQLSource(_recipe())
    hash_public = source.generate_hash_id("db1_#_public_#_users")
    hash_analytics = source.generate_hash_id("db1_#_analytics_#_users")
    hash_other_db = source.generate_hash_id("db2_#_public_#_users")

    assert hash_public != hash_analytics
    assert hash_public != hash_other_db
    assert hash_analytics != hash_other_db


@pytest.mark.asyncio
async def test_postgresql_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = PostgreSQLSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [TableRef(database="postgres", schema="public", table="users")],
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
