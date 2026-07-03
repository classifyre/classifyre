from __future__ import annotations

from pathlib import Path
from typing import Any, ClassVar

import duckdb
import pytest

from src.sources.iceberg.source import IcebergSource
from tests._lakehouse_fakes import FakeS3Client, write_parquet


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "ICEBERG",
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


class FakeIcebergTable:
    def __init__(self, files: list[str]) -> None:
        self._files = files
        self.metadata = type("M", (), {"format_version": 2})()

    def scan(self) -> Any:
        files = self._files

        class _Task:
            def __init__(self, path: str) -> None:
                self.file = type("F", (), {"file_path": path})()

        class _Scan:
            def plan_files(self) -> list[_Task]:
                return [_Task(f) for f in files]

        return _Scan()

    def schema(self) -> Any:
        class _Field:
            def __init__(self, name: str, field_type: str) -> None:
                self.name = name
                self.field_type = field_type

        class _Schema:
            fields: ClassVar = [_Field("id", "long"), _Field("email", "string")]

        return _Schema()

    def current_snapshot(self) -> Any:
        return type(
            "S",
            (),
            {
                "snapshot_id": 12345,
                "summary": {"total-records": "12", "total-data-files": "1"},
            },
        )()

    def spec(self) -> str:
        return "[]"

    def sort_order(self) -> str:
        return "[]"


_KEYS = [
    "warehouse/analytics/events/metadata/00001-aaa.metadata.json",
    "warehouse/analytics/events/metadata/00002-bbb.metadata.json",
    "warehouse/analytics/events/metadata/snap-1.avro",
    "warehouse/analytics/events/data/part-0.parquet",
    "warehouse/plain/notes.txt",
]


def _build(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    recipe: dict[str, Any] | None = None,
) -> IcebergSource:
    parquet = write_parquet(tmp_path / "events" / "part-0.parquet", rows=12)
    handle = FakeIcebergTable([parquet.as_posix()])

    monkeypatch.setattr(
        "src.sources.lakehouse_base.build_s3_client",
        lambda **_kw: FakeS3Client(_KEYS),
    )
    monkeypatch.setattr(
        "src.sources.iceberg.source.require_module",
        lambda **kwargs: duckdb if kwargs.get("module_name") == "duckdb" else object(),
    )

    src = IcebergSource(recipe or _recipe())
    src._open_table = lambda _root: handle  # type: ignore[method-assign]
    return src


def test_iceberg_discovers_table_roots_from_metadata_marker(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    tables = src._list_tables_for_database("lake")
    assert [t.table for t in tables] == ["warehouse/analytics/events"]


def test_iceberg_latest_metadata_key_picks_highest_version(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    key = src._latest_metadata_key("warehouse/analytics/events")
    assert key == "warehouse/analytics/events/metadata/00002-bbb.metadata.json"


def test_iceberg_pyiceberg_properties_wire_s3_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recipe = _recipe(
        optional={
            "connection": {"endpoint_url": "http://minio:9000", "region_name": "eu-west-1"},
            "scope": {"prefix": "warehouse/"},
        }
    )
    src = _build(monkeypatch, tmp_path, recipe=recipe)
    properties = src._pyiceberg_properties()
    assert properties["s3.endpoint"] == "http://minio:9000"
    assert properties["s3.region"] == "eu-west-1"
    assert properties["s3.access-key-id"] == "key"
    assert properties["s3.secret-access-key"] == "secret"


async def test_iceberg_extract_emits_table_assets_with_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "table"
    meta = asset.metadata
    assert meta["database"] == "lake"
    assert meta["table_name"] == "warehouse/analytics/events"
    assert [c["name"] for c in meta["columns"]] == ["id", "email"]
    assert meta["format_version"] == 2
    assert meta["snapshot_id"] == "12345"
    assert meta["num_files"] == 1
    assert meta["row_count"] == 12


async def test_iceberg_fetch_content_samples_rows_via_duckdb(
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


def test_iceberg_test_connection_reports_discovered_tables(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = _build(monkeypatch, tmp_path)
    result = src.test_connection()
    assert result["status"] == "SUCCESS"
    assert "Discovered tables: 1" in result["message"]
