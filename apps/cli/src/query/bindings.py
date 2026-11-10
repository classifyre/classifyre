"""How each source reaches DuckDB: an attached catalog, or a scan of a path.

A binding turns one entry of the request's ``tables`` (where an asset's table
lives, as the API knows it from the asset's metadata) into a DuckDB relation
the session can put a view over. Every source is attached under a hidden name
(``__src_<n>``) the SQL gate never lets a person type.

What is reused rather than rewritten:

* Iceberg REST and DuckLake attach exactly as their scans do
  (``DuckDBAttachedSource._attach``), under their own alias.
* Bucket sources (S3-compatible, Azure, GCS, local folder) give their
  :class:`~src.utils.lakehouse_tables.TableStorage`: the URI of a key and the
  body of the DuckDB secret their scans use for Delta and Iceberg.
* PostgreSQL and MySQL are attached with DuckDB's own scanners, read-only, from
  the same recipe fields their connectors read. Their Python drivers are not
  needed, so a query never installs them.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..utils.duckdb_engine import load_extension, quote_identifier, sql_literal

logger = logging.getLogger(__name__)

#: Formats DuckDB reads natively, by the ``format`` of a location.
#: Keep in sync with ``LAKEHOUSE_FORMATS`` in apps/api/src/data-query/sql-names.ts.
LAKEHOUSE_FORMATS = frozenset({"delta", "iceberg"})
#: Keep in sync with ``FILE_FORMATS`` in apps/api/src/data-query/sql-names.ts
#: (``json`` here is read via ``read_json_auto``).
FILE_FORMATS = frozenset({"parquet", "csv", "tsv", "jsonl", "json", "avro"})

OBJECT_STORAGE_TYPES = frozenset(
    {"S3_COMPATIBLE_STORAGE", "AZURE_BLOB_STORAGE", "GOOGLE_CLOUD_STORAGE", "LOCAL_FOLDER"}
)
ATTACHED_CATALOG_TYPES = frozenset({"ICEBERG_REST", "DUCKLAKE"})
#: Keep in sync with ``QUERYABLE_SOURCE_TYPES`` in
#: apps/api/src/data-query/sql-names.ts (same eight values).
QUERYABLE_SOURCE_TYPES = (
    OBJECT_STORAGE_TYPES | ATTACHED_CATALOG_TYPES | frozenset({"POSTGRESQL", "MYSQL"})
)


class BindingError(RuntimeError):
    """A source could not be reached or a table location is not readable."""


@dataclass(frozen=True)
class TableLocation:
    """Where one table lives, from the request (built by the API)."""

    kind: str  # "catalog" | "lakehouse" | "file"
    database: str | None = None
    schema: str | None = None
    table: str | None = None
    format: str | None = None
    object_key: str | None = None
    version: str | None = None

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
        )


def _conninfo(values: dict[str, Any]) -> str:
    """A libpq-style ``key=value`` string for DuckDB's scanners.

    Numbers stay bare (`port=3306`) — the MySQL scanner runs ``port``
    through ``stoi`` and a quoted value fails the whole ATTACH with just
    "stoi" — and so do hostnames (`host=mysql-…`): quoting them makes the
    scanner look up a host *with the quotes in it* ("Unknown server host
    ''mysql-…''"). Anything with whitespace, quotes or backslashes stays
    quoted (usernames, passwords, paths); a value that is only safe bare
    when the scanner says so is left to the caller to coerce.
    """
    parts = []
    for key, value in values.items():
        if value is None or value == "":
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            parts.append(f"{key}={value}")
            continue
        text = str(value)
        if key in ("host", "database", "dbname", "user") and not any(
            ch in text for ch in " \t\n'\"\\"
        ):
            parts.append(f"{key}={text}")
            continue
        escaped = text.replace("\\", "\\\\").replace("'", "\\'")
        parts.append(f"{key}='{escaped}'")
    return " ".join(parts)


class SourceBinding:
    """One source of the request, attached to a session's connection on first use."""

    def __init__(self, alias: str, index: int, recipe: dict[str, Any], source_id: str) -> None:
        self.alias = alias
        self.index = index
        self.recipe = recipe
        self.source_id = source_id
        self.source_type = str(recipe.get("type") or "").upper()
        self._hidden = f"__src_{index}"
        self._attached: dict[str, str] = {}
        self._source: Any = None
        self._storage: Any = None
        self._temp_files: list[Path] = []

    # ── recipe access ──────────────────────────────────────────────────

    def _section(self, name: str) -> dict[str, Any]:
        value = self.recipe.get(name)
        return value if isinstance(value, dict) else {}

    def _connection_option(self, name: str) -> Any:
        connection = self._section("optional").get("connection")
        return connection.get(name) if isinstance(connection, dict) else None

    def _instance(self) -> Any:
        if self._source is None:
            from ..sources import get_source

            self._source = get_source(self.recipe, source_id=self.source_id, runner_id="query")
        return self._source

    # ── relations ──────────────────────────────────────────────────────

    def relation(self, conn: Any, location: TableLocation) -> str:
        """The DuckDB expression a view over this table selects from."""
        if self.source_type == "POSTGRESQL":
            return self._postgres(conn, location)
        if self.source_type == "MYSQL":
            return self._mysql(conn, location)
        if self.source_type in ATTACHED_CATALOG_TYPES:
            return self._attached_catalog(conn, location)
        if self.source_type in OBJECT_STORAGE_TYPES:
            return self._object_storage(conn, location)
        raise BindingError(f"Sources of type {self.source_type} cannot be queried yet.")

    def _require_location_fields(self, location: TableLocation, *fields: str) -> list[str]:
        values = [getattr(location, name) for name in fields]
        if any(not value for value in values):
            raise BindingError(
                f"The table's location is incomplete (needs {', '.join(fields)}): "
                "run a scan of the source again."
            )
        return [str(value) for value in values]

    def _postgres(self, conn: Any, location: TableLocation) -> str:
        database, schema, table = self._require_location_fields(
            location, "database", "schema", "table"
        )
        alias = self._attached.get(database)
        if alias is None:
            load_extension(conn, "postgres")
            required, masked = self._section("required"), self._section("masked")
            dsn = _conninfo(
                {
                    "host": required.get("host"),
                    "port": required.get("port"),
                    "dbname": database,
                    "user": masked.get("username"),
                    "password": masked.get("password"),
                    "sslmode": self._connection_option("ssl_mode") or "prefer",
                    "connect_timeout": 10,
                    "application_name": "classifyre-query",
                }
            )
            alias = f"{self._hidden}_{len(self._attached)}"
            conn.execute(
                f"ATTACH {sql_literal(dsn)} AS {quote_identifier(alias)} (TYPE postgres, READ_ONLY)"
            )
            self._attached[database] = alias
        return ".".join(quote_identifier(part) for part in (alias, schema, table))

    def _mysql(self, conn: Any, location: TableLocation) -> str:
        database, table = self._require_location_fields(location, "database", "table")
        alias = self._attached.get(database)
        if alias is None:
            load_extension(conn, "mysql")
            required, masked = self._section("required"), self._section("masked")
            try:
                port = int(str(required.get("port") or "").strip())
            except (TypeError, ValueError):
                raise BindingError(
                    "The MySQL source has no usable port: check its configuration."
                ) from None
            values: dict[str, Any] = {
                "host": required.get("host"),
                # The scanner parses `port` as a bare integer (`stoi`); a
                # quoted value fails the whole ATTACH with just "stoi".
                "port": port,
                "database": database,
                "user": masked.get("username"),
                "password": masked.get("password"),
            }
            # Verified against the DuckDB docs (docs/stable mysql page): the
            # ATTACH connection string spells it `ssl_mode` with underscores
            # (`verify_ca`), same as the source model's lower-cased value.
            # This build rejects *every* ssl_mode string through the DSN
            # parser (each spelling answered "got '<that spelling>'") — the
            # mode key itself is what it chokes on, not the value. So the
            # mode is dropped entirely: the scanner then negotiates TLS on
            # its own (the server requires it), like the docs' bare
            # `ATTACH 'host=… database=…'` example. CA pinning stays a scan
            # concern (PyMySQL + ssl context), not a query concern.
            alias = f"{self._hidden}_{len(self._attached)}"
            conn.execute(
                f"ATTACH {sql_literal(_conninfo(values))} AS {quote_identifier(alias)} "
                "(TYPE mysql, READ_ONLY)"
            )
            self._attached[database] = alias
        # The scanner names its schemas after the server's databases.
        return ".".join(quote_identifier(part) for part in (alias, database, table))

    def _attached_catalog(self, conn: Any, location: TableLocation) -> str:
        schema, table = self._require_location_fields(location, "schema", "table")
        alias = self._attached.get("")
        if alias is None:
            source = self._instance()
            alias = self._hidden
            source._attach_alias = alias
            source._attach(conn)
            self._attached[""] = alias
        return ".".join(quote_identifier(part) for part in (alias, schema, table))

    def _object_storage(self, conn: Any, location: TableLocation) -> str:
        (key,) = self._require_location_fields(location, "object_key")
        fmt = location.format or ""
        if self._storage is None:
            storage = self._instance()._lakehouse_storage()
            if storage is None:
                raise BindingError("This source does not give table access to its storage.")
            for extension in storage.duckdb_extensions:
                load_extension(conn, extension)
            if storage.duckdb_secret:
                scope = storage.uri("")
                conn.execute(
                    f"CREATE OR REPLACE SECRET {quote_identifier(self._hidden + '_storage')} "
                    f"({storage.duckdb_secret}, SCOPE {sql_literal(scope)})"
                )
            self._storage = storage
        uri = sql_literal(self._storage.uri(key))
        if location.kind == "lakehouse":
            if fmt not in LAKEHOUSE_FORMATS:
                raise BindingError(f"{fmt or 'This'} tables cannot be queried with SQL yet.")
            load_extension(conn, fmt)
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
                load_extension(conn, "avro")
                return f"read_avro({uri})"
            raise BindingError(f"{fmt or 'These'} files cannot be queried with SQL yet.")
        raise BindingError(f"Unknown table location kind '{location.kind}'.")

    def close(self) -> None:
        if self._source is not None:
            try:
                self._source.cleanup()
            except Exception:  # pragma: no cover - best effort
                pass
        for path in self._temp_files:
            path.unlink(missing_ok=True)
