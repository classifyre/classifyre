"""Readers for files that are tables, beyond Parquet and Arrow IPC.

Every reader here hands back Arrow record batches, so a row reads identically
whatever container it came out of: ``file_parser._format_record_row`` renders a
CSV row, an Avro record and a SQLite row the same way it renders a Parquet row,
and a finding quotes the same text for the same data.

Which engine reads what, and why:

* **CSV / TSV, JSON lines, Avro, SQLite and DuckDB database files — DuckDB.** Its
  CSV sniffer finds the delimiter, quoting, header and any preamble lines above
  the header, which the stdlib ``csv`` module does not: a ``;``-separated export
  or a TSV used to reach the detectors as one column. CSV is read with
  ``all_varchar`` so ``0664…`` stays a phone number instead of becoming an int.
* **Vortex — DuckDB** (``vortex`` extension).
* **FlatGeobuf, Shapefile attribute tables (``.dbf``) and GeoJSON — DuckDB** (``spatial``
  extension, GDAL). Attributes become columns and geometry is rendered as WKT, so
  coordinates are text a detector can see. GDAL is restricted to the one driver
  the format needs, so a crafted file cannot make it open another file or a URL.
  These formats hold one layer by definition; KML, GPX and GML can hold several,
  and ``st_read`` returns only the first, so they stay on the XML text path where
  every folder is read. GeoPackage is a SQLite file and is read as one, every
  table included.
* **ORC — pyarrow.** pyarrow reads it through a file handle and records the row
  count in the footer; DuckDB has no ORC reader outside community extensions.
* **XLSX — openpyxl.** DuckDB's ``read_xlsx`` takes the first row as the header,
  and on a sheet with a title row above the real header it returns a single
  column and drops every other column's data. Real workbooks have title rows, so
  the header is found here instead (see ``_header_index``).

Container formats hold several tables — the sheets of a workbook, the tables of
a database file. They are read one after another as one row axis, so a sampling
window (``start_row``/``max_rows``) addresses them like any other payload, and
each batch carries the part it came from so a column reads as ``Sheet.column``.
"""

from __future__ import annotations

import itertools
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any

from .duckdb_engine import (
    connect,
    load_extension,
    materialized_path,
    quote_identifier,
    sql_literal,
)
from .payload import BinarySource, as_binary_io, header

logger = logging.getLogger(__name__)

CSV_MIME_TYPE = "text/csv"
TSV_MIME_TYPE = "text/tab-separated-values"
NDJSON_MIME_TYPE = "application/x-ndjson"
AVRO_MIME_TYPE = "application/vnd.apache.avro"
ORC_MIME_TYPE = "application/vnd.apache.orc"
SQLITE_MIME_TYPE = "application/vnd.sqlite3"
DUCKDB_MIME_TYPE = "application/vnd.duckdb"
XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
VORTEX_MIME_TYPE = "application/vnd.vortex"
GEOPACKAGE_MIME_TYPE = "application/geopackage+sqlite3"
FLATGEOBUF_MIME_TYPE = "application/vnd.flatgeobuf"
GEOJSON_MIME_TYPE = "application/geo+json"
DBF_MIME_TYPE = "application/vnd.dbf"

# Spatial formats → (the only GDAL driver allowed to open them, temp-file suffix).
# The suffix matters: GDAL's Shapefile driver opens a .dbf on its own only when
# the file is named like one. A .shp is not read: GDAL cannot open one without
# the .shx index beside it, and a bucket scan reads each object on its own. The
# .dbf is the part of a shapefile that holds the attribute data.
SPATIAL_DRIVERS = {
    FLATGEOBUF_MIME_TYPE: ("FlatGeobuf", ".fgb"),
    GEOJSON_MIME_TYPE: ("GeoJSON", ".geojson"),
    DBF_MIME_TYPE: ("ESRI Shapefile", ".dbf"),
}

