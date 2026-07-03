from __future__ import annotations

from pathlib import Path
from typing import Any, ClassVar

import duckdb
import pytest

from src.sources.delta_lake.source import DeltaLakeSource
from tests._lakehouse_fakes import FakeS3Client, write_parquet


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "DELTA_LAKE",
        "required": {"bucket": "lake"},
        "masked": {
            "aws_access_key_id": "key",
            "aws_secret_access_key": "secret",
        },
        "optional": {"scope": {"prefix": "warehouse/"}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


class FakeDeltaTable:
    def __init__(self, files: list[str]) -> None:
        self._files = files

    def file_uris(self) -> list[str]:
        return self._files

    def schema(self) -> Any:
        class _Field:
            def __init__(self, name: str, type_str: str) -> None:
                self.name = name
                self.type = type("T", (), {"type": type_str})()

        class _Schema:
            fields: ClassVar = [_Field("id", "long"), _Field("email", "string")]

        return _Schema()

    def metadata(self) -> Any:
        return type("M", (), {"partition_columns": ["id"]})()

    def protocol(self) -> Any:
        return type("P", (), {"min_reader_version": 1})()

    def history(self) -> list[dict[str, Any]]:
        return [{"version": 0}, {"version": 1}]

    def get_add_actions(self, flatten: bool = True) -> Any:
        raise NotImplementedError  # row_count estimate degrades to None


def _build(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    recipe: dict[str, Any] | None = None,
    keys: list[str] | None = None,
) -> DeltaLakeSource:
    parquet = write_parquet(tmp_path / "orders" / "part-0.parquet", rows=12)
    handle = FakeDeltaTable([parquet.as_posix()])

    monkeypatch.setattr(
        "src.sources.lakehouse_base.build_s3_client",
        lambda **_kw: FakeS3Client(
            keys
            or [
                "warehouse/sales/orders/_delta_log/00000000000000000000.json",
                "warehouse/sales/orders/part-0.parquet",
                "warehouse/plain/notes.txt",
            ]
        ),
    )
    monkeypatch.setattr(
        "src.sources.delta_lake.source.require_module",
        lambda **kwargs: duckdb if kwargs.get("module_name") == "duckdb" else object(),
    )

    src = DeltaLakeSource(recipe or _recipe())
    src._open_table = lambda _root: handle  # type: ignore[method-assign]
    return src


def test_delta_discovers_table_roots_from_delta_log_marker(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    tables = src._list_tables_for_database("lake")
    assert [t.table for t in tables] == ["warehouse/sales/orders"]
    assert tables[0].database == "lake"


def test_delta_explicit_table_paths_skip_discovery(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recipe = _recipe(
        optional={"scope": {"table_paths": ["s3://lake/warehouse/crm/customers/", "raw/events"]}}
    )
    src = _build(monkeypatch, tmp_path, recipe=recipe)
    tables = src._list_tables_for_database("lake")
    assert [t.table for t in tables] == ["warehouse/crm/customers", "raw/events"]


async def test_delta_extract_emits_table_assets_with_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "table"
    meta = asset.metadata
    assert meta["database"] == "lake"
    assert meta["table_name"] == "warehouse/sales/orders"
    assert [c["name"] for c in meta["columns"]] == ["id", "email"]
    assert meta["num_files"] == 1
    assert meta["partition_columns"] == ["id"]
    assert meta["format_version"] == 1
    assert meta["history_length"] == 2


async def test_delta_fetch_content_samples_rows_via_duckdb(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)
    assert result is not None
    _raw, text = result
    # capped at rows_per_page (10), even though 12 rows exist
    assert text.count("row_") == 10
    assert "@example.com" in text


def test_delta_storage_options_wire_s3_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recipe = _recipe(
        optional={
            "connection": {"endpoint_url": "http://minio:9000", "region_name": "us-east-1"},
            "scope": {"prefix": "warehouse/"},
        }
    )
    src = _build(monkeypatch, tmp_path, recipe=recipe)
    options = src._storage_options()
    assert options["AWS_ACCESS_KEY_ID"] == "key"
    assert options["AWS_SECRET_ACCESS_KEY"] == "secret"
    assert options["AWS_REGION"] == "us-east-1"
    assert options["AWS_ENDPOINT_URL"] == "http://minio:9000"
    assert options["AWS_ALLOW_HTTP"] == "true"
    assert options["AWS_VIRTUAL_HOSTED_STYLE_REQUEST"] == "false"


def test_delta_test_connection_reports_discovered_tables(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    result = src.test_connection()
    assert result["status"] == "SUCCESS"
    assert "Discovered tables: 1" in result["message"]
