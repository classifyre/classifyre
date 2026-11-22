"""Tables and table files in buckets (S3-compatible, Azure, GCS, a local folder).

The source gives its :class:`~src.utils.lakehouse_tables.TableStorage`: the URI
of a key and the body of the DuckDB secret its scans use. Delta and Iceberg are
read through their scanners, so a query obeys the table's log, never a glob of
its files.
"""

from __future__ import annotations

from typing import Any

from ...utils.duckdb_engine import quote_identifier, sql_literal
from .base import BindingError, QueryBinding, SourceContext, TableLocation

#: Formats DuckDB reads natively, by the ``format`` of a location.
#: Keep in sync with ``LAKEHOUSE_FORMATS`` in apps/api/src/data-query/sql-names.ts.
LAKEHOUSE_FORMATS = frozenset({"delta", "iceberg"})
#: Geospatial files, read with the ``spatial`` extension (``ST_Read``); geometries
#: come out as WKT text, so no spatial function has to be allowed in SQL.
SPATIAL_FORMATS = frozenset({"geojson", "fgb", "dbf"})
#: Keep in sync with ``FILE_FORMATS`` in apps/api/src/data-query/sql-names.ts
#: (``json`` here is read via ``read_json_auto``).
FILE_FORMATS = frozenset({"parquet", "csv", "tsv", "jsonl", "json", "avro", *SPATIAL_FORMATS})


class ObjectStorageBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._storage: Any = None

    def relation(self, conn: Any, location: TableLocation) -> str:
        (key,) = self.require(location, "object_key")
        fmt = location.format or ""
        if self._storage is None:
            storage = self.source.instance()._lakehouse_storage()
            if storage is None:
                raise BindingError("This source does not give table access to its storage.")
            for extension in storage.duckdb_extensions:
                self.load(conn, extension)
            if storage.duckdb_secret:
                scope = storage.uri("")
                conn.execute(
                    f"CREATE OR REPLACE SECRET {quote_identifier(self.source.hidden + '_storage')} "
                    f"({storage.duckdb_secret}, SCOPE {sql_literal(scope)})"
                )
            self._storage = storage
        uri = sql_literal(self._storage.uri(key))
        if location.kind == "lakehouse":
            if fmt not in LAKEHOUSE_FORMATS:
                raise BindingError(f"{fmt or 'This'} tables cannot be queried with SQL yet.")
            self.load(conn, fmt)
            if fmt == "delta":
                return f"delta_scan({uri})"
            # A query reads the table as it is now, not as the last scan saw
            # it: the version a scan recorded is gone once the table moves on.
            # Without a version-hint file DuckDB finds the newest metadata by
            # listing the root, which it calls "unsafe" because a writer could
            # be mid-commit; for a read-only query that is the right trade.
            conn.execute("SET unsafe_enable_version_guessing = true")
            return f"iceberg_scan({uri}, allow_moved_paths = true)"
        if location.kind == "file":
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
                self.load(conn, "avro")
                return f"read_avro({uri})"
            if fmt in SPATIAL_FORMATS:
                return self._spatial(conn, uri)
            raise BindingError(f"{fmt or 'These'} files cannot be queried with SQL yet.")
        raise BindingError(f"Unknown table location kind '{location.kind}'.")

    def local_paths(self) -> list[str]:
        """A local folder's root; a bucket's URL is remote, so not listed."""
        if self._storage is None:
            return []
        root = str(self._storage.uri(""))
        return [] if "://" in root else [root]

    def _spatial(self, conn: Any, uri: str) -> str:
        """``ST_Read`` with every geometry column turned into WKT text.

        The raw column is a binary geometry only spatial functions can read;
        as text it shows in a result and compares like any string.
        """
        self.load(conn, "spatial")
        source = f"ST_Read({uri})"
        columns = conn.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()
        geometries = [
            name for name, kind, *_ in columns if str(kind).upper().startswith("GEOMETRY")
        ]
        if not geometries:
            return source
        replaced = ", ".join(
            f"ST_AsText({quote_identifier(name)}) AS {quote_identifier(name)}"
            for name in geometries
        )
        return f"(SELECT * REPLACE ({replaced}) FROM {source})"
