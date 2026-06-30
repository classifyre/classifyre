from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.delta_lake.source import DeltaLakeSource
from tests._spark_fakes import FakeSparkSession


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "DELTA_LAKE",
        "required": {"warehouse_path": "s3a://lake/warehouse"},
        "optional": {"scope": {"include_all_databases": True}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


def _build(session: FakeSparkSession, recipe: dict[str, Any] | None = None) -> DeltaLakeSource:
    src = DeltaLakeSource(recipe or _recipe())
    src._session = lambda: session  # type: ignore[method-assign]
    return src


@pytest.fixture(autouse=True)
def _patch_require(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.delta_lake.source.require_module",
        lambda **_kwargs: object(),
    )


def _session_with_tables() -> FakeSparkSession:
    return FakeSparkSession(
        databases=["analytics"],
        tables={"analytics": ["customers"]},
        fields=[("id", "int"), ("email", "string")],
        rows=[(i, f"user{i}@example.com") for i in range(12)],
        detail={"numFiles": 5, "partitionColumns": ["region"], "minReaderVersion": 1},
        history_count=7,
    )


def test_delta_test_connection_success() -> None:
    src = _build(FakeSparkSession())
    result = src.test_connection()
    assert result["status"] == "SUCCESS"


async def test_delta_extract_emits_table_assets_with_metadata() -> None:
    src = _build(_session_with_tables())
    batches: list[list[SingleAssetScanResults]] = [b async for b in src.extract_raw()]
    assets = [a for batch in batches for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "table"
    assert asset.name == "analytics.customers"
    meta = asset.metadata
    # tabularTable required keys + Delta extras (validated strictly under pytest)
    assert meta["database"] == "analytics"
    assert meta["table_name"] == "customers"
    assert meta["table_type"] == "TABLE"
    assert meta["num_files"] == 5
    assert meta["partition_columns"] == ["region"]
    assert meta["format_version"] == 1
    assert meta["history_length"] == 7


async def test_delta_all_strategy_streams_rows_without_offset_paging() -> None:
    session = _session_with_tables()
    recipe = _recipe(sampling={"strategy": "ALL", "rows_per_page": 10})
    src = _build(session, recipe)
    # discover so the table is in the lookup cache
    [a async for batch in src.extract_raw() for a in batch]
    asset_hash = next(iter(src._table_lookup))

    pages = [page async for page in src.fetch_content_pages(asset_hash)]
    # 12 rows streamed one formatted page each
    assert len(pages) == 12
    # ALL streams via the cursor iterator (toLocalIterator), never OFFSET paging
    assert not any("OFFSET" in q for q in session.queries)


async def test_delta_automatic_uses_inline_limit_offset() -> None:
    session = _session_with_tables()
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
    src = _build(session, recipe)
    [a async for batch in src.extract_raw() for a in batch]
    asset_hash = next(iter(src._table_lookup))

    await src.fetch_content(asset_hash)
    assert any("LIMIT 10 OFFSET 0" in q for q in session.queries)
