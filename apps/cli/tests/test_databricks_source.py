from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.databricks.source import (
    DatabricksSource,
    NotebookRef,
    PipelineRef,
    TableRef,
)


def _pat_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "DATABRICKS",
        "required": {
            "auth_mode": "PAT_TOKEN",
            "workspace_url": "https://adb-123410678901234106.7.azuredatabricks.net",
            "warehouse_id": "warehouse-1",
        },
        "masked": {
            "token": "dapi-token",
        },
        "optional": {
            "scope": {
                "include_catalogs": ["main"],
                "include_hive_metastore": False,
            },
            "extraction": {
                "include_table_lineage": True,
                "include_column_lineage": False,
                "include_notebooks": True,
                "include_pipelines": True,
            },
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


def _service_principal_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "DATABRICKS",
        "required": {
            "auth_mode": "SERVICE_PRINCIPAL",
            "workspace_url": "https://adb-123410678901234106.7.azuredatabricks.net",
            "warehouse_id": "warehouse-1",
            "client_id": "service-principal-client-id",
        },
        "masked": {
            "client_secret": "service-principal-secret",
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeDatabricksSqlModule:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched in tests
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.databricks.source.require_module",
        lambda **_kwargs: _FakeDatabricksSqlModule(),
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


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = "{}" if payload else ""

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeSession:
    def __init__(self) -> None:
        self.post_calls: list[dict[str, Any]] = []

    def post(self, url: str, data: dict[str, Any], timeout: int) -> _FakeResponse:
        self.post_calls.append({"url": url, "data": data, "timeout": timeout})
        return _FakeResponse({"access_token": "oauth-access-token", "expires_in": 3600})

    def close(self) -> None:
        return None


def test_databricks_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = DatabricksSource(_pat_recipe())
    monkeypatch.setattr(source, "_list_catalogs", lambda: ["main"])
    monkeypatch.setattr(source, "_connect_sql", _DummyConnection)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Reachable catalogs: 1" in result["message"]


def test_databricks_service_principal_acquires_token() -> None:
    source = DatabricksSource(_service_principal_recipe())
    fake_session = _FakeSession()
    source.session = fake_session  # type: ignore[assignment]

    token = source._access_token_value()

    assert token == "oauth-access-token"
    assert len(fake_session.post_calls) == 1
    assert fake_session.post_calls[0]["data"]["grant_type"] == "client_credentials"
    assert fake_session.post_calls[0]["data"]["scope"] == "all-apis"


@pytest.mark.asyncio
async def test_databricks_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = DatabricksSource(_pat_recipe())

    tables = [
        TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE"),
        TableRef(catalog="main", schema="finance", table="payments", object_type="TABLE"),
    ]

    monkeypatch.setattr(source, "_iter_tables", lambda: tables)
    monkeypatch.setattr(
        source,
        "_collect_table_lineage_links",
        lambda _tables: {("main", "finance", "payments"): {("main", "finance", "orders")}},
    )
    monkeypatch.setattr(
        source,
        "_list_notebooks",
        lambda: [
            NotebookRef(
                path="/Shared/finance_orders",
                object_id="1001",
                language="SQL",
                created_at_ms=1,
                modified_at_ms=2,
            )
        ],
    )
    monkeypatch.setattr(
        source,
        "_list_pipelines",
        lambda: [
            PipelineRef(
                pipeline_id="pipeline-1",
                name="daily-finance-pipeline",
                state="RUNNING",
            )
        ],
    )

    original_batch_size = DatabricksSource.BATCH_SIZE
    DatabricksSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        DatabricksSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 2]
    assert sum(len(batch) for batch in batches) == 4

    all_assets = [asset for batch in batches for asset in batch]
    table_assets = [
        asset
        for asset in all_assets
        if asset.name in {"main.finance.orders", "main.finance.payments"}
    ]
    assert len(table_assets) == 2
    assert all(asset.asset_type == OutputAssetType.TABLE for asset in table_assets)

    notebook_asset = next(asset for asset in all_assets if asset.name == "/Shared/finance_orders")
    pipeline_asset = next(asset for asset in all_assets if asset.name == "daily-finance-pipeline")
    assert notebook_asset.asset_type == OutputAssetType.TXT
    assert pipeline_asset.asset_type == OutputAssetType.TXT

    orders_hash = source.generate_hash_id("main_#_finance_#_orders")
    assert orders_hash in batches[0][1].links


@pytest.mark.asyncio
async def test_databricks_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = DatabricksSource(_pat_recipe())
    table_ref = TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE")
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


def test_databricks_latest_sampling_falls_back_to_random() -> None:
    source = DatabricksSource(
        _pat_recipe(
            sampling={
                "strategy": "LATEST",
                "rows_per_page": 10,
                "fallback_to_random": True,
            }
        )
    )
    table_ref = TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "ORDER BY rand()" in query
    assert "LIMIT 10" in query
    assert params == []


def test_databricks_all_strategy_omits_limit() -> None:
    source = DatabricksSource(_pat_recipe(sampling={"strategy": "ALL"}))
    table_ref = TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE")

    query, params = source._build_sampling_query(table_ref, ["id", "name"])

    assert "LIMIT" not in query
    assert params == []


def test_databricks_hash_avoids_catalog_and_schema_collisions() -> None:
    source = DatabricksSource(_pat_recipe())
    hash_finance = source.generate_hash_id("main_#_finance_#_orders")
    hash_ops = source.generate_hash_id("main_#_ops_#_orders")
    hash_other_catalog = source.generate_hash_id("analytics_#_finance_#_orders")

    assert hash_finance != hash_ops
    assert hash_finance != hash_other_catalog
    assert hash_ops != hash_other_catalog


@pytest.mark.asyncio
async def test_databricks_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = DatabricksSource(_pat_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))

    monkeypatch.setattr(
        source,
        "_iter_tables",
        lambda: [TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE")],
    )
    monkeypatch.setattr(source, "_collect_table_lineage_links", lambda _tables: {})
    monkeypatch.setattr(source, "_list_notebooks", lambda: [])
    monkeypatch.setattr(source, "_list_pipelines", lambda: [])

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
async def test_databricks_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With strategy=ALL, fetch_content_pages must paginate via LIMIT/OFFSET batches."""
    source = DatabricksSource(
        _pat_recipe(
            sampling={
                "strategy": "ALL",
                "rows_per_page": 10,
            }
        )
    )
    table_ref = TableRef(catalog="main", schema="finance", table="orders", object_type="TABLE")
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
    monkeypatch.setattr(source, "_connect_sql", lambda: _BatchConnection())

    pages = [text async for _raw, text in source.fetch_content_pages(asset.hash)]

    assert len(queries_issued) == 3
    assert "COUNT" in queries_issued[0]
    assert all("LIMIT" in q and "OFFSET" in q for q in queries_issued[1:])
    assert len(pages) == 2
    assert "item1" in pages[0]
    assert "item12" in pages[1]
