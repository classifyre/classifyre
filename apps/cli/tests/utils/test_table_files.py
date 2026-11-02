"""Table files read as rows: CSV/TSV dialects, JSON lines, Avro, ORC, Vortex,
XLSX, database files and single-layer geo formats.

Avro, Vortex and the geo formats need a DuckDB extension; those tests skip when
it cannot be installed (no network), the rest run on DuckDB's built-in readers,
pyarrow, openpyxl and the standard library.
"""

from __future__ import annotations

import io
import json
import sqlite3
from pathlib import Path

import duckdb
import pytest

from src.utils.duckdb_engine import DuckDBExtensionUnavailableError, connect, load_extension
from src.utils.embedded_files import iter_embedded_files
from src.utils.file_metadata import extract_file_metadata
from src.utils.file_parser import (
    count_tabular_rows,
    extract_text,
    is_tabular_mime_type,
    iter_file_pages,
    resolve_mime_type,
)
from src.utils.table_files import (
    AVRO_MIME_TYPE,
    DUCKDB_MIME_TYPE,
    FLATGEOBUF_MIME_TYPE,
    GEOJSON_MIME_TYPE,
    GEOPACKAGE_MIME_TYPE,
    NDJSON_MIME_TYPE,
    ORC_MIME_TYPE,
    SQLITE_MIME_TYPE,
    VORTEX_MIME_TYPE,
    XLSX_MIME_TYPE,
)

_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + b"\x00" * 64


def _pages(data: bytes, name: str, **kwargs: object) -> list[str]:
    mime = resolve_mime_type(data, file_name=name)
    return list(iter_file_pages(data, mime, file_name=name, **kwargs))  # type: ignore[arg-type]


def _need_extension(name: str) -> None:
    conn = connect()
    try:
        load_extension(conn, name)
    except DuckDBExtensionUnavailableError as exc:
        pytest.skip(str(exc))
    finally:
        conn.close()


def _duckdb_export(path: Path, select: str, options: str, extension: str | None = None) -> bytes:
    conn = duckdb.connect()
    try:
        if extension:
            conn.execute(f"LOAD {extension}")
        conn.execute(f"COPY ({select}) TO '{path.as_posix()}' ({options})")
    finally:
        conn.close()
    return path.read_bytes()


# ── CSV / TSV ────────────────────────────────────────────────────────────


def test_tsv_is_split_on_tabs() -> None:
    pages = _pages(b"name\tiban\nPip Marlow\tAT611904300234573201\n", "people.tsv")
    assert pages == ["row_1:\n  name: Pip Marlow\n  iban: AT611904300234573201\n"]


def test_semicolon_csv_gets_its_real_columns() -> None:
    pages = _pages(b"name;iban\nPip Marlow;AT611904300234573201\n", "export.csv")
    assert "  iban: AT611904300234573201" in pages[0]


def test_csv_preamble_above_the_header_is_found() -> None:
    data = (
        "Report generated 2026-01-01\nname;city;note\n"
        'Jürgen Vale;Wien;"line one\nline two"\nAnna Brook;Graz;ok\n'
    ).encode("latin-1")
    pages = _pages(data, "report.csv")
    assert len(pages) == 2
    assert "  name: Jürgen Vale" in pages[0]
    assert "  note: line one\n    line two" in pages[0]


def test_csv_values_stay_text() -> None:
    pages = _pages(b"id,phone\n00123,06641234567\n", "ids.csv")
    assert "  id: 00123" in pages[0]
    assert "  phone: 06641234567" in pages[0]


def test_ragged_csv_keeps_every_value() -> None:
    text = "".join(_pages(b"a,b,c\n1,2\n3,4,5,6\n", "ragged.csv"))
    for value in ("1", "2", "3", "4", "5", "6"):
        assert f": {value}" in text


def test_csv_window_is_pushed_down() -> None:
    data = b"n\n" + b"".join(f"{i}\n".encode() for i in range(10))
    assert _pages(data, "n.csv", start_row=4, max_rows=2) == [
        "row_5:\n  n: 4\n",
        "row_6:\n  n: 5\n",
    ]


def test_csv_metadata_reports_sniffed_columns() -> None:
    meta = extract_file_metadata(b"name;iban\nPip;AT61\nLark;AT62\n", "text/csv", file_name="a.csv")
    assert [c["name"] for c in meta["columns"]] == ["name", "iban"]
    assert meta["row_count"] == 2


# ── JSON lines ───────────────────────────────────────────────────────────


