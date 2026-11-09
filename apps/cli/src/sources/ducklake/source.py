"""DuckLake: a lakehouse whose metadata lives in a database, not in the bucket.

A DuckLake keeps its catalog (tables, snapshots, which data files are live) in a
SQL database — Postgres, MySQL, SQLite or a DuckDB file — and its data as Parquet
files in object storage or a folder. DuckDB attaches it read-only (``ATTACH
'ducklake:<catalog>'``) and reads the current snapshot of each table, deletes
applied. A bucket scan cannot find a DuckLake by its files, which is why it is a
source of its own.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

from ...models.generated_input import DuckLakeInput, SamplingConfig
from ...utils.duckdb_engine import load_extension
from ..dependencies import require_module
from ..duckdb_attached_base import DuckDBAttachedSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


class DuckLakeSource(DuckDBAttachedSource):
    source_type = "ducklake"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = DuckLakeInput.model_validate(recipe)

    @property
    def _source_label(self) -> str:
        return "DuckLake"

    def _asset_type_value(self) -> str:
        return str(getattr(self.config.type, "value", self.config.type))

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _catalog(self) -> str:
        return str(self.config.required.catalog).strip()

    def _masked(self, name: str) -> str | None:
        value = getattr(self.config.masked, name, None) if self.config.masked else None
        value = str(value).strip() if value is not None else ""
        return value or None

    def _connection(self, name: str) -> str | None:
        connection = (
            getattr(self.config.optional, "connection", None) if self.config.optional else None
        )
        value = getattr(connection, name, None) if connection is not None else None
        return str(value).strip() or None if value is not None else None

    def _catalog_name(self) -> str:
        """The catalog's database name, host or file: what identifies this lake."""
        catalog = self._catalog()
        _kind, _, rest = (
            catalog.partition(":") if ":" in catalog.split("/")[0] else ("", "", catalog)
        )
        for part in rest.split():
            name, _, value = part.partition("=")
            if name in ("dbname", "database", "db"):
                return value
        return rest.rsplit("/", 1)[-1] or catalog

    # ── Attaching ────────────────────────────────────────────────────────

    def _require_duckdb(self) -> Any:
        return require_module(
            module_name="duckdb",
            source_name="DuckLake",
            uv_groups=["file-processing"],
            detail="DuckDB reads the lake.",
        )

    def _attach(self, conn: Any) -> None:
        lit = self._sql_literal
        load_extension(conn, "ducklake")
        catalog = self._catalog()
        kind = catalog.split(":", 1)[0].lower() if ":" in catalog.split("/")[0] else ""
        if kind in ("postgres", "postgresql"):
            load_extension(conn, "postgres")
        elif kind == "mysql":
            load_extension(conn, "mysql")
        elif kind == "sqlite":
            load_extension(conn, "sqlite")
        password = self._masked("catalog_password")
        if password and kind in ("postgres", "postgresql", "mysql"):
            catalog = f"{catalog} password={password}"
        self._storage_secrets(conn)
        options = ["READ_ONLY"]
        if self._connection("data_path"):
            options.append(f"DATA_PATH {lit(self._connection('data_path') or '')}")
        if self._connection("metadata_schema"):
            options.append(f"METADATA_SCHEMA {lit(self._connection('metadata_schema') or '')}")
        conn.execute(
            f"ATTACH {lit('ducklake:' + catalog)} AS {self._attach_alias} ({', '.join(options)})"
        )

    def _storage_secrets(self, conn: Any) -> None:
        lit = self._sql_literal
        key, secret = self._masked("s3_access_key_id"), self._masked("s3_secret_access_key")
        if key and secret:
            load_extension(conn, "httpfs")
            parts = ["TYPE S3", f"KEY_ID {lit(key)}", f"SECRET {lit(secret)}"]
            if self._masked("s3_session_token"):
                parts.append(f"SESSION_TOKEN {lit(self._masked('s3_session_token') or '')}")
            if self._connection("s3_region"):
                parts.append(f"REGION {lit(self._connection('s3_region') or '')}")
            endpoint = self._connection("s3_endpoint_url")
            if endpoint:
                parsed = urlsplit(endpoint)
                parts += [f"ENDPOINT {lit(parsed.netloc or parsed.path)}", "URL_STYLE 'path'"]
                if parsed.scheme == "http":
                    parts.append("USE_SSL false")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('ducklake_s3')} ({', '.join(parts)})"
            )
        if self._masked("azure_connection_string"):
            load_extension(conn, "azure")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('ducklake_azure')} (TYPE AZURE, "
                f"CONNECTION_STRING {lit(self._masked('azure_connection_string') or '')})"
            )
        hmac_key, hmac_secret = self._masked("gcs_hmac_key_id"), self._masked("gcs_hmac_secret")
        if hmac_key and hmac_secret:
            load_extension(conn, "httpfs")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('ducklake_gcs')} (TYPE GCS, KEY_ID {lit(hmac_key)}, "
                f"SECRET {lit(hmac_secret)})"
            )

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str | None:
        return self._catalog_name()

    def _build_external_url(self, table_ref: TableRef) -> str:
        return f"ducklake://{self._catalog_name()}/{table_ref.schema}/{table_ref.table}"

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {"table_format": "ducklake"}
