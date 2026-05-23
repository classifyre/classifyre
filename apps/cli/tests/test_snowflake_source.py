from __future__ import annotations

from contextlib import closing
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.snowflake.source import SnowflakeSource, TableRef


def _default_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "SNOWFLAKE",
        "required": {
            "authentication_type": "DEFAULT_AUTHENTICATOR",
            "account_id": "xy123410.us-east-2.aws",
        },
        "masked": {
            "username": "snowflake_reader",
            "password": "example",
        },
        "optional": {
            "connection": {
                "warehouse": "compute_wh",
                "role": "SOME_ROLE",
            },
            "scope": {
                "database": "ANALYTICS",
                "include_tables": True,
                "include_views": True,
            },
            "extraction": {
                "include_table_lineage": True,
                "include_view_lineage": True,
            },
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


def _key_pair_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "SNOWFLAKE",
        "required": {
            "authentication_type": "KEY_PAIR_AUTHENTICATOR",
            "account_id": "LMAUONV-ONE_DATA_DEV",
        },
        "masked": {
            "username": "SOME_USER",
            "private_key": "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeSnowflakeModule:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.snowflake.source.require_module",
        lambda **_kwargs: _FakeSnowflakeModule(),
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


def test_snowflake_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = SnowflakeSource(_default_recipe())
    monkeypatch.setattr(source, "_resolve_databases", lambda: ["ANALYTICS"])
    monkeypatch.setattr(source, "_connect", lambda _db=None: _DummyConnection())

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable databases: 1" in result["message"]


def test_snowflake_auth_validation_requires_matching_masked_config() -> None:
    with pytest.raises(
        ValueError,
        match=r"KEY_PAIR_AUTHENTICATOR requires masked\.username and masked\.private_key",
    ):
        SnowflakeSource(
            _key_pair_recipe(
                masked={
                    "username": "SOME_USER",
                    "password": "not-valid-for-keypair",
                }
            )
        )


@pytest.mark.asyncio
async def test_snowflake_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SnowflakeSource(_default_recipe())
    tables = [
        TableRef(database="ANALYTICS", schema="PUBLIC", table="ORDERS", object_type="TABLE"),
        TableRef(database="ANALYTICS", schema="PUBLIC", table="PAYMENTS", object_type="TABLE"),
        TableRef(database="ANALYTICS", schema="PUBLIC", table="V_ORDERS", object_type="VIEW"),
    ]
    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_foreign_key_links",
        lambda _tables: {
            ("ANALYTICS", "PUBLIC", "PAYMENTS"): {("ANALYTICS", "PUBLIC", "ORDERS")},
            ("ANALYTICS", "PUBLIC", "V_ORDERS"): {("ANALYTICS", "PUBLIC", "ORDERS")},
        },
    )

    original_batch_size = SnowflakeSource.BATCH_SIZE
    SnowflakeSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        SnowflakeSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert sum(len(batch) for batch in batches) == len(tables)
    assert all(asset.asset_type == OutputAssetType.TABLE for batch in batches for asset in batch)
    parent_hash = source.generate_hash_id("ANALYTICS_#_PUBLIC_#_ORDERS")
    assert parent_hash in batches[0][1].links
    assert parent_hash in batches[1][0].links


@pytest.mark.asyncio
async def test_snowflake_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SnowflakeSource(_default_recipe())
    table_ref = TableRef(database="ANALYTICS", schema="PUBLIC", table="ORDERS", object_type="TABLE")
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


def test_snowflake_latest_sampling_falls_back_to_random() -> None:
    source = SnowflakeSource(
        _default_recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "fallback_to_random": True,
            }
        )
    )
    table_ref = TableRef(database="ANALYTICS", schema="PUBLIC", table="ORDERS", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "ORDER BY RANDOM()" in query
    assert "LIMIT 10" in query
    assert params == []


def test_snowflake_all_strategy_omits_limit() -> None:
    source = SnowflakeSource(_default_recipe(sampling={"strategy": "ALL"}))
    table_ref = TableRef(database="ANALYTICS", schema="PUBLIC", table="ORDERS", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "LIMIT" not in query
    assert params == []


def test_snowflake_key_pair_connect_uses_private_key_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = SnowflakeSource(_key_pair_recipe())

    captured_kwargs: dict[str, Any] = {}

    class _FakeSnowflakeModule:
        def connect(self, **kwargs: Any) -> _DummyConnection:
            captured_kwargs.update(kwargs)
            return _DummyConnection()

    monkeypatch.setattr(source, "_snowflake", _FakeSnowflakeModule())
    monkeypatch.setattr(source, "_build_private_key_bytes", lambda _key, _password: b"der-bytes")

    with closing(source._connect()):
        pass

    assert captured_kwargs["authenticator"] == "snowflake_jwt"
    assert captured_kwargs["private_key"] == b"der-bytes"
    assert captured_kwargs["user"] == "SOME_USER"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_snowflake_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via LIMIT/OFFSET batches."""
    import re

    source = SnowflakeSource(
        _default_recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    table_ref = TableRef(database="ANALYTICS", schema="PUBLIC", table="ORDERS", object_type="TABLE")
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
            m = re.search(r"LIMIT\s+(\d+)\s+OFFSET\s+(\d+)", query, re.IGNORECASE)
            if m:
                batch_size, offset = int(m.group(1)), int(m.group(2))
            else:
                offset, batch_size = 0, len(all_rows)
            self._rows = all_rows[offset : offset + batch_size]

        def fetchall(self) -> list[tuple[Any, ...]]:
            return list(self._rows)

        def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
            return list(self._rows[:size])

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
    monkeypatch.setattr(source, "_connect", _BatchConnection)

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 3
    assert "COUNT" in queries_issued[0]
    assert all("LIMIT" in q and "OFFSET" in q for q in queries_issued[1:])
    assert len(pages) == 12
    assert "item1" in pages[0]
    assert "item12" in pages[11]