DELIMITED_MIME_TYPES = frozenset({CSV_MIME_TYPE, TSV_MIME_TYPE})
DATABASE_MIME_TYPES = frozenset({SQLITE_MIME_TYPE, GEOPACKAGE_MIME_TYPE, DUCKDB_MIME_TYPE})

# Formats read by this module (Parquet and Arrow IPC stay in file_parser, where
# their range-reading paths live).
TABLE_FILE_MIME_TYPES = frozenset(
    {
        *DELIMITED_MIME_TYPES,
        NDJSON_MIME_TYPE,
        AVRO_MIME_TYPE,
        ORC_MIME_TYPE,
        XLSX_MIME_TYPE,
        VORTEX_MIME_TYPE,
        *DATABASE_MIME_TYPES,
        *SPATIAL_DRIVERS,
    }
)

# Formats whose text a detector can still read when the table reader fails on
# them — a malformed CSV is better scanned as text than not at all.
TEXT_FALLBACK_MIME_TYPES = frozenset({*DELIMITED_MIME_TYPES, NDJSON_MIME_TYPE, GEOJSON_MIME_TYPE})

# The SQLite file header, and DuckDB's magic at byte 8 of its file header.
SQLITE_MAGIC = b"SQLite format 3\x00"
DUCKDB_MAGIC = b"DUCK"
DUCKDB_MAGIC_OFFSET = 8
AVRO_MAGIC = b"Obj\x01"
ORC_MAGIC = b"ORC"
VORTEX_MAGIC = b"VTXF"
FLATGEOBUF_MAGIC = b"fgb\x03fgb"

_DEFAULT_BATCH_ROWS = 1000

# Database tables that hold engine bookkeeping or index structures, never data
# someone put there: SQLite's catalog, GeoPackage's R-tree indexes and its own
# metadata tables (spatial reference systems, contents, extensions).
_SKIPPED_TABLE_RE = re.compile(r"^(sqlite_|rtree_|gpkg_)", re.IGNORECASE)

# How far down a sheet the header is looked for.
_HEADER_SEARCH_ROWS = 20

_UTF8_ENCODINGS = frozenset({"utf-8", "utf8", "ascii"})


class TableFileError(RuntimeError):
    """A table-shaped payload could not be read as a table."""


@dataclass(frozen=True)
class TableBatch:
    """One record batch of a table payload.

    ``first_row`` is the absolute, 0-based row index of the batch's first row
    across the whole payload (all parts), which is what keeps ``row_N`` labels
    and sampling cursors stable whichever window produced them.
    """

    batch: Any
    first_row: int
    part: str | None = None


def iter_table_batches(
    source: BinarySource,
    mime_type: str,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
    batch_rows: int = _DEFAULT_BATCH_ROWS,
) -> Iterator[TableBatch]:
    """Record batches of a table payload, bounded to one row window."""
    begin = max(0, start_row)
    if max_rows is not None and max_rows <= 0:
        return
    if mime_type in DELIMITED_MIME_TYPES:
        yield from _iter_delimited(source, mime_type, begin, max_rows, batch_rows)
    elif mime_type == NDJSON_MIME_TYPE:
        yield from _iter_ndjson(source, begin, max_rows, batch_rows)
    elif mime_type == AVRO_MIME_TYPE:
        yield from _iter_avro(source, begin, max_rows, batch_rows)
    elif mime_type == ORC_MIME_TYPE:
        yield from _iter_orc(source, begin, max_rows)
    elif mime_type == XLSX_MIME_TYPE:
        yield from _iter_xlsx(source, begin, max_rows, batch_rows)
    elif mime_type == VORTEX_MIME_TYPE:
        yield from _iter_vortex(source, begin, max_rows, batch_rows)
    elif mime_type in DATABASE_MIME_TYPES:
        yield from _iter_database(source, mime_type, begin, max_rows, batch_rows)
    elif mime_type in SPATIAL_DRIVERS:
        yield from _iter_spatial(source, mime_type, begin, max_rows, batch_rows)
    else:
        raise TableFileError(f"Not a table file type: {mime_type}")