def test_ndjson_rows_render_nested_values_as_json() -> None:
    lines = [{"user": {"name": "Pip"}, "n": 1}] * 3 + [
        {"user": {"name": "Lark"}, "ssn": "078-05-1120"}
    ]
    data = "\n".join(json.dumps(line) for line in lines).encode()
    assert resolve_mime_type(data, file_name="events.jsonl") == NDJSON_MIME_TYPE
    pages = _pages(data, "events.jsonl")
    assert len(pages) == 4
    assert '  user: {"name": "Pip"}' in pages[0]
    # A key first seen in the last record is still read.
    assert "  ssn: 078-05-1120" in pages[3]


# ── Avro / ORC / Vortex ──────────────────────────────────────────────────


def test_avro_rows(tmp_path: Path) -> None:
    _need_extension("avro")
    data = _duckdb_export(
        tmp_path / "a.avro",
        "SELECT r AS id, 'pip' || r || '@example.com' AS email FROM range(3) t(r)",
        "FORMAT avro",
        "avro",
    )
    assert resolve_mime_type(data, file_name="x.bin") == AVRO_MIME_TYPE
    pages = _pages(data, "a.avro")
    assert len(pages) == 3
    assert "  email: pip2@example.com" in pages[2]
    assert is_tabular_mime_type(AVRO_MIME_TYPE)


def test_orc_rows_and_footer_row_count() -> None:
    pa = pytest.importorskip("pyarrow")
    orc = pytest.importorskip("pyarrow.orc")
    buffer = io.BytesIO()
    orc.write_table(pa.table({"id": list(range(5)), "name": [f"n{i}" for i in range(5)]}), buffer)
    data = buffer.getvalue()
    assert resolve_mime_type(data, file_name="t.orc") == ORC_MIME_TYPE
    assert count_tabular_rows(data, ORC_MIME_TYPE) == 5
    assert _pages(data, "t.orc", start_row=3, max_rows=1) == ["row_4:\n  id: 3\n  name: n3\n"]


def test_vortex_rows(tmp_path: Path) -> None:
    _need_extension("vortex")
    data = _duckdb_export(
        tmp_path / "a.vortex",
        "SELECT 1 AS id, 'pip@example.com' AS email",
        "FORMAT vortex",
        "vortex",
    )
    assert resolve_mime_type(data, file_name="x.bin") == VORTEX_MIME_TYPE
    assert _pages(data, "a.vortex") == ["row_1:\n  id: 1\n  email: pip@example.com\n"]


# ── XLSX ─────────────────────────────────────────────────────────────────


def _workbook() -> bytes:
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Staff"
    sheet.append(["Quarterly staff report"])
    sheet.append([])
    sheet.append(["name", "phone", "salary"])
    sheet.append(["Pip Marlow", "06641234567", 1000])
    sheet.append([])
    sheet.append(["Zephyr Quill", "00436601112223", 2000])
    second = workbook.create_sheet("Notes")
    second.append(["Call Lark Brook back"])
    workbook.create_sheet("Empty")
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_xlsx_header_is_found_under_a_title_row() -> None:
    pages = _pages(_workbook(), "staff.xlsx")
    text = "".join(pages)
    assert "  Staff.phone: 06641234567" in text
    assert "  Staff.salary: 2000" in text
    # The title row is content too, and a lone row of text is not a header.
    assert "Quarterly staff report" in text
    assert "  Notes.A: Call Lark Brook back" in text
    assert len(pages) == 4


def test_xlsx_window_spans_sheets() -> None:
    pages = _pages(_workbook(), "staff.xlsx", start_row=2, max_rows=2)
    assert pages[0].startswith("row_3:\n  Staff.name: Zephyr Quill")
    assert pages[1].startswith("row_4:\n  Notes.A: Call Lark Brook back")


def test_xlsx_extract_text_matches_the_pages() -> None:
    text, error = extract_text(_workbook(), XLSX_MIME_TYPE)
    assert error is None
    assert "Staff.phone: 06641234567" in text


# ── Database files ───────────────────────────────────────────────────────


def _sqlite_file(tmp_path: Path, name: str = "app.sqlite") -> bytes:
    path = tmp_path / name
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE customers (id INTEGER, email TEXT, contract BLOB)")
    conn.execute("INSERT INTO customers VALUES (1, 'pip@example.com', ?)", (_PDF,))
    # SQLite types values, not columns: a string in an INTEGER column is legal.
    conn.execute("INSERT INTO customers VALUES ('two', 'lark@example.com', NULL)")
    conn.execute("CREATE TABLE notes (body TEXT)")
    conn.execute("INSERT INTO notes VALUES ('ring Zephyr Quill')")
    conn.execute("CREATE VIEW v AS SELECT * FROM customers")
    conn.commit()
    conn.close()
    return path.read_bytes()


