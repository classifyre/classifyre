"""The files SQL can read from a bucket or folder, and how it reads them.

One definition for the query engine and the scan (docs/prd/DQ-data-query.md).
The scan records the columns *this* relation returns, so what the catalog, a
SQL connection and column masks say a file has is what a query gets. A reader
added here is picked up by both; a format listed here without recorded columns
is a table a SQL connection cannot serve.
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any

from .duckdb_engine import connect, load_extension, quote_identifier, sql_literal

#: Geospatial files, read with the ``spatial`` extension (``ST_Read``); geometries
#: come out as WKT text, so no spatial function has to be allowed in SQL.
SPATIAL_FORMATS = frozenset({"geojson", "fgb", "dbf"})

#: Keep in sync with ``FILE_FORMATS`` in apps/api/src/data-query/sql-names.ts
#: (``json`` here is read via ``read_json_auto``).
FILE_FORMATS = frozenset({"parquet", "csv", "tsv", "jsonl", "json", "avro", *SPATIAL_FORMATS})

#: Mirrors ``FILE_FORMATS`` / ``FILE_FORMATS_BY_EXTENSION`` in sql-names.ts: the
#: MIME type decides, else the extension.
FORMATS_BY_MIME_TYPE = {
    "application/parquet": "parquet",
    "application/vnd.apache.parquet": "parquet",
    "application/x-parquet": "parquet",
    "text/csv": "csv",
    "application/csv": "csv",
    "text/tab-separated-values": "tsv",
    "application/x-ndjson": "jsonl",
    "application/jsonl": "jsonl",
    "application/x-jsonlines": "jsonl",
    "application/avro": "avro",
    "application/vnd.apache.avro": "avro",
    "application/json": "json",
    "application/geo+json": "geojson",
    "application/vnd.flatgeobuf": "fgb",
    "application/vnd.dbf": "dbf",
}
FORMATS_BY_EXTENSION = {
    "parquet": "parquet",
    "csv": "csv",
    "tsv": "tsv",
    "jsonl": "jsonl",
    "ndjson": "jsonl",
    "avro": "avro",
    "json": "json",
    "geojson": "geojson",
    "fgb": "fgb",
    "dbf": "dbf",
}

#: Formats a prefix of the file is enough to describe: one record per line.
LINE_FORMATS = frozenset({"csv", "tsv", "jsonl"})

#: The extension a temporary copy needs: GDAL picks a driver by it.
_SUFFIXES = {name: f".{name}" for name in FILE_FORMATS}

_EXTENSIONS = {"avro": "avro", **dict.fromkeys(SPATIAL_FORMATS, "spatial")}


def sql_file_format(mime_type: str | None, object_key: str) -> str | None:
    """The format SQL would read this file as; None when it cannot be queried."""
    mime = (mime_type or "").split(";", 1)[0].strip().lower()
    if mime in FORMATS_BY_MIME_TYPE:
        return FORMATS_BY_MIME_TYPE[mime]
    extension = PurePosixPath(object_key).suffix.lower().lstrip(".")
    return FORMATS_BY_EXTENSION.get(extension)


def scan_reader_state(metadata: Any) -> dict[str, str]:
    """Marks, per asset, a change in how its content is read, for the scan cache.

    A table file's columns are recorded while it is processed (and a ``.json``
    one is scanned row by row), so one scanned before that is read again though
    neither it nor any detector changed.
    """
    if not isinstance(metadata, dict):
        return {}
    key = metadata.get("object_key")
    if not isinstance(key, str) or "#" in key:
        return {}
    mime = metadata.get("mime_type")
    fmt = sql_file_format(mime if isinstance(mime, str) else None, key)
    if fmt is None or fmt in ("parquet", "avro"):
        return {}
    return {"reader::sql-table": "1"}


def suffix_for(fmt: str) -> str:
    return _SUFFIXES.get(fmt, "")


def file_relation(conn: Any, fmt: str, uri: str) -> str:
    """The SQL relation reading the file at ``uri`` (a quoted literal).

    ``conn`` gets whatever extension the format needs.
    """
    extension = _EXTENSIONS.get(fmt)
    if extension:
        load_extension(conn, extension)
    if fmt == "parquet":
        return f"read_parquet({uri})"
    if fmt == "csv":
        return f"read_csv({uri}, auto_detect = true)"
    if fmt == "tsv":
        return f"read_csv({uri}, auto_detect = true, delim = '\\t')"
    if fmt == "jsonl":
        return f"read_json({uri}, format = 'newline_delimited')"
    if fmt == "json":
        return f"read_json_auto({uri})"
    if fmt == "avro":
        return f"read_avro({uri})"
    if fmt in SPATIAL_FORMATS:
        return _spatial(conn, uri)
    raise ValueError(f"{fmt or 'These'} files cannot be queried with SQL yet.")


def _spatial(conn: Any, uri: str) -> str:
    """``ST_Read`` with every geometry column turned into WKT text.

    The raw column is a binary geometry only spatial functions can read;
    as text it shows in a result and compares like any string.
    """
    source = f"ST_Read({uri})"
    columns = conn.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()
    geometries = [name for name, kind, *_ in columns if str(kind).upper().startswith("GEOMETRY")]
    if not geometries:
        return source
    replaced = ", ".join(
        f"ST_AsText({quote_identifier(name)}) AS {quote_identifier(name)}" for name in geometries
    )
    return f"(SELECT * REPLACE ({replaced}) FROM {source})"


def describe_file(path: str, fmt: str) -> list[tuple[str, str]]:
    """``[(column, SQL type), …]`` a query of the local file ``path`` returns."""
    conn = connect()
    try:
        relation = file_relation(conn, fmt, sql_literal(path))
        rows = conn.execute(f"DESCRIBE SELECT * FROM {relation}").fetchall()
    finally:
        conn.close()
    return [(str(row[0]), str(row[1])) for row in rows]