def count_table_rows(source: BinarySource, mime_type: str) -> int | None:
    """Rows in the payload when the format records it; None means unknown.

    Only ORC qualifies: its footer holds the count. Every other format here would
    need a full pass, which is what the caller is trying to plan around.
    """
    if mime_type != ORC_MIME_TYPE:
        return None
    try:
        orc = _require("pyarrow.orc")
        count = int(orc.ORCFile(as_binary_io(source)).nrows)
    except Exception as exc:
        logger.debug("ORC row count unavailable: %s", exc)
        return None
    finally:
        _rewind(source)
    return count


def table_schema(source: BinarySource, mime_type: str) -> tuple[list[tuple[str, str]], int]:
    """``([(column, type), …], row_count)`` for asset metadata.

    Reads the whole payload: metadata is gathered where the bytes are already in
    hand, and a count from the rows themselves is the only one every format
    here can give. Container formats name their columns ``part.column``.
    """
    columns: list[tuple[str, str]] = []
    rows = 0
    seen_parts: set[str | None] = set()
    for item in iter_table_batches(source, mime_type, batch_rows=10_000):
        if item.part not in seen_parts:
            seen_parts.add(item.part)
            for field in item.batch.schema:
                name = f"{item.part}.{field.name}" if item.part else field.name
                columns.append((name, str(field.type)))
        rows = item.first_row + item.batch.num_rows
    return columns, rows


# ── Delimited text (CSV / TSV) ───────────────────────────────────────────


def _text_encoding(source: BinarySource) -> str | None:
    """The encoding to transcode from, or None when the payload is already UTF-8."""
    from .file_parser import _detect_encoding

    encoding = _detect_encoding(header(source, 65536)).lower()
    return None if encoding in _UTF8_ENCODINGS else encoding


def _iter_delimited(
    source: BinarySource,
    mime_type: str,
    begin: int,
    max_rows: int | None,
    batch_rows: int,
) -> Iterator[TableBatch]:
    with materialized_path(source, suffix=".csv", transcode_from=_text_encoding(source)) as path:
        options = [
            *_sniffed_dialect(path, tsv=mime_type == TSV_MIME_TYPE),
            # Every value as text: `0664…` stays a phone number, `00123` an id.
            "all_varchar = true",
            # Ragged rows are common in exports; pad them instead of failing.
            "null_padding = true",
            "strict_mode = false",
            # The parallel scanner rejects null padding when a quoted value spans
            # lines — an address or a comment cell does. One thread is still fast.
            "parallel = false",
        ]
        query = f"SELECT * FROM read_csv({sql_literal(path)}, {', '.join(options)})"
        yield from _duckdb_batches(query, begin, max_rows, batch_rows)


def _sniffed_dialect(path: str, *, tsv: bool) -> list[str]:
    """``read_csv`` options for the dialect DuckDB's sniffer finds in ``path``.

    Sniffed separately, with types on: the header and any preamble lines above
    it are told apart from data by their types, so a sniff under ``all_varchar``
    takes a "Report generated …" line for the header and the real header for
    data. ``null_padding`` is left off for the same reason: with it on, a short
    preamble line is just a ragged row. The dialect is then fixed and the rows
    read as text.
    """
    sniff_options = ", delim = '\\t'" if tsv else ""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT Delimiter, Quote, Escape, SkipRows, HasHeader "
            f"FROM sniff_csv({sql_literal(path)}, strict_mode = false{sniff_options})"
        ).fetchone()
    except Exception as exc:
        logger.debug("CSV dialect sniff failed for %s: %s", path, exc)
        row = None
    finally:
        conn.close()
    if row is None:
        return ["delim = '\\t'"] if tsv else []
    delimiter, quote, escape, skip_rows, has_header = (
        "" if value == "(empty)" else value for value in row
    )
    skip_rows = int(skip_rows or 0)
    if skip_rows and _skipped_lines_hold_data(path, skip_rows, str(delimiter)):
        # The sniffer skips lines whose width disagrees with the rest. A title
        # has no delimiter; a skipped line that has one is a short header or
        # data row of a ragged file, and skipping it would drop it unread.
        skip_rows, has_header = 0, True
    options = [
        f"delim = {sql_literal(str(delimiter))}",
        f"quote = {sql_literal(str(quote or ''))}",
        f"escape = {sql_literal(str(escape or ''))}",
        f"skip = {skip_rows}",
        f"header = {'true' if has_header else 'false'}",
    ]
    return options


