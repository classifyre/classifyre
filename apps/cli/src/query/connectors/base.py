"""The read interface every queryable source type implements (docs/prd/QC-query-connectors.md §5.2).

A :class:`QueryBinding` turns one table of one source, as the API located it
(:class:`TableLocation`), into a DuckDB relation the session puts a masked,
filtered view over. It is made per source per query and reads its source's
recipe through a :class:`SourceContext` (the session's
:class:`~src.query.bindings.SourceBinding`), so it never holds credentials of
its own and never outlives the query.

Bindings live in ``src/query/connectors/<type>.py`` rather than next to the
scan code in ``src/sources/<type>/``: importing a source package imports
``src.sources`` and the scan machinery (about 0.6 s and 380 modules, measured
2026-11-21), which a query that does not need the source's Python client must
not pay. A binding that does need it (an attached catalog, a bucket's
storage, a connector) asks the context for the instance, which imports it
then.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from ...utils.duckdb_engine import load_extension

if TYPE_CHECKING:
    from .arrow import ConnectorError, ScanStats


class BindingError(RuntimeError):
    """A source could not be reached or a table location is not readable."""


@dataclass(frozen=True)
class TableLocation:
    """Where one table lives, from the request (built by the API)."""

    kind: str  # "catalog" | "lakehouse" | "file" | "dataset"
    database: str | None = None
    schema: str | None = None
    table: str | None = None
    format: str | None = None
    object_key: str | None = None
    version: str | None = None
    #: ODBC: the table as the driver's SQL names it (quoted), as the scan recorded it.
    qualified_name: str | None = None
    #: Connector tables: the columns the scan recorded, ``(name, type)``.
    columns: tuple[tuple[str, str], ...] = ()
    #: Set by the session, not the API: columns the person reads masked,
    #: which no filter may be sent to the source on (QC §5.11, R3).
    withheld: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TableLocation:
        def text(key: str) -> str | None:
            value = data.get(key)
            return str(value) if value not in (None, "") else None

        return cls(
            kind=str(data.get("kind") or ""),
            database=text("database"),
            schema=text("schema"),
            table=text("table"),
            format=(text("format") or "").lower() or None,
            object_key=text("objectKey"),
            version=text("version"),
            qualified_name=text("qualifiedName"),
            columns=_columns(data.get("columns")),
        )


def _columns(value: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list):
        return ()
    out: list[tuple[str, str]] = []
    for column in value:
        if isinstance(column, dict) and isinstance(column.get("name"), str) and column["name"]:
            kind = column.get("type")
            out.append((column["name"], kind if isinstance(kind, str) else ""))
    return tuple(out)


class SourceContext(Protocol):
    """What a binding may know about its source: the request's entry for it."""

    alias: str
    index: int
    recipe: dict[str, Any]
    source_id: str
    source_type: str
    #: ``time.monotonic()`` by which the query must be done.
    deadline: float

    @property
    def hidden(self) -> str:
        """The name the source is attached under (``__src_<n>``), never typeable."""
        ...

    def label(self) -> str: ...

    def section(self, name: str) -> dict[str, Any]: ...

    def connection_option(self, name: str) -> Any: ...

    def instance(self) -> Any:
        """The source's scan class, built from the recipe on first use."""
        ...


class QueryBinding(ABC):
    """How the tables of one source are read by one query."""

    #: The tier the source type declares in ``x-query`` (checked by
    #: tests/test_query_manifest.py).
    tier: ClassVar[str]
    #: Optional dependency groups the binding's source client needs
    #: (``uv sync --group``); the query worker installs them before it forks
    #: a query, so no query syncs the environment under another.
    dependency_groups: ClassVar[tuple[str, ...]] = ()

    def __init__(self, source: SourceContext) -> None:
        self.source = source

    def load(self, conn: Any, extension: str) -> None:
        """Load a DuckDB extension (the baked copy first, see ``duckdb_engine``)."""
        load_extension(conn, extension)

    def label(self) -> str | None:
        """What the source is called in errors, when the type knows better
        than its SQL name (``mysql://host:port/``). None: the SQL name."""
        return None

    @abstractmethod
    def relation(self, conn: Any, location: TableLocation) -> str:
        """The DuckDB expression a view over this table selects from."""

    def explain(self, exc: Exception) -> str | None:
        """What a failed read of this source's table means, when it is known."""
        return None

    def local_paths(self) -> list[str]:
        """Local directories or files DuckDB itself reads for this source's
        tables once the query runs. Every other local path is closed to the
        query (``enable_external_access = false``, see ``QuerySession``);
        remote URLs stay open, scoped by the source's own credentials."""
        return []

    def stats(self, relation: str) -> ScanStats | None:
        """What reading ``relation`` cost (``ScanStats``); None for tables
        DuckDB reads itself."""
        return None

    def failure(self, relation: str) -> ConnectorError | None:
        """The error a scan of ``relation`` raised, as its source said it
        (``ConnectorError``); None for tables DuckDB reads itself."""
        return None

    def close(self) -> None:
        """Release what the binding made (temporary files); the session closes DuckDB."""

    # ── helpers ────────────────────────────────────────────────────────

    def require(self, location: TableLocation, *fields: str) -> list[str]:
        """The location's fields, or a refusal that asks for a new scan."""
        values = [getattr(location, name) for name in fields]
        missing = [name for name, value in zip(fields, values, strict=True) if not value]
        if missing:
            raise BindingError(
                f"Could not open {self.source.label()}: the table's location is incomplete "
                f"(needs {', '.join(missing)}): run a scan of the source again."
            )
        return [str(value) for value in values]


def endpoint_label(source: SourceContext, scheme: str) -> str | None:
    """``scheme://host:port/`` from the recipe's host and port, like the scan's
    ``_source_label`` (no database): the query and the scan then name a failing
    endpoint the same way."""
    required = source.section("required")
    host = str(required.get("host") or "").strip()
    port = str(required.get("port") or "").strip()
    if not host:
        return None
    return f"{scheme}://{host}:{port}/" if port else f"{scheme}://{host}/"
