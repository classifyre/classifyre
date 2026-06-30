from __future__ import annotations

from typing import Any

import pytest

from src.sources.spark_catalog.source import SparkCatalogSource
from tests._spark_fakes import FakeSparkSession


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "SPARK_CATALOG",
        "required": {"connect_url": "sc://spark-connect:15002"},
        "optional": {"scope": {"include_all_databases": True}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_require(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.spark_catalog.source.require_module",
        lambda **_kwargs: object(),
    )


def _build(session: FakeSparkSession, recipe: dict[str, Any] | None = None) -> SparkCatalogSource:
    src = SparkCatalogSource(recipe or _recipe())
    src._session = lambda: session  # type: ignore[method-assign]
    return src


def _session_with_tables() -> FakeSparkSession:
    return FakeSparkSession(
        databases=["analytics"],
        tables={"analytics": ["orders"]},
        fields=[("id", "int"), ("total", "double")],
        rows=[(i, float(i)) for i in range(12)],
        provider_rows=[("Provider", "delta"), ("Type", "MANAGED")],
    )


def test_spark_catalog_remote_url_includes_token() -> None:
    recipe = _recipe(masked={"token": "abc"})
    src = SparkCatalogSource(recipe)
    assert src._spark_remote() == "sc://spark-connect:15002/;token=abc"


def test_spark_catalog_classic_master_is_not_remote() -> None:
    recipe = _recipe(required={"connect_url": "spark://cluster:7077"})
    src = SparkCatalogSource(recipe)
    assert src._spark_remote() is None
    assert src._spark_master() == "spark://cluster:7077"


def test_spark_catalog_test_connection_success() -> None:
    src = _build(FakeSparkSession())
    assert src.test_connection()["status"] == "SUCCESS"


async def test_spark_catalog_extract_reports_provider() -> None:
    src = _build(_session_with_tables())
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    meta = assets[0].metadata
    assert assets[0].asset_kind == "table"
    assert meta["table_name"] == "orders"
    assert meta["provider"] == "delta"
