"""Base class for JVM-free lakehouse sources (Delta Lake, Apache Iceberg).

Tables live in an S3-compatible bucket (AWS S3, MinIO, R2, B2, Garage, ...);
the connection configuration mirrors the well-tested S3 Compatible Storage
source (same ``masked`` credentials and ``optional.connection`` shape).

The moving parts:

* **Discovery** — boto3 listing (shared :func:`build_s3_client`) finds table
  roots under ``optional.scope.prefix`` by their format marker (``_delta_log/``
  for Delta, ``metadata/*.metadata.json`` for Iceberg), or uses explicit
  ``optional.scope.table_paths``.
* **Metadata** — the format's native Python reader (``deltalake`` /
  ``pyiceberg``) resolves schema, snapshot/version info, and the current data
  file list. No Spark, no JVM.
* **Sampling** — DuckDB provides a DBAPI-style connection with SQL views over
  each table's Parquet files (httpfs), so the whole
  :class:`BaseTabularSource` machinery — sampling strategies, ``LIMIT``/
  ``OFFSET`` pagination, ``fetch_content_pages`` streaming — is reused
  unchanged.
"""

from __future__ import annotations

import logging
import threading
from abc import abstractmethod
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from ..models.generated_input import SamplingConfig
from ..utils.hashing import hash_id
from .s3_client import build_s3_client
from .tabular_base import BaseTabularSource
from .tabular_utils import TableRef

logger = logging.getLogger(__name__)


