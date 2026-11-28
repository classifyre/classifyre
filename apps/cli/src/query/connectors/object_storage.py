"""Tables and table files in buckets (S3-compatible, Azure, GCS, a local folder).

The source gives its :class:`~src.utils.lakehouse_tables.TableStorage`: the URI
of a key and the body of the DuckDB secret its scans use. Delta and Iceberg are
read through their scanners, so a query obeys the table's log, never a glob of
its files.
"""

from __future__ import annotations

from typing import Any

from ...utils.duckdb_engine import quote_identifier, sql_literal
from ...utils.sql_files import FILE_FORMATS, file_relation
from .base import BindingError, QueryBinding, SourceContext, TableLocation

#: Formats DuckDB reads natively, by the ``format`` of a location.
#: Keep in sync with ``LAKEHOUSE_FORMATS`` in apps/api/src/data-query/sql-names.ts.
LAKEHOUSE_FORMATS = frozenset({"delta", "iceberg"})


class ObjectStorageBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._storage: Any = None
        self._iceberg_version_guessing = False

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
            if not self._iceberg_version_guessing:
                row = conn.execute(
                    "SELECT current_setting('unsafe_enable_version_guessing')"
                ).fetchone()
                if not (row and bool(row[0])):
                    conn.execute("SET unsafe_enable_version_guessing = true")
                self._iceberg_version_guessing = True
            return f"iceberg_scan({uri}, allow_moved_paths = true)"
        if location.kind == "file":
            if fmt not in FILE_FORMATS:
                raise BindingError(f"{fmt or 'These'} files cannot be queried with SQL yet.")
            return file_relation(conn, fmt, uri)
        raise BindingError(f"Unknown table location kind '{location.kind}'.")

    def local_paths(self) -> list[str]:
        """A local folder's root; a bucket's URL is remote, so not listed."""
        if self._storage is None:
            return []
        root = str(self._storage.uri(""))
        return [] if "://" in root else [root]
