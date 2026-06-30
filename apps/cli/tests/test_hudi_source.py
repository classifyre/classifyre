from __future__ import annotations

from typing import Any

import pytest

from src.sources.hudi.source import HudiSource
from tests._spark_fakes import FakeSparkSession


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "HUDI",
        "required": {"warehouse_path": "s3a://lake/hudi"},
        "optional": {"scope": {"include_all_databases": True}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_require(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.hudi.source.require_module",
        lambda **_kwargs: object(),
    )


def _build(session: FakeSparkSession, recipe: dict[str, Any] | None = None) -> HudiSource:
    src = HudiSource(recipe or _recipe())
    src._session = lambda: session  # type: ignore[method-assign]
    return src


def _session_with_tables() -> FakeSparkSession:
    return FakeSparkSession(
        databases=["lake"],
        tables={"lake": ["events"]},
        fields=[("id", "int"), ("payload", "string")],
        rows=[(i, f"event-{i}") for i in range(12)],
        tblproperties=[
            ("hoodie.table.type", "MERGE_ON_READ"),
            ("hoodie.table.partition.fields", "dt,region"),
        ],
    )


def test_hudi_test_connection_success() -> None:
    src = _build(FakeSparkSession())
    assert src.test_connection()["status"] == "SUCCESS"


async def test_hudi_extract_emits_table_with_type_metadata() -> None:
    src = _build(_session_with_tables())
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    meta = assets[0].metadata
    assert assets[0].asset_kind == "table"
    assert meta["table_name"] == "events"
    assert meta["table_type"] == "MERGE_ON_READ"
    assert meta["partition_columns"] == ["dt", "region"]


async def test_hudi_all_strategy_streams_rows() -> None:
    session = _session_with_tables()
    src = _build(session, _recipe(sampling={"strategy": "ALL", "rows_per_page": 10}))
    [a async for batch in src.extract_raw() for a in batch]
    asset_hash = next(iter(src._table_lookup))
    pages = [page async for page in src.fetch_content_pages(asset_hash)]
    assert len(pages) == 12
    assert not any("OFFSET" in q for q in session.queries)