def test_sqlite_tables_are_read_as_one_row_axis(tmp_path: Path) -> None:
    data = _sqlite_file(tmp_path)
    assert resolve_mime_type(data, file_name="app.db") == SQLITE_MIME_TYPE
    pages = _pages(data, "app.db")
    assert len(pages) == 3  # two customers + one note; the view is not read
    assert "  customers.email: pip@example.com" in pages[0]
    assert "  customers.contract: <application/pdf" in pages[0]
    assert "  customers.id: two" in pages[1]
    assert pages[2] == "row_3:\n  notes.body: ring Zephyr Quill\n"


def test_sqlite_blob_files_become_child_assets(tmp_path: Path) -> None:
    files = list(iter_embedded_files(_sqlite_file(tmp_path), SQLITE_MIME_TYPE))
    assert [(f.location, f.mime_type) for f in files] == [
        ("row=1;col=customers.contract", "application/pdf")
    ]


def test_sqlite_metadata_columns(tmp_path: Path) -> None:
    meta = extract_file_metadata(_sqlite_file(tmp_path), SQLITE_MIME_TYPE, file_name="app.sqlite")
    assert meta["row_count"] == 3
    assert [c["name"] for c in meta["columns"]] == [
        "customers.id",
        "customers.email",
        "customers.contract",
        "notes.body",
    ]


def test_geopackage_skips_its_own_metadata_tables(tmp_path: Path) -> None:
    path = tmp_path / "places.gpkg"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE gpkg_contents (table_name TEXT)")
    conn.execute("INSERT INTO gpkg_contents VALUES ('places')")
    conn.execute("CREATE TABLE places (name TEXT, geom BLOB)")
    conn.execute("INSERT INTO places VALUES ('Home of Pip Marlow', x'4750000100000000')")
    conn.commit()
    conn.close()
    data = path.read_bytes()
    assert resolve_mime_type(data, file_name="places.gpkg") == GEOPACKAGE_MIME_TYPE
    pages = _pages(data, "places.gpkg")
    assert len(pages) == 1
    assert "  places.name: Home of Pip Marlow" in pages[0]


def test_duckdb_file_reads_tables_only(tmp_path: Path) -> None:
    path = tmp_path / "warehouse.duckdb"
    secret = tmp_path / "secret.txt"
    secret.write_text("do-not-read")
    conn = duckdb.connect(path.as_posix())
    conn.execute("CREATE TABLE people AS SELECT 'pip@example.com' AS email")
    # A view in an untrusted file could name any other file; it is never read.
    conn.execute(f"CREATE VIEW leak AS SELECT * FROM read_text('{secret.as_posix()}')")
    conn.close()
    data = path.read_bytes()
    assert resolve_mime_type(data, file_name="warehouse.bin") == DUCKDB_MIME_TYPE
    text = "".join(_pages(data, "warehouse.duckdb"))
    assert "people.email: pip@example.com" in text
    assert "do-not-read" not in text


# ── Geospatial ───────────────────────────────────────────────────────────


def test_flatgeobuf_geometry_is_wkt(tmp_path: Path) -> None:
    _need_extension("spatial")
    data = _duckdb_export(
        tmp_path / "p.fgb",
        "SELECT 'Pip Marlow' AS name, ST_Point(16.37, 48.21) AS geom",
        "FORMAT gdal, DRIVER 'FlatGeobuf'",
        "spatial",
    )
    assert resolve_mime_type(data, file_name="x.bin") == FLATGEOBUF_MIME_TYPE
    text = "".join(_pages(data, "p.fgb"))
    assert "name: Pip Marlow" in text
    assert "geom: POINT (16.37 48.21)" in text


def test_geojson_features_are_rows() -> None:
    _need_extension("spatial")
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"owner": "Zephyr Quill"},
                "geometry": {"type": "Point", "coordinates": [16.37, 48.21]},
            }
        ],
    }
    data = json.dumps(collection).encode()
    assert resolve_mime_type(data, file_name="parcels.geojson") == GEOJSON_MIME_TYPE
    text = "".join(_pages(data, "parcels.geojson"))
    assert "owner: Zephyr Quill" in text
    assert "POINT (16.37 48.21)" in text


def test_db_extension_is_sqlite_only_when_the_header_says_so(tmp_path: Path) -> None:
    assert resolve_mime_type(_sqlite_file(tmp_path), file_name="cache.db") == SQLITE_MIME_TYPE
    # Windows' thumbnail cache is an OLE compound file, not a database.
    thumbs = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 504
    assert resolve_mime_type(thumbs, file_name="Thumbs.db") != SQLITE_MIME_TYPE
    assert resolve_mime_type(b"\x01\x02\x03\x04" * 64, file_name="random.db") == (
        "application/octet-stream"
    )
