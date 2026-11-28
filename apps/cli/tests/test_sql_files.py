"""Every file format SQL claims to read, scanned and queried.

What a query returns and what a scan records are two readings of one file, and
everything downstream trusts the second: the catalog, a SQL connection (which
serves a table only with its recorded columns) and column masks (which go by the
column a finding names). These tests hold the two together for each format in
``FILE_FORMATS``; a new format fails here until it has a case.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

import duckdb
import pytest

from src.pipeline.detector_pipeline import DetectorPipeline
from src.query.runner import run_query
from src.sources.local_folder.source import LocalFolderSource
from src.utils.sql_files import (
    FILE_FORMATS,
    FORMATS_BY_EXTENSION,
    FORMATS_BY_MIME_TYPE,
    scan_reader_state,
)

SECRET = "AKIAIOSFODNN7EXAMPLE"
_ROWS = f"SELECT * FROM (VALUES (1, '{SECRET}', 12.50::DECIMAL(8,2))) t(id, token, amount)"


def _copy(path: Path, options: str, rows: str = _ROWS, extension: str | None = None) -> None:
    conn = duckdb.connect()
    try:
        if extension:
            conn.execute(f"INSTALL {extension}")
            conn.execute(f"LOAD {extension}")
        conn.execute(f"COPY ({rows}) TO '{path}' ({options})")
    finally:
        conn.close()


def _spatial(path: Path, driver: str) -> None:
    point = f"SELECT 1 AS id, '{SECRET}' AS token, ST_Point(1, 2) AS geom"
    _copy(path, f"FORMAT GDAL, DRIVER '{driver}'", point, extension="spatial")


def _dbf(path: Path) -> None:
    _spatial(path.with_suffix(".shp"), "ESRI Shapefile")
    for part in path.parent.glob(f"{path.stem}.*"):
        if part.suffix != ".dbf":
            part.unlink()


def _geojson(path: Path) -> None:
    feature = {
        "type": "Feature",
        "properties": {"id": 1, "token": SECRET},
        "geometry": {"type": "Point", "coordinates": [1, 2]},
    }
    path.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))


#: file name → (format, writer, the column the secret is in).
CASES: dict[str, tuple[str, Any, str]] = {
    "plain.csv": ("csv", lambda p: _copy(p, "HEADER"), "token"),
    "colon.csv": ("csv", lambda p: p.write_text(f"id,aws:token\n1,{SECRET}\n"), "aws:token"),
    "semicolon.csv": ("csv", lambda p: p.write_text(f"id;token\n1;{SECRET}\n"), "token"),
    "title.csv": ("csv", lambda p: p.write_text(f"Export\nid,token\n1,{SECRET}\n2,x\n"), "token"),
    "tabs.tsv": ("tsv", lambda p: _copy(p, "HEADER, DELIMITER '\t'"), "token"),
    "lines.jsonl": ("jsonl", lambda p: _copy(p, "FORMAT json"), "token"),
    "lines.ndjson": ("jsonl", lambda p: _copy(p, "FORMAT json"), "token"),
    "array.json": ("json", lambda p: _copy(p, "FORMAT json, ARRAY true"), "token"),
    "object.json": (
        "json",
        lambda p: p.write_text(json.dumps({"id": 1, "token": SECRET})),
        "token",
    ),
    "nested.json": (
        "json",
        lambda p: p.write_text(json.dumps([{"id": 1, "auth": {"token": SECRET}}])),
        "auth",
    ),
    "columns.parquet": ("parquet", lambda p: _copy(p, "FORMAT parquet"), "token"),
    "records.avro": ("avro", lambda p: _copy(p, "FORMAT avro", extension="avro"), "token"),
    "places.geojson": ("geojson", _geojson, "token"),
    "places.fgb": ("fgb", lambda p: _spatial(p, "FlatGeobuf"), "token"),
    "table.dbf": ("dbf", _dbf, "token"),
}


def _recipe(path: Path) -> dict[str, Any]:
    return {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(path)},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": "ALL"},
        "detectors": [{"type": "SECRETS", "enabled": True}],
    }


async def _scan(path: Path) -> dict[str, Any]:
    """Two passes, as ``main.py`` runs them; assets by object key."""
    recipe = _recipe(path)
    source = LocalFolderSource(recipe, source_id="s", runner_id="r")
    pipeline = DetectorPipeline.from_recipe(recipe, source, runner_id="r")
    try:
        assert not pipeline.init_warnings, pipeline.init_warnings
        source.set_discovery_only(True)
        stubs: list[Any] = []
        async for batch in source.extract_raw():
            stubs.extend(batch)
        source.set_discovery_only(False)
        done = await pipeline.process(stubs)
        return {asset.metadata["object_key"]: asset for asset in done}
    finally:
        pipeline.close()
        source.cleanup()


def _query_columns(folder: Path, name: str, fmt: str) -> list[str]:
    payload, _ = run_query(
        {
            "runId": "r",
            "sql": "SELECT * FROM files.local.t",
            "maxRows": 10,
            "timeoutSeconds": 60,
            "sources": [
                {
                    "alias": "files",
                    "sourceId": "s",
                    "recipe": {"type": "LOCAL_FOLDER", "required": {"path": str(folder)}},
                }
            ],
            "tables": [
                {
                    "source": "files",
                    "schema": "local",
                    "table": "t",
                    "location": {"kind": "file", "format": fmt, "objectKey": name},
                }
            ],
        }
    )
    assert payload["status"] == "success", payload
    return [column["name"] for column in payload["columns"]]


@pytest.fixture(scope="module")
def scanned(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict[str, Any]]:
    folder = tmp_path_factory.mktemp("sql-files")
    for name, (_, write, _) in CASES.items():
        write(folder / name)
    return folder, asyncio.run(_scan(folder))


def test_every_format_sql_reads_has_a_case() -> None:
    assert {fmt for fmt, _, _ in CASES.values()} == FILE_FORMATS


@pytest.mark.parametrize("name", CASES)
def test_scan_records_the_columns_a_query_returns(
    scanned: tuple[Path, dict[str, Any]], name: str
) -> None:
    folder, assets = scanned
    recorded = [column["name"] for column in assets[name].metadata.get("columns", [])]
    assert recorded == _query_columns(folder, name, CASES[name][0])


@pytest.mark.parametrize("name", CASES)
def test_a_finding_names_the_column_it_is_in(
    scanned: tuple[Path, dict[str, Any]], name: str
) -> None:
    """What column masks go by: without it a data reader reads the value."""
    _, assets = scanned
    columns = {
        (finding.metadata or {}).get("tabular_column_name") for finding in assets[name].findings
    }
    assert columns == {CASES[name][2]}


def test_a_json_file_that_is_no_table_is_still_scanned(tmp_path: Path) -> None:
    (tmp_path / "broken.json").write_text(f'{{"token": "{SECRET}", oops')
    [asset] = asyncio.run(_scan(tmp_path)).values()
    assert asset.findings
    assert not asset.metadata.get("columns")


def test_a_large_line_file_is_described_from_whole_lines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(LocalFolderSource, "SCHEMA_HEAD_BYTES", 64)
    rows = "".join(f"{i},value-{i}\n" for i in range(500))
    (tmp_path / "big.csv").write_text("id,name\n" + rows)
    [asset] = asyncio.run(_scan(tmp_path)).values()
    assert [(c["name"], c["type"]) for c in asset.metadata["columns"]] == [
        ("id", "BIGINT"),
        ("name", "VARCHAR"),
    ]


def test_files_scanned_before_are_read_again_once() -> None:
    """Else the scan cache skips an unchanged file and it never gets columns."""
    assert scan_reader_state({"object_key": "a.csv", "mime_type": "text/csv"})
    assert scan_reader_state({"object_key": "a.json", "mime_type": "application/json"})
    assert not scan_reader_state({"object_key": "a.parquet"})
    assert not scan_reader_state({"object_key": "a.pdf", "mime_type": "application/pdf"})
    assert not scan_reader_state({"object_key": "a.zip#b.csv"})
    assert not scan_reader_state({"table_name": "orders"})


@pytest.mark.parametrize(
    ("constant", "expected"),
    [("FILE_FORMATS", FORMATS_BY_MIME_TYPE), ("FILE_FORMATS_BY_EXTENSION", FORMATS_BY_EXTENSION)],
)
def test_api_and_cli_agree_on_which_files_sql_reads(
    constant: str, expected: dict[str, str]
) -> None:
    source = (Path(__file__).parents[2] / "api" / "src" / "data-query" / "sql-names.ts").read_text(
        encoding="utf-8"
    )
    block = re.search(rf"const {constant}: Record<string, string> = \{{(.*?)\}};", source, re.S)
    assert block, constant
    entries = re.findall(r"^\s*'?([^':\n]+)'?:\s*'([^']+)',", block.group(1), re.M)
    assert dict(entries) == expected
