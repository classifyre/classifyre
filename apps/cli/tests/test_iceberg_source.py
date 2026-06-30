from __future__ import annotations

from typing import Any

import pytest

from src.sources.iceberg.source import IcebergSource
from tests._spark_fakes import FakeSparkSession


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "ICEBERG",
        "required": {
            "catalog_type": "REST",
            "catalog_uri": "https://rest:8181",
            "warehouse": "s3://lake/iceberg",
        },
        "optional": {"scope": {"include_all_namespaces": True}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_require(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.iceberg.source.require_module",
        lambda **_kwargs: object(),
    )


def _build(session: FakeSparkSession, recipe: dict[str, Any] | None = None) -> IcebergSource:
    src = IcebergSource(recipe or _recipe())
    src._session = lambda: session  # type: ignore[method-assign]
    return src


def _session_with_tables() -> FakeSparkSession:
    return FakeSparkSession(
        databases=["analytics"],
        tables={"analytics": ["customers"]},
        fields=[("id", "long"), ("email", "string")],
        rows=[(i, f"user{i}@example.com") for i in range(12)],
    )


def test_iceberg_configures_rest_catalog() -> None:
    src = IcebergSource(_recipe(masked={"token": "abc"}))
    conf = src._extra_spark_conf()
    assert conf["spark.sql.catalog.iceberg_catalog"] == "org.apache.iceberg.spark.SparkCatalog"
    assert conf["spark.sql.catalog.iceberg_catalog.type"] == "rest"
    assert conf["spark.sql.catalog.iceberg_catalog.uri"] == "https://rest:8181"
    assert conf["spark.sql.catalog.iceberg_catalog.token"] == "abc"


def test_iceberg_glue_catalog_impl() -> None:
    src = IcebergSource(
        _recipe(required={"catalog_type": "GLUE", "warehouse": "s3://lake/iceberg"})
    )
    conf = src._extra_spark_conf()
    assert (
        conf["spark.sql.catalog.iceberg_catalog.catalog-impl"]
        == "org.apache.iceberg.aws.glue.GlueCatalog"
    )


def test_iceberg_test_connection_success() -> None:
    src = _build(FakeSparkSession())
    assert src.test_connection()["status"] == "SUCCESS"


async def test_iceberg_extract_emits_table_assets() -> None:
    src = _build(_session_with_tables())
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "table"
    assert asset.name == "analytics.customers"
    meta = asset.metadata
    assert meta["database"] == "analytics"
    assert meta["table_name"] == "customers"
    assert meta["table_type"] == "TABLE"
    assert {c["name"] for c in meta["columns"]} == {"id", "email"}


async def test_iceberg_all_strategy_streams_rows() -> None:
    session = _session_with_tables()
    src = _build(session, _recipe(sampling={"strategy": "ALL", "rows_per_page": 10}))
    [a async for batch in src.extract_raw() for a in batch]
    asset_hash = next(iter(src._table_lookup))
    pages = [page async for page in src.fetch_content_pages(asset_hash)]
    assert len(pages) == 12
    assert not any("OFFSET" in q for q in session.queries)