class BaseLakehouseSource(BaseTabularSource):
    """Shared logic for S3-backed lakehouse table sources."""

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"
        self._duck: Any = None
        self._duck_lock = threading.Lock()
        self._views: dict[str, str] = {}
        self._handles: dict[str, Any] = {}
        self._storage_client: Any = None

    # ── Abstract format hooks ────────────────────────────────────────────

    @abstractmethod
    def _require_duckdb(self) -> Any:
        """Import duckdb via ``require_module`` with the source's literal uv group."""

    @abstractmethod
    def _uv_groups(self) -> list[str]:
        """The uv dependency group(s) backing this source."""

    @abstractmethod
    def _table_root_from_key(self, key: str) -> str | None:
        """Map an object key to its table root, or ``None`` if not a marker."""

    @abstractmethod
    def _open_table(self, root: str) -> Any:
        """Open the format's native table handle for a table root key."""

    @abstractmethod
    def _table_data_files(self, handle: Any) -> list[str]:
        """Absolute (``s3://``) Parquet data file URIs for the current snapshot."""

    @abstractmethod
    def _table_columns(self, handle: Any) -> dict[str, str]:
        """Ordered ``{column_name: type_string}`` from table metadata."""

    # ── Config helpers (S3-style shape) ──────────────────────────────────

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _bucket(self) -> str:
        bucket = str(self.config.required.bucket).strip()
        if not bucket:
            raise ValueError("required.bucket must be set")
        return bucket

    def _scope(self) -> Any:
        optional = getattr(self.config, "optional", None)
        return getattr(optional, "scope", None) if optional is not None else None

    def _connection(self) -> Any:
        optional = getattr(self.config, "optional", None)
        return getattr(optional, "connection", None) if optional is not None else None

    def _connection_option(self, key: str, default: Any = None) -> Any:
        connection = self._connection()
        value = getattr(connection, key, None) if connection is not None else None
        return default if value is None else value

    def _masked_value(self, key: str) -> str | None:
        masked = getattr(self.config, "masked", None)
        value = getattr(masked, key, None) if masked is not None else None
        if value is None:
            return None
        value = str(value).strip()
        return value or None

    def _endpoint_url(self) -> str | None:
        value = self._connection_option("endpoint_url")
        if not value:
            return None
        # Pydantic's AnyUrl normalization appends a trailing slash to bare hosts.
        return str(value).strip().rstrip("/") or None

    def _region_name(self) -> str | None:
        value = self._connection_option("region_name")
        return str(value).strip() or None if value else None

    def _verify_ssl(self) -> bool:
        return bool(self._connection_option("verify_ssl", True))

    def _request_timeout_seconds(self) -> float:
        try:
            return float(self._connection_option("request_timeout_seconds", 30))
        except (TypeError, ValueError):
            return 30.0

    def _max_keys_per_page(self) -> int:
        try:
            value = int(self._connection_option("max_keys_per_page", 1000))
        except (TypeError, ValueError):
            return 1000
        return max(1, min(value, 1000))

    # ── Storage client (shared with the S3 source) ───────────────────────

    def _storage(self) -> Any:
        if self._storage_client is None:
            self._storage_client = build_s3_client(
                source_name=self._source_label,
                uv_groups=self._uv_groups(),
                region_name=self._region_name(),
                endpoint_url=self._endpoint_url(),
                aws_access_key_id=self._masked_value("aws_access_key_id"),
                aws_secret_access_key=self._masked_value("aws_secret_access_key"),
                aws_session_token=self._masked_value("aws_session_token"),
                verify_ssl=self._verify_ssl(),
                request_timeout_seconds=self._request_timeout_seconds(),
            )
        return self._storage_client

    def _list_keys(self, prefix: str) -> list[str]:
        client = self._storage()
        bucket = self._bucket()
        keys: list[str] = []
        continuation_token: str | None = None
        while True:
            params: dict[str, Any] = {"Bucket": bucket, "MaxKeys": self._max_keys_per_page()}
            if prefix:
                params["Prefix"] = prefix
            if continuation_token:
                params["ContinuationToken"] = continuation_token
            response = client.list_objects_v2(**params)
            for item in response.get("Contents", []) or []:
                key = str(item.get("Key") or "")
                if key:
                    keys.append(key)
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                break
        return keys

    # ── Discovery ────────────────────────────────────────────────────────

    def _normalize_table_path(self, path: str) -> str:
        value = str(path).strip()
        if value.startswith("s3://") or value.startswith("s3a://"):
            parsed = urlsplit(value)
            value = parsed.path
        return value.strip("/")

    def _resolve_databases(self) -> list[str]:
        return [self._bucket()]

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        scope = self._scope()
        limit = self._table_limit()

        explicit = [
            self._normalize_table_path(p)
            for p in (getattr(scope, "table_paths", None) or [])
            if str(p).strip()
        ]
        if explicit:
            roots = [p for p in dict.fromkeys(explicit) if p]
        else:
            prefix = str(getattr(scope, "prefix", None) or "").lstrip("/")
            discovered: set[str] = set()
            for key in self._list_keys(prefix):
                root = self._table_root_from_key(key)
                if root:
                    discovered.add(root.strip("/"))
            roots = sorted(r for r in discovered if r)

        tables = [TableRef(database=database, schema=None, table=root) for root in roots]
        if limit is not None:
            tables = tables[:limit]
        return tables

    def _table_limit(self) -> int | None:
        scope = self._scope()
        limit = getattr(scope, "table_limit", None) if scope is not None else None
        return int(limit) if limit else None

    # ── Table handles ────────────────────────────────────────────────────

    def _handle(self, table_ref: TableRef) -> Any:
        root = table_ref.table
        handle = self._handles.get(root)
        if handle is None:
            handle = self._open_table(root)
            self._handles[root] = handle
        return handle

    def _table_uri(self, root: str) -> str:
        return f"s3://{self._bucket()}/{root}"

    # ── DuckDB connection (DBAPI-compatible) ─────────────────────────────

    def _duck_connection(self) -> Any:
        with self._duck_lock:
            if self._duck is None:
                duckdb = self._require_duckdb()
                conn = duckdb.connect()
                try:
                    conn.execute("INSTALL httpfs; LOAD httpfs;")
                except Exception as exc:
                    logger.warning("Could not install/load duckdb httpfs: %s", exc)
                self._configure_duck_secret(conn)
                self._duck = conn
            return self._duck

    @staticmethod
    def _sql_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    def _configure_duck_secret(self, conn: Any) -> None:
        parts: list[str] = ["TYPE S3"]
        access_key = self._masked_value("aws_access_key_id")
        secret_key = self._masked_value("aws_secret_access_key")
        session_token = self._masked_value("aws_session_token")
        region = self._region_name()
        endpoint = self._endpoint_url()

        if access_key and secret_key:
            parts.append(f"KEY_ID {self._sql_literal(access_key)}")
            parts.append(f"SECRET {self._sql_literal(secret_key)}")
            if session_token:
                parts.append(f"SESSION_TOKEN {self._sql_literal(session_token)}")
        else:
            # Fall back to the ambient AWS credentials chain.
            parts.append("PROVIDER credential_chain")
        if region:
            parts.append(f"REGION {self._sql_literal(region)}")
        if endpoint:
            parsed = urlsplit(endpoint)
            host = parsed.netloc or parsed.path
            parts.append(f"ENDPOINT {self._sql_literal(host)}")
            parts.append("URL_STYLE 'path'")
            if parsed.scheme == "http":
                parts.append("USE_SSL false")

        statement = f"CREATE OR REPLACE SECRET classifyre_lakehouse ({', '.join(parts)})"
        try:
            conn.execute(statement)
        except Exception as exc:
            logger.warning("Could not configure duckdb S3 secret: %s", exc)

    def _connect(self, database: str | None = None) -> Any:
        del database  # single bucket; one shared in-memory DuckDB
        return self._duck_connection().cursor()

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    def cleanup(self) -> None:
        super().cleanup()
        with self._duck_lock:
            if self._duck is not None:
                try:
                    self._duck.close()
                except Exception:
                    pass
                self._duck = None
        self._views.clear()
        self._handles.clear()
        self._storage_client = None

    # ── Views over Parquet data files ────────────────────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return self._ensure_view(table_ref)

    def _ensure_view(self, table_ref: TableRef) -> str:
        root = table_ref.table
        view = self._views.get(root)
        if view is not None:
            return self._quote_identifier(view)

        view = "lake_" + hash_id(self.source_type, root)[:16]
        conn = self._duck_connection()
        files = self._table_data_files(self._handle(table_ref))
        if files:
            file_list = ", ".join(self._sql_literal(f) for f in files)
            conn.execute(
                f"CREATE OR REPLACE VIEW {self._quote_identifier(view)} AS "
                f"SELECT * FROM read_parquet([{file_list}], union_by_name=true)"
            )
        else:
            # Table with no data files yet: typed empty view from the metadata schema.
            columns = self._table_columns(self._handle(table_ref)) or {"value": "VARCHAR"}
            select = ", ".join(
                f"CAST(NULL AS VARCHAR) AS {self._quote_identifier(name)}" for name in columns
            )
            conn.execute(
                f"CREATE OR REPLACE VIEW {self._quote_identifier(view)} AS "
                f"SELECT {select} WHERE false"
            )
        self._views[root] = view
        return self._quote_identifier(view)

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    def _random_order_expr(self) -> str:
        return "random()"

    def _param_placeholder(self) -> str:
        return "?"

    def _automatic_supports_keyset(self) -> bool:
        # Lakehouse tables have no enforced primary keys; AUTOMATIC pages via OFFSET.
        return False

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    # ── Column metadata (from table metadata, not the query engine) ──────

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        return self._table_columns(self._handle(table_ref))

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref).keys())

    # ── Identity / URLs ──────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        endpoint = self._endpoint_url()
        if endpoint:
            return f"{endpoint.rstrip('/')}/{self._bucket()}/{table_ref.table}"
        return self._table_uri(table_ref.table)

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 2:
            return TableRef(database=parts[-2], schema=None, table=parts[-1])
        return None

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to %s...", self._source_label)
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            tables = self._list_tables_for_database(self._bucket())
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to {self._source_label} storage. "
                f"Discovered tables: {len(tables)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to {self._source_label}: {exc}"
        return result
