"""How each source of a query reaches DuckDB.

A :class:`SourceBinding` is one entry of the request's ``sources``: the
recipe, the alias the person typed, and the hidden name (``__src_<n>``) it is
attached under, which the SQL gate never lets a person type. What reads its
tables is the source type's :class:`~src.query.connectors.QueryBinding`
(``src/query/connectors/<type>.py``), chosen from the ``x-query`` declaration
in the source schema (docs/prd/QC-query-connectors.md §5.1, §5.2):

* PostgreSQL and MySQL: DuckDB's own scanners, read-only, from the recipe
  fields their connectors read (no Python driver needed).
* Databricks: ``unity_catalog`` with the token the scan authenticates with.
* ODBC: the ``odbc_scanner`` extension over the source's connection string.
* Iceberg REST and DuckLake: attached exactly as their scans do.
* Buckets (S3-compatible, Azure, GCS, local folder): the source's
  :class:`~src.utils.lakehouse_tables.TableStorage`.
* Connectors (Meilisearch, Neo4j): read live through the source's client,
  as Arrow (:mod:`.connectors.arrow`).
"""

from __future__ import annotations

import math
from typing import Any

from .connectors import BindingError, QueryBinding, TableLocation, binding_class, declared_sources
from .connectors.arrow import ConnectorError, ScanStats
from .connectors.object_storage import FILE_FORMATS, LAKEHOUSE_FORMATS, SPATIAL_FORMATS

__all__ = [
    "ATTACHED_CATALOG_TYPES",
    "FILE_FORMATS",
    "LAKEHOUSE_FORMATS",
    "OBJECT_STORAGE_TYPES",
    "QUERYABLE_SOURCE_TYPES",
    "SPATIAL_FORMATS",
    "BindingError",
    "ConnectorError",
    "SourceBinding",
    "TableLocation",
]

#: The source types a query can read: exactly those ``x-query`` declares
#: (the API reads the same declaration, apps/api/src/data-query/sql-names.ts).
QUERYABLE_SOURCE_TYPES = frozenset(declared_sources())
OBJECT_STORAGE_TYPES = frozenset(
    t for t, d in declared_sources().items() if d.address == "object_storage"
)
ATTACHED_CATALOG_TYPES = frozenset(
    t for t, d in declared_sources().items() if d.address == "catalog"
)


class SourceBinding:
    """One source of the request, attached to a session's connection on first use."""

    def __init__(self, alias: str, index: int, recipe: dict[str, Any], source_id: str) -> None:
        self.alias = alias
        self.index = index
        self.recipe = recipe
        self.source_id = source_id
        self.source_type = str(recipe.get("type") or "").upper()
        self._source: Any = None
        self._reader: QueryBinding | None = None
        #: Set by the session: when the query must be done.
        self.deadline = math.inf

    @property
    def hidden(self) -> str:
        return f"__src_{self.index}"

    # ── what a binding may read (``SourceContext``) ────────────────────

    def section(self, name: str) -> dict[str, Any]:
        value = self.recipe.get(name)
        return value if isinstance(value, dict) else {}

    def connection_option(self, name: str) -> Any:
        connection = self.section("optional").get("connection")
        return connection.get(name) if isinstance(connection, dict) else None

    def instance(self) -> Any:
        if self._source is None:
            from ..sources import get_source

            self._source = get_source(self.recipe, source_id=self.source_id, runner_id="query")
        return self._source

    # ── the source's reader ────────────────────────────────────────────

    def _binding(self) -> QueryBinding:
        if self._reader is None:
            self._reader = binding_class(self.source_type)(self)
        return self._reader

    def _known_binding(self) -> QueryBinding | None:
        """The reader, or None for a type nothing reads (labels and explanations
        must not fail for it: the refusal comes from :meth:`relation`)."""
        try:
            return self._binding()
        except BindingError:
            return None

    def label(self) -> str:
        """What the source is called in errors: `mysql://host:port/`.

        Mirrors the scan's ``_source_label``, so the query and the scan name the
        same failing endpoint the same way. A source without a host (files,
        catalogs) is called by its SQL name, the one the person typed.
        """
        binding = self._known_binding()
        return (binding.label() if binding else None) or self.alias

    def relation(self, conn: Any, location: TableLocation) -> str:
        """The DuckDB expression a view over this table selects from."""
        return self._binding().relation(conn, location)

    def explain(self, exc: Exception) -> str | None:
        """What a failed read of this source's table means, when it is known."""
        binding = self._known_binding()
        return binding.explain(exc) if binding else None

    def local_paths(self) -> list[str]:
        """Local paths DuckDB reads for this source (none until it is opened)."""
        return self._reader.local_paths() if self._reader is not None else []

    def scan_stats(self, relation: str) -> ScanStats | None:
        """A connector table's reads (None for tables DuckDB reads itself)."""
        return self._reader.stats(relation) if self._reader else None

    def failure(self, relation: str) -> ConnectorError | None:
        """Why a connector's scan of that table failed, as it said it."""
        return self._reader.failure(relation) if self._reader else None

    def close(self) -> None:
        if self._reader is not None:
            self._reader.close()
        if self._source is not None:
            try:
                self._source.cleanup()
            except Exception:  # pragma: no cover - best effort
                pass