def _skipped_lines_hold_data(path: str, count: int, delimiter: str) -> bool:
    if not delimiter:
        return False
    with open(path, encoding="utf-8", errors="replace", newline="") as handle:
        for _ in range(count):
            line = handle.readline()
            if not line:
                return False
            if delimiter in line:
                return True
    return False


# ── JSON lines ───────────────────────────────────────────────────────────


def _iter_ndjson(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    # sample_size = -1 infers the schema from every record. With the default
    # sample, a key first seen after the sampled records is silently dropped —
    # exactly the late, rare field a detector most needs to see.
    with materialized_path(source, suffix=".jsonl", transcode_from=_text_encoding(source)) as path:
        query = (
            f"SELECT * FROM read_json({sql_literal(path)}, "
            "format = 'newline_delimited', sample_size = -1)"
        )
        yield from _duckdb_batches(query, begin, max_rows, batch_rows)


# ── Avro ─────────────────────────────────────────────────────────────────


def _iter_avro(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    with materialized_path(source, suffix=".avro") as path:
        query = f"SELECT * FROM read_avro({sql_literal(path)})"
        yield from _duckdb_batches(query, begin, max_rows, batch_rows, extension="avro")


# ── Vortex ───────────────────────────────────────────────────────────────


def _iter_vortex(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    with materialized_path(source, suffix=".vortex") as path:
        query = f"SELECT * FROM read_vortex({sql_literal(path)})"
        yield from _duckdb_batches(query, begin, max_rows, batch_rows, extension="vortex")


# ── Spatial (GDAL) ───────────────────────────────────────────────────────


def _iter_spatial(
    source: BinarySource,
    mime_type: str,
    begin: int,
    max_rows: int | None,
    batch_rows: int,
) -> Iterator[TableBatch]:
    driver, suffix = SPATIAL_DRIVERS[mime_type]
    with materialized_path(source, suffix=suffix) as path:
        read = f"st_read({sql_literal(path)}, allowed_drivers = [{sql_literal(driver)}])"
        conn = connect()
        try:
            load_extension(conn, "spatial")
            described = conn.execute(f"DESCRIBE SELECT * FROM {read}").fetchall()
        finally:
            conn.close()
        geometry = [str(row[0]) for row in described if str(row[1]).upper().startswith("GEOMETRY")]
        replace = ", ".join(
            f"ST_AsText({quote_identifier(name)}) AS {quote_identifier(name)}" for name in geometry
        )
        projection = f"* REPLACE ({replace})" if replace else "*"
        query = f"SELECT {projection} FROM {read}"
        yield from _duckdb_batches(query, begin, max_rows, batch_rows, extension="spatial")


def _duckdb_batches(
    query: str,
    begin: int,
    max_rows: int | None,
    batch_rows: int,
    *,
    extension: str | None = None,
    part: str | None = None,
    first_row: int | None = None,
) -> Iterator[TableBatch]:
    """Stream ``query``'s rows ``[begin, begin + max_rows)`` as record batches.

    The window is pushed into the query. Insertion order is preserved (DuckDB's
    default), so ``OFFSET`` addresses the same rows run after run.
    """
    conn = connect()
    try:
        if extension:
            load_extension(conn, extension)
        windowed = f"SELECT * FROM ({query})"
        if max_rows is not None:
            windowed += f" LIMIT {int(max_rows)}"
        if begin:
            windowed += f" OFFSET {int(begin)}"
        reader = conn.sql(windowed).to_arrow_reader(batch_rows)
        row = begin if first_row is None else first_row
        for batch in reader:
            if batch.num_rows:
                yield TableBatch(batch=batch, first_row=row, part=part)
                row += batch.num_rows
    finally:
        conn.close()


# ── ORC ──────────────────────────────────────────────────────────────────


def _iter_orc(source: BinarySource, begin: int, max_rows: int | None) -> Iterator[TableBatch]:
    orc = _require("pyarrow.orc")
    orc_file = orc.ORCFile(as_binary_io(source))
    end = None if max_rows is None else begin + max_rows
    stripe_start = 0
    for index in range(int(orc_file.nstripes)):
        if end is not None and stripe_start >= end:
            return
        stripe = orc_file.read_stripe(index)
        if hasattr(stripe, "to_batches"):
            batches = stripe.to_batches()
        else:
            batches = [stripe]
        for batch in batches:
            batch_start = stripe_start
            stripe_start += batch.num_rows
            if stripe_start <= begin:
                continue
            offset = max(0, begin - batch_start)
            length = batch.num_rows - offset
            if end is not None:
                length = min(length, end - (batch_start + offset))
            if length > 0:
                yield TableBatch(batch=batch.slice(offset, length), first_row=batch_start + offset)


# ── XLSX ─────────────────────────────────────────────────────────────────


def _cell_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.time() == time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, date | time):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value)
    return text if text.strip() else None


def _column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _header_index(rows: list[list[str | None]]) -> int | None:
    """Which of the sheet's first rows is the header, or None for a headerless sheet.

    The header is the first row as wide as the widest of the first rows and made
    entirely of text — a title or a "generated on" line above it is narrower, and
    a data row holds numbers or dates. A sheet whose widest row holds numbers has
    no header row; its columns are named by letter.
    """
    if not rows:
        return None
    widest = max(sum(1 for cell in row if cell is not None) for row in rows)
    if widest == 0:
        return None
    for index, row in enumerate(rows):
        filled = [cell for cell in row if cell is not None]
        if len(filled) < widest:
            continue
        if all(not _looks_numeric(cell) for cell in filled):
            return index
        return None
    return None


def _rows_follow(head: list[list[str | None]], index: int) -> bool:
    if len(head) >= _HEADER_SEARCH_ROWS:
        return True  # the sheet goes on past the rows looked at
    return any(any(cell is not None for cell in row) for row in head[index + 1 :])


_NUMERIC_RE = re.compile(r"^[+-]?(\d+([.,]\d+)?|\d{4}-\d{2}-\d{2}.*)$")


def _looks_numeric(cell: str) -> bool:
    return bool(_NUMERIC_RE.match(cell.strip()))


def _unique_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique: list[str] = []
    for name in names:
        count = seen.get(name, 0)
        seen[name] = count + 1
        unique.append(name if count == 0 else f"{name}_{count + 1}")
    return unique


def _xlsx_batch(
    pa: Any, rows: list[list[str | None]], names: list[str], first_row: int, part: str
) -> TableBatch:
    columns = [
        pa.array([row[i] if i < len(row) else None for row in rows], type=pa.string())
        for i in range(len(names))
    ]
    return TableBatch(
        batch=pa.RecordBatch.from_arrays(columns, names=names), first_row=first_row, part=part
    )


def _iter_xlsx(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    openpyxl = _require("openpyxl")
    pa = _require("pyarrow")
    workbook = openpyxl.load_workbook(as_binary_io(source), read_only=True, data_only=True)
    end = None if max_rows is None else begin + max_rows
    row_index = 0  # absolute data row across sheets
    try:
        for sheet in workbook.worksheets:
            if end is not None and row_index >= end:
                return
            rows_iter = (
                [_cell_text(value) for value in row] for row in sheet.iter_rows(values_only=True)
            )
            head: list[list[str | None]] = []
            for row in rows_iter:
                head.append(row)
                if len(head) >= _HEADER_SEARCH_ROWS:
                    break
            width = max((len(row) for row in head), default=0)
            if width == 0:
                continue
            header_at = _header_index(head)
            if header_at is not None and not _rows_follow(head, header_at):
                # A lone row of text is content, not a header over nothing.
                header_at = None
            letters = [_column_letter(i) for i in range(width)]
            if header_at is None:
                names = letters
                pending = head
            else:
                header_row = head[header_at] + [None] * (width - len(head[header_at]))
                names = [cell or letters[i] for i, cell in enumerate(header_row)]
                # Lines above the header (a title, a "generated on" stamp) are
                # still content: they become rows of their own.
                pending = head[:header_at] + head[header_at + 1 :]
            names = _unique_names(names)

            part = str(sheet.title)
            buffer: list[list[str | None]] = []
            buffer_start = row_index
            for row in itertools.chain(pending, rows_iter):
                if all(cell is None for cell in row):
                    continue
                if row_index < begin:
                    row_index += 1
                    buffer_start = row_index
                    continue
                if end is not None and row_index >= end:
                    break
                buffer.append(row[: len(names)])
                row_index += 1
                if len(buffer) >= batch_rows:
                    yield _xlsx_batch(pa, buffer, names, buffer_start, part)
                    buffer = []
                    buffer_start = row_index
            if buffer:
                yield _xlsx_batch(pa, buffer, names, buffer_start, part)
    finally:
        workbook.close()


# ── SQLite and DuckDB database files ─────────────────────────────────────


def _iter_database(
    source: BinarySource,
    mime_type: str,
    begin: int,
    max_rows: int | None,
    batch_rows: int,
) -> Iterator[TableBatch]:
    if mime_type == DUCKDB_MIME_TYPE:
        yield from _iter_duckdb_file(source, begin, max_rows, batch_rows)
    else:
        yield from _iter_sqlite(source, begin, max_rows, batch_rows)


def _window_parts(
    parts: list[tuple[str, int]], begin: int, max_rows: int | None
) -> Iterator[tuple[str, int, int, int]]:
    """``(part, part_first_row, offset, limit)`` for each table the window touches.

    Tables are read one after another as one row axis; ``parts`` carries each
    table's row count, which is what lets a window skip whole tables unread.
    """
    end = None if max_rows is None else begin + max_rows
    part_start = 0
    for part, count in parts:
        if end is not None and part_start >= end:
            return
        part_end = part_start + count
        if part_end > begin:
            offset = max(0, begin - part_start)
            limit = count - offset
            if end is not None:
                limit = min(limit, end - (part_start + offset))
            if limit > 0:
                yield part, part_start, offset, limit
        part_start = part_end


def _iter_sqlite(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    """SQLite and GeoPackage files, through the standard library's ``sqlite3``.

    Not DuckDB's ``sqlite`` extension: SQLite types each *value*, and the
    extension either fails a table on the first value that disagrees with its
    column's declared type or, told to read everything as text, turns BLOBs
    (GeoPackage geometry, stored files) into invalid UTF-8 strings. ``sqlite3``
    hands back each value as what it is.
    """
    import sqlite3

    pa = _require("pyarrow")
    with materialized_path(source, suffix=".sqlite") as path:
        # Read-only and immutable: no journal, no locks, nothing written beside
        # the temp file. Extension loading is off by default in sqlite3.
        conn = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
        try:
            names = [
                str(row[0])
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
                )
                if not _SKIPPED_TABLE_RE.match(str(row[0]))
            ]
            parts: list[tuple[str, int]] = []
            for name in names:
                try:
                    count = conn.execute(
                        f"SELECT count(*) FROM {quote_identifier(name)}"
                    ).fetchone()
                except sqlite3.Error as exc:
                    # A virtual table whose module is not compiled in, typically.
                    logger.warning("Skipping unreadable SQLite table %s: %s", name, exc)
                    continue
                parts.append((name, int(count[0]) if count else 0))
            for part, part_start, offset, limit in _window_parts(parts, begin, max_rows):
                cursor = conn.execute(
                    f"SELECT * FROM {quote_identifier(part)} LIMIT ? OFFSET ?", (limit, offset)
                )
                columns = _unique_names([str(d[0]) for d in cursor.description or []])
                row = part_start + offset
                while True:
                    rows = cursor.fetchmany(batch_rows)
                    if not rows:
                        break
                    yield TableBatch(
                        batch=_sqlite_batch(pa, columns, rows), first_row=row, part=part
                    )
                    row += len(rows)
        finally:
            conn.close()


def _sqlite_batch(pa: Any, columns: list[str], rows: list[tuple[Any, ...]]) -> Any:
    """A record batch from SQLite rows: byte columns stay binary, the rest text."""
    arrays = []
    for index in range(len(columns)):
        values = [row[index] for row in rows]
        if any(isinstance(value, bytes | memoryview) for value in values):
            arrays.append(
                pa.array(
                    [
                        None
                        if value is None
                        else bytes(value)
                        if isinstance(value, bytes | memoryview)
                        else str(value).encode("utf-8")
                        for value in values
                    ],
                    type=pa.binary(),
                )
            )
        else:
            arrays.append(
                pa.array([None if value is None else str(value) for value in values], pa.string())
            )
    return pa.RecordBatch.from_arrays(arrays, names=columns)


def _iter_duckdb_file(
    source: BinarySource, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    with materialized_path(source, suffix=".duckdb") as path:
        conn = connect()
        try:
            conn.execute(f"ATTACH {sql_literal(path)} AS payload (READ_ONLY)")
            # The file is untrusted. Only base tables are read (never views or
            # macros, which could name other files or URLs), and once it is
            # attached nothing may reach the filesystem or network again.
            conn.execute("SET enable_external_access = false")
            tables = conn.execute(
                "SELECT schema_name, table_name FROM duckdb_tables() "
                "WHERE database_name = 'payload' ORDER BY schema_name, table_name"
            ).fetchall()
            fqns: dict[str, str] = {}
            parts: list[tuple[str, int]] = []
            for schema_name, table_name in tables:
                part = str(table_name) if schema_name == "main" else f"{schema_name}.{table_name}"
                fqn = (
                    f"payload.{quote_identifier(str(schema_name))}."
                    f"{quote_identifier(str(table_name))}"
                )
                count = conn.execute(f"SELECT count(*) FROM {fqn}").fetchone()
                fqns[part] = fqn
                parts.append((part, int(count[0]) if count else 0))
            for part, part_start, offset, limit in _window_parts(parts, begin, max_rows):
                cursor = conn.cursor()
                try:
                    reader = cursor.sql(
                        f"SELECT * FROM {fqns[part]} LIMIT {limit} OFFSET {offset}"
                    ).to_arrow_reader(batch_rows)
                    row = part_start + offset
                    for batch in reader:
                        if batch.num_rows:
                            yield TableBatch(batch=batch, first_row=row, part=part)
                            row += batch.num_rows
                finally:
                    cursor.close()
        finally:
            conn.close()


# ── Helpers ──────────────────────────────────────────────────────────────


def _require(module_name: str) -> Any:
    from .file_parser import _require_file_processing

    return _require_file_processing(module_name)


def _rewind(source: BinarySource) -> None:
    seek = getattr(source, "seek", None)
    if callable(seek):
        try:
            seek(0)
        except Exception:  # pragma: no cover - non-seekable handles never get here
            pass
