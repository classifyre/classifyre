from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.mssql.source import MSSQLSource, TableRef


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "MSSQL",
        "required": {"host": "localhost", "port": 1433},
        "masked": {"username": "test", "password": "example"},
        "optional": {
            "scope": {
                "database": "some_db",
                "include_tables": True,
                "include_views": True,
            }
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
    class _FakePyMSSQL:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.mssql.source.require_module",
        lambda **_kwargs: _FakePyMSSQL(),
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


def test_mssql_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = MSSQLSource(_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["some_db"])
    monkeypatch.setattr(source, "_connect", lambda _database=None: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_mssql_requires_database_when_not_include_all() -> None:
    source = MSSQLSource(
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


def test_mssql_ldap_auth_prefixes_domain_to_username() -> None:
    source = MSSQLSource(
        _recipe(
            masked={"username": "reader", "password": "example"},
            optional={
                "connection": {
                    "auth_mode": "LDAP",
                    "ldap_domain": "Classifyre",
                },
                "scope": {
                    "database": "some_db",
                },
            },
        )
    )

    assert source._username() == "Classifyre\\reader"


def test_mssql_ldap_auth_keeps_preformatted_username() -> None:
    source = MSSQLSource(
        _recipe(
            masked={"username": "Classifyre\\reader", "password": "example"},
            optional={
                "connection": {
                    "auth_mode": "LDAP",
                    "ldap_domain": "IGNORED",
                },
                "scope": {
                    "database": "some_db",
                },
            },
        )
    )

    assert source._username() == "Classifyre\\reader"


@pytest.mark.asyncio
async def test_mssql_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MSSQLSource(_recipe())
    tables = [
        TableRef(database="some_db", schema="some_schema", table="sysjobs", object_type="TABLE"),
        TableRef(
            database="some_db", schema="some_schema", table="sysjobsteps", object_type="TABLE"
        ),
        TableRef(database="some_db", schema="some_schema", table="v_jobs", object_type="VIEW"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_dependency_links",
        lambda _tables: {
            ("some_db", "some_schema", "sysjobsteps"): {("some_db", "some_schema", "sysjobs")},
        },
    )

    original_batch_size = MSSQLSource.BATCH_SIZE
    MSSQLSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        MSSQLSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert batches[0][0].name == "some_db.some_schema.sysjobs"
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    parent_hash = source.generate_hash_id("some_db_#_some_schema_#_sysjobs")
    assert parent_hash in batches[0][1].links
    assert batches[1][0].name == "some_db.some_schema.v_jobs"


@pytest.mark.asyncio
async def test_mssql_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MSSQLSource(_recipe())
    table_ref = TableRef(
        database="some_db", schema="some_schema", table="sysjobs", object_type="TABLE"
    )
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


def test_mssql_latest_sampling_falls_back_to_random() -> None:
    source = MSSQLSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "limit": 5,
                "fallback_to_random": True,
            },
        )
    )
    table_ref = TableRef(
        database="some_db", schema="some_schema", table="sysjobs", object_type="TABLE"
    )

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "ORDER BY NEWID()" in query
    assert "TOP 5" in query
    assert params == []


def test_mssql_all_strategy_omits_top() -> None:
    source = MSSQLSource(_recipe(sampling={"strategy": "ALL"}))
    table_ref = TableRef(
        database="some_db", schema="some_schema", table="sysjobs", object_type="TABLE"
    )

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "TOP" not in query
    assert params == []


def test_mssql_hash_avoids_schema_and_database_collisions() -> None:
    source = MSSQLSource(_recipe())
    hash_some_schema = source.generate_hash_id("db1_#_some_schema_#_users")
    hash_ops = source.generate_hash_id("db1_#_ops_#_users")
    hash_other_db = source.generate_hash_id("db2_#_some_schema_#_users")

    assert hash_some_schema != hash_ops
    assert hash_some_schema != hash_other_db
    assert hash_ops != hash_other_db


@pytest.mark.asyncio
async def test_mssql_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MSSQLSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [
            TableRef(database="some_db", schema="some_schema", table="sysjobs", object_type="TABLE")
        ],
    )
    monkeypatch.setattr(source, "_collect_dependency_links", lambda _tables: {})

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


def test_mssql_is_aws_rds_auto_detects_from_host() -> None:
    source = MSSQLSource(
        _recipe(
            required={"host": "my-db.abc.eu-west-1.rds.amazonaws.com", "port": 1433},
            optional={"scope": {"database": "some_db"}},
        )
    )
    assert source._is_aws_rds() is True


def test_mssql_is_aws_rds_explicit_override() -> None:
    source = MSSQLSource(
        _recipe(
            required={"host": "localhost", "port": 1433},
            optional={
                "connection": {"is_aws_rds": True},
                "scope": {"database": "some_db"},
            },
        )
    )
    assert source._is_aws_rds() is True


def test_mssql_collect_dependency_links_respects_table_lineage_toggle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MSSQLSource(
        _recipe(
            optional={
                "scope": {"database": "some_db"},
                "extraction": {
                    "include_table_lineage": False,
                    "include_view_lineage": False,
                },
            }
        )
    )
    monkeypatch.setattr(
        source, "_collect_foreign_key_links", lambda _tables: {("a", "b", "c"): {("x", "y", "z")}}
    )
    monkeypatch.setattr(
        source,
        "_collect_view_dependency_links",
        lambda _tables: {("v", "s", "w"): {("x", "y", "z")}},
    )

    links = source._collect_dependency_links([])

    assert links == {}
