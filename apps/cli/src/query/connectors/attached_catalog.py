"""Iceberg REST and DuckLake: attached exactly as their scans attach them.

The scan's own ``DuckDBAttachedSource._attach`` runs under the query's alias
(``_attach_alias``; secret names are prefixed with it), so several catalogs fit
in one query.
"""

from __future__ import annotations

from typing import Any

from ...utils.duckdb_engine import quote_identifier
from .base import QueryBinding, SourceContext, TableLocation


class AttachedCatalogBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._alias: str | None = None

    def relation(self, conn: Any, location: TableLocation) -> str:
        schema, table = self.require(location, "schema", "table")
        if self._alias is None:
            source = self.source.instance()
            source._attach_alias = self.source.hidden
            source._attach(conn)
            self._alias = self.source.hidden
        return ".".join(quote_identifier(part) for part in (self._alias, schema, table))

    def local_paths(self) -> list[str]:
        """A DuckLake's local data path (its catalog file DuckDB already holds
        open; the session adds every attached database's file)."""
        if self._alias is None:
            return []
        reader = getattr(self.source.instance(), "_connection", None)
        data_path = reader("data_path") if callable(reader) else None
        return [str(data_path)] if data_path and "://" not in str(data_path) else []
