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
* Databricks is attached through the ``unity_catalog`` extension with the token
  the scan authenticates with (a personal access token, or the OAuth token of
  its service principal). The extension asks Unity Catalog for short-lived
  storage credentials itself, so no storage keys are involved.
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ..utils.duckdb_engine import load_extension, quote_identifier, sql_literal

logger = logging.getLogger(__name__)

#: Formats DuckDB reads natively, by the ``format`` of a location.
#: Keep in sync with ``LAKEHOUSE_FORMATS`` in apps/api/src/data-query/sql-names.ts.
LAKEHOUSE_FORMATS = frozenset({"delta", "iceberg"})
#: Geospatial files, read with the ``spatial`` extension (``ST_Read``); geometries
#: come out as WKT text, so no spatial function has to be allowed in SQL.
SPATIAL_FORMATS = frozenset({"geojson", "fgb", "dbf"})
#: Keep in sync with ``FILE_FORMATS`` in apps/api/src/data-query/sql-names.ts
#: (``json`` here is read via ``read_json_auto``).
FILE_FORMATS = frozenset({"parquet", "csv", "tsv", "jsonl", "json", "avro", *SPATIAL_FORMATS})

OBJECT_STORAGE_TYPES = frozenset(
    {"S3_COMPATIBLE_STORAGE", "AZURE_BLOB_STORAGE", "GOOGLE_CLOUD_STORAGE", "LOCAL_FOLDER"}
)
ATTACHED_CATALOG_TYPES = frozenset({"ICEBERG_REST", "DUCKLAKE"})
#: Keep in sync with ``QUERYABLE_SOURCE_TYPES`` in
#: apps/api/src/data-query/sql-names.ts (same nine values).
QUERYABLE_SOURCE_TYPES = (
    OBJECT_STORAGE_TYPES | ATTACHED_CATALOG_TYPES | frozenset({"POSTGRESQL", "MYSQL", "DATABRICKS"})
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


# How the scan names an endpoint, per source type (see ``label``).
_ENDPOINT_SCHEMES = {"MYSQL": "mysql", "POSTGRESQL": "postgresql"}


def _conninfo(values: dict[str, Any]) -> str:
    """A libpq-style ``key=value`` string for PostgreSQL's scanner.

    (MySQL's scanner does not read quoted values — see ``_mysql``, which
    connects through a secret instead.) Numbers and plain hostnames stay
    bare; anything with whitespace, quotes or backslashes is quoted.
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
        self._ca_path: str | None = None

    # ── recipe access ──────────────────────────────────────────────────

    def label(self) -> str:
        """What the source is called in errors: `mysql://host:port/`.

        Mirrors the scan's ``_source_label`` (`scheme://host:port/`, no
        database): the query and the scan then name the same failing endpoint
        the same way, so a person comparing the two sees one problem, not two
        wordings. A source without a host (files, catalogs) is called by its
        SQL name, the one the person typed.
        """
        required = self._section("required")
        host = str(required.get("host") or "").strip()
        port = str(required.get("port") or "").strip()
        if self.source_type == "DATABRICKS":
            workspace = str(required.get("workspace_url") or "").strip()
            netloc = urlparse(workspace).netloc or workspace.removeprefix("https://").strip("/")
            return f"databricks://{netloc}/" if netloc else self.alias
        scheme = _ENDPOINT_SCHEMES.get(self.source_type)
        if host and scheme:
            return f"{scheme}://{host}:{port}/" if port else f"{scheme}://{host}/"
        return self.alias

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
        if self.source_type == "DATABRICKS":
            return self._databricks(conn, location)
        if self.source_type in ATTACHED_CATALOG_TYPES:
            return self._attached_catalog(conn, location)
        if self.source_type in OBJECT_STORAGE_TYPES:
            return self._object_storage(conn, location)
        raise BindingError(f"Sources of type {self.source_type} cannot be queried yet.")

    def _require_location_fields(self, location: TableLocation, *fields: str) -> list[str]:
        values = [getattr(location, name) for name in fields]
        missing = [name for name, value in zip(fields, values, strict=True) if not value]
        if missing:
            raise BindingError(
                f"Could not open {self.label()}: the table's location is incomplete "
                f"(needs {', '.join(missing)}): run a scan of the source again."
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
            alias = f"{self._hidden}_{len(self._attached)}"
            # Connect through a DuckDB *secret*, not a connection string. The
            # scanner's DSN parser takes values literally, quotes included
            # (`ssl_mode='verify_ca'` answers "got ''verify_ca''", a quoted
            # password is refused as wrong), so nothing with a space, a quote
            # or a backslash in it (a password, a path) can be passed safely.
            # Secret fields are SQL literals, escaped like any other.
            fields = [
                "TYPE mysql",
                f"HOST {sql_literal(str(required.get('host') or ''))}",
                f"PORT {port}",
                f"DATABASE {sql_literal(database)}",
                f"USER {sql_literal(str(masked.get('username') or ''))}",
                f"PASSWORD {sql_literal(str(masked.get('password') or ''))}",
                *self._mysql_tls_fields(),
            ]
            secret = quote_identifier(f"{alias}_secret")
            conn.execute(f"CREATE OR REPLACE SECRET {secret} ({', '.join(fields)})")
            conn.execute(
                f"ATTACH '' AS {quote_identifier(alias)} (TYPE mysql, SECRET {secret}, READ_ONLY)"
            )
            self._attached[database] = alias
        # The scanner names its schemas after the server's databases.
        return ".".join(quote_identifier(part) for part in (alias, database, table))

    def _mysql_tls_fields(self) -> list[str]:
        """The secret's TLS fields, matching what the scan does with the source.

        The scan (``MySQLSource._build_ssl_kwargs``) verifies the certificate
        only for *Verify CA* / *Verify identity*, against the source's CA when
        it has one and the system roots otherwise; every other mode just
        encrypts. DuckDB's own ``required`` is stricter than that (it demands
        a trusted chain), so it is only used when the source supplies the CA
        to check against; without one the scanner's default (``preferred``:
        TLS whenever the server offers it) is what the scan effectively does.
        The CA is a *file* to DuckDB, so the PEM is written to a private temp
        file kept until :meth:`close` — parallel scan threads reconnect.
        """
        mode = str(self._connection_option("ssl_mode") or "").upper()
        if mode == "DISABLED":
            return ["SSL_MODE 'disabled'"]
        verifies = mode in ("VERIFY_CA", "VERIFY_IDENTITY")
        ca_path = self._ca_file() if verifies or mode == "REQUIRED" else None
        fields: list[str] = []
        if verifies:
            fields.append(f"SSL_MODE '{mode.lower()}'")
        elif mode == "REQUIRED" and ca_path:
            fields.append("SSL_MODE 'required'")
        if ca_path and (verifies or mode == "REQUIRED"):
            fields.append(f"SSL_CA {sql_literal(ca_path)}")
        return fields

    def _ca_file(self) -> str | None:
        """The source's CA certificate as a file path, or None without one."""
        pem = str(self._section("masked").get("ssl_ca") or "")
        if not pem.strip():
            return None
        if self._ca_path is None:
            # Same normalisation as the scan: escaped newlines and CRLF.
            text = pem.replace("\\n", "\n").replace("\r\n", "\n").strip() + "\n"
            fd, path = tempfile.mkstemp(prefix="classifyre-mysql-ca-", suffix=".pem")
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            self._ca_path = path
        return self._ca_path

    def _databricks(self, conn: Any, location: TableLocation) -> str:
        catalog, schema, table = self._require_location_fields(
            location, "database", "schema", "table"
        )
        alias = self._attached.get(catalog)
        if alias is None:
            source = self._instance()
            endpoint = str(self._section("required").get("workspace_url") or "").rstrip("/")
            # Delta files sit in S3 on AWS (httpfs) and in ADLS on Azure (azure).
            storage = "azure" if "azuredatabricks.net" in endpoint else "httpfs"
            for extension in ("unity_catalog", "delta", storage):
                load_extension(conn, extension)
            alias = f"{self._hidden}_{len(self._attached)}"
            secret = quote_identifier(f"{alias}_secret")
            conn.execute(
                f"CREATE OR REPLACE SECRET {secret} (TYPE unity_catalog, "
                f"TOKEN {sql_literal(source._access_token_value())}, "
                f"ENDPOINT {sql_literal(endpoint)})"
            )
            conn.execute(
                f"ATTACH {sql_literal(catalog)} AS {quote_identifier(alias)} "
                f"(TYPE unity_catalog, SECRET {secret}, READ_ONLY)"
            )
            self._attached[catalog] = alias
        return ".".join(quote_identifier(part) for part in (alias, schema, table))

    def explain(self, exc: Exception) -> str | None:
        """What a failed read of this source's table means, when it is known."""
        message = str(exc)
        if self.source_type == "DATABRICKS" and "temporary-table-credentials" in message:
            return (
                "Databricks would not hand out storage credentials for the table. "
                "An admin has to turn on External data access for the metastore, and the "
                "source's principal needs the EXTERNAL USE SCHEMA privilege on the schema."
            )
        return None

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
            if fmt in SPATIAL_FORMATS:
                return self._spatial(conn, uri)
            raise BindingError(f"{fmt or 'These'} files cannot be queried with SQL yet.")
        raise BindingError(f"Unknown table location kind '{location.kind}'.")

    def _spatial(self, conn: Any, uri: str) -> str:
        """``ST_Read`` with every geometry column turned into WKT text.

        The raw column is a binary geometry only spatial functions can read;
        as text it shows in a result and compares like any string.
        """
        load_extension(conn, "spatial")
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

    def close(self) -> None:
        if self._ca_path is not None:
            try:
                Path(self._ca_path).unlink()
            except OSError:  # pragma: no cover - best effort
                pass
            self._ca_path = None
        if self._source is not None:
            try:
                self._source.cleanup()
            except Exception:  # pragma: no cover - best effort
                pass
