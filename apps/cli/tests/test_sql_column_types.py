"""Column types, from a file to a SQL connection.

A SQL connection types each column from what the scan recorded and encodes what
the query returns into it. Both halves are Python, the encoder is TypeScript, so
this writes the two readings of real files where the API's test
(``column-types.contract.spec.ts``) reads them, and fails when they change.
Refresh with ``UPDATE_SQL_FIXTURES=1 uv run pytest tests/test_sql_column_types.py``.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

import duckdb
import pytest

from src.pipeline.detector_pipeline import DetectorPipeline
from src.query.runner import run_query
from src.sources.local_folder.source import LocalFolderSource

FIXTURES = Path(__file__).parents[2] / "api" / "src" / "sql-gateway" / "fixtures" / "column-types"

#: Every type DuckDB writes to Parquet that a column is likely to have.
_PARQUET = """
SELECT * FROM (VALUES
  (true, 1::TINYINT, 2::SMALLINT, 3, 4000000000::BIGINT, 200::UTINYINT, 60000::USMALLINT,
   4000000000::UINTEGER, 18000000000000000000::UBIGINT, 1.5::FLOAT, 2.25::DOUBLE,
   12.5::DECIMAL(5,2), 1234567.891::DECIMAL(18,3), 123456789012345.123456::DECIMAL(38,6),
   'text', 'bytes'::BLOB, DATE '2026-03-04', TIME '05:06:07.5', TIMESTAMP '2026-03-04 05:06:07.5',
   TIMESTAMPTZ '2026-03-04 05:06:07+00', '123e4567-e89b-12d3-a456-426614174000'::UUID,
   [1, 2], ['a', 'b c'], {'a': 1, 'b': 'x'}, MAP {'k': 1}, [{'a': 1}]),
  (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
) t(c_bool, c_tinyint, c_smallint, c_int, c_bigint, c_utinyint, c_usmallint, c_uinteger,
    c_ubigint, c_float, c_double, c_decimal, c_decimal18, c_decimal38, c_text, c_blob, c_date,
    c_time, c_timestamp, c_timestamptz, c_uuid, c_ints, c_texts, c_struct, c_map, c_structs)
"""

#: What JSON can say, typed by DuckDB's own inference.
_JSON_LINES = [
    {
        "i": 1,
        "big": 4000000000,
        "f": 2.5,
        "flag": True,
        "name": "x",
        "day": "2026-03-04",
        "at": "2026-03-04 05:06:07",
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "tags": ["a"],
        "nested": {"a": 1},
        "clock": "05:06:07",
    },
    {},
]


def _write(folder: Path) -> None:
    conn = duckdb.connect()
    try:
        conn.execute("SET TimeZone = 'UTC'")
        conn.execute(f"COPY ({_PARQUET}) TO '{folder / 'parquet.parquet'}' (FORMAT parquet)")
    finally:
        conn.close()
    (folder / "jsonl.jsonl").write_text("".join(json.dumps(row) + "\n" for row in _JSON_LINES))


async def _scan(folder: Path) -> dict[str, list[dict[str, str]]]:
    recipe: dict[str, Any] = {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(folder)},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": "ALL"},
        "detectors": [],
    }
    source = LocalFolderSource(recipe, source_id="s", runner_id="r")
    pipeline = DetectorPipeline.from_recipe(recipe, source, runner_id="r")
    try:
        source.set_discovery_only(True)
        stubs: list[Any] = []
        async for batch in source.extract_raw():
            stubs.extend(batch)
        source.set_discovery_only(False)
        done = await pipeline.process(stubs)
        return {a.metadata["object_key"]: a.metadata["columns"] for a in done}
    finally:
        pipeline.close()
        source.cleanup()


@pytest.mark.parametrize("fmt", ["parquet", "jsonl"])
def test_recorded_and_returned_types_match_the_contract(tmp_path: Path, fmt: str) -> None:
    import pyarrow as pa  # type: ignore[import-untyped]

    _write(tmp_path)
    key = f"{fmt}.{fmt}"
    recorded = asyncio.run(_scan(tmp_path))[key]
    payload, result = run_query(
        {
            "runId": "r",
            "sql": "SELECT * FROM files.local.t",
            "maxRows": 10,
            "timeoutSeconds": 60,
            "sources": [
                {
                    "alias": "files",
                    "sourceId": "s",
                    "recipe": {"type": "LOCAL_FOLDER", "required": {"path": str(tmp_path)}},
                }
            ],
            "tables": [
                {
                    "source": "files",
                    "schema": "local",
                    "table": "t",
                    "location": {"kind": "file", "format": fmt, "objectKey": key},
                }
            ],
        }
    )
    assert payload["status"] == "success", payload
    table = pa.ipc.open_stream(result.arrow).read_all()
    contract = {
        "recorded": [{"name": c["name"], "type": c["type"]} for c in recorded],
        # A zoned timestamp names the machine's own zone: not part of the contract.
        "returned": [
            [field.name, re.sub(r"tz=[^\]]+", "tz=local", str(field.type))]
            for field in table.schema
        ],
    }
    assert [c["name"] for c in contract["recorded"]] == table.schema.names

    fixture = FIXTURES / f"{fmt}.json"
    if os.environ.get("UPDATE_SQL_FIXTURES"):
        FIXTURES.mkdir(parents=True, exist_ok=True)
        fixture.write_text(json.dumps(contract, indent=2) + "\n")
        (FIXTURES / f"{fmt}.arrow").write_bytes(result.arrow)
    assert contract == json.loads(fixture.read_text())


@pytest.mark.parametrize(
    ("sql", "text"),
    [
        ("INTERVAL '1 day 02:03:04'", "1 day 02:03:04"),
        ("INTERVAL '14 months 3 days'", "1 year 2 mons 3 days"),
        ("INTERVAL '-1 month'", "-1 mons"),
        ("INTERVAL '0.5 seconds'", "00:00:00.5"),
        ("INTERVAL '0 days'", "00:00:00"),
        ("INTERVAL '-90 minutes'", "-01:30:00"),
    ],
)
def test_an_interval_is_written_as_postgresql_writes_it(sql: str, text: str) -> None:
    """It read ``MonthDayNano(months=0, days=1, …)`` on the query page and over SQL."""
    from src.query.session import _fetch_arrow, _js_safe

    table = _js_safe(_fetch_arrow(duckdb.connect().sql(f"SELECT {sql} AS i")))
    assert table.column("i").to_pylist() == [text]


def test_postgresql_records_what_its_array_and_bit_columns_are() -> None:
    from src.sources.postgresql.source import PostgreSQLSource

    expression = PostgreSQLSource._COLUMN_TYPE_SQL
    # Run the expression itself over information_schema-shaped rows.
    conn = duckdb.connect()
    rows = conn.execute(
        f"SELECT {expression} FROM (VALUES "
        "('ARRAY', '_int4', NULL), ('bit', 'bit', 4), ('bit', 'bit', 1), "
        "('money', 'money', NULL), ('integer', 'int4', NULL)) "
        "t(data_type, udt_name, character_maximum_length)"
    ).fetchall()
    assert [row[0] for row in rows] == ["int4[]", "bit(4)", "bit", "text (money)", "integer"]
