"""Any Iceberg REST catalog: Polaris, Snowflake Open Catalog, Unity Catalog,
Nessie, Gravitino, Lakekeeper, AWS S3 Tables and Glue, BigLake metastore.

The catalog is attached to DuckDB (``ATTACH … (TYPE iceberg)``), which speaks the
REST protocol, applies each table's deletes and resolves its columns by field id.
What differs between providers is only how to sign in and where the table files
are, so ``auth_mode`` picks one of five sign-ins and the rest is configuration:

* ``oauth2`` — client credentials against the catalog's token endpoint
  (Polaris, Open Catalog, Lakekeeper, Gravitino with OAuth).
* ``token`` — a bearer token (Unity Catalog personal access token, Nessie).
* ``sigv4`` — AWS request signing (S3 Tables, Glue's Iceberg endpoint).
* ``google`` — a Google access token minted from a service account (BigLake
  metastore).
* ``none`` — a catalog without auth (a local lab).

The table files are read with the credentials the catalog vends for each table
(``access_delegation: vended-credentials``), or with storage keys of the source's
own when the catalog does not vend them.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

from ...models.generated_input import IcebergRestInput, SamplingConfig
from ...utils.duckdb_engine import load_extension
from ..dependencies import require_module
from ..duckdb_attached_base import DuckDBAttachedSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class IcebergRestSource(DuckDBAttachedSource):
    source_type = "iceberg_rest"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = IcebergRestInput.model_validate(recipe)
        self._check_credentials()

    # ── Configuration ────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Iceberg REST catalog"

    def _asset_type_value(self) -> str:
        return str(getattr(self.config.type, "value", self.config.type))

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _auth_mode(self) -> str:
        return str(getattr(self.config.required.auth_mode, "value", self.config.required.auth_mode))

    def _catalog_uri(self) -> str:
        return str(self.config.required.catalog_uri).rstrip("/")

    def _masked(self, name: str) -> str | None:
        value = getattr(self.config.masked, name, None)
        value = str(value).strip() if value is not None else ""
        return value or None

    def _connection(self, name: str, default: Any = None) -> Any:
        connection = (
            getattr(self.config.optional, "connection", None) if self.config.optional else None
        )
        value = getattr(connection, name, None) if connection is not None else None
        value = getattr(value, "value", value)
        return default if value in (None, "") else value

    def _check_credentials(self) -> None:
        mode = self._auth_mode()
        if mode == "oauth2" and not (self._masked("client_id") and self._masked("client_secret")):
            raise ValueError("auth_mode oauth2 needs masked.client_id and masked.client_secret")
        if mode == "token" and not self._masked("token"):
            raise ValueError("auth_mode token needs masked.token")

    def _catalog_name(self) -> str:
        warehouse = self._connection("warehouse")
        if warehouse:
            # An S3 Tables bucket ARN names the bucket last.
            return str(warehouse).rsplit("/", 1)[-1] or str(warehouse)
        return urlsplit(self._catalog_uri()).hostname or "iceberg"

    # ── Attaching ────────────────────────────────────────────────────────

    def _require_duckdb(self) -> Any:
        return require_module(
            module_name="duckdb",
            source_name="Iceberg REST catalog",
            uv_groups=["iceberg-rest"],
            detail="DuckDB reads the catalog's tables.",
        )

    def _attach(self, conn: Any) -> None:
        load_extension(conn, "httpfs")
        load_extension(conn, "iceberg")
        lit = self._sql_literal
        mode = self._auth_mode()
        options = ["TYPE iceberg"]
        uri = self._catalog_uri()
        host = (urlsplit(uri).hostname or "").lower()

        if mode in ("oauth2", "token", "google"):
            secret = ["TYPE iceberg"]
            if mode == "oauth2":
                token_uri = self._connection("oauth2_server_uri") or f"{uri}/v1/oauth/tokens"
                secret += [
                    f"CLIENT_ID {lit(self._masked('client_id') or '')}",
                    f"CLIENT_SECRET {lit(self._masked('client_secret') or '')}",
                    f"OAUTH2_SERVER_URI {lit(str(token_uri))}",
                ]
                if self._connection("oauth2_scope"):
                    secret.append(f"OAUTH2_SCOPE {lit(str(self._connection('oauth2_scope')))}")
            else:
                token = self._masked("token") if mode == "token" else self._google_token()
                secret.append(f"TOKEN {lit(token or '')}")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('iceberg_catalog')} ({', '.join(secret)})"
            )
            options += [f"ENDPOINT {lit(uri)}", f"SECRET {self._secret_name('iceberg_catalog')}"]
        elif mode == "sigv4":
            self._aws_secret(conn)
            if "s3tables" in host:
                options.append("ENDPOINT_TYPE s3_tables")
            elif host.startswith("glue."):
                options.append("ENDPOINT_TYPE glue")
            else:
                options += [f"ENDPOINT {lit(uri)}", "AUTHORIZATION_TYPE 'sigv4'"]
        else:
            options += [f"ENDPOINT {lit(uri)}", "AUTHORIZATION_TYPE 'none'"]

        if self._connection("access_delegation", "vended-credentials") == "none":
            options.append("ACCESS_DELEGATION_MODE 'none'")
        self._storage_secrets(conn)
        warehouse = str(self._connection("warehouse") or "")
        conn.execute(f"ATTACH {lit(warehouse)} AS {self._attach_alias} ({', '.join(options)})")

    def _aws_secret(self, conn: Any) -> None:
        lit = self._sql_literal
        parts = ["TYPE S3"]
        key, secret = self._masked("aws_access_key_id"), self._masked("aws_secret_access_key")
        if key and secret:
            parts += [f"KEY_ID {lit(key)}", f"SECRET {lit(secret)}"]
            if self._masked("aws_session_token"):
                parts.append(f"SESSION_TOKEN {lit(self._masked('aws_session_token') or '')}")
        else:
            parts.append("PROVIDER credential_chain")
        region = self._connection("sigv4_region")
        if region:
            parts.append(f"REGION {lit(str(region))}")
        conn.execute(
            f"CREATE OR REPLACE SECRET {self._secret_name('iceberg_sigv4')} ({', '.join(parts)})"
        )

    def _storage_secrets(self, conn: Any) -> None:
        """Keys of the source's own for the table files, when the catalog vends none."""
        lit = self._sql_literal
        key, secret = (
            self._masked("storage_access_key_id"),
            self._masked("storage_secret_access_key"),
        )
        if key and secret:
            parts = ["TYPE S3", f"KEY_ID {lit(key)}", f"SECRET {lit(secret)}"]
            region = self._connection("storage_s3_region")
            if region:
                parts.append(f"REGION {lit(str(region))}")
            endpoint = self._connection("storage_s3_endpoint")
            if endpoint:
                parsed = urlsplit(str(endpoint))
                parts += [f"ENDPOINT {lit(parsed.netloc or parsed.path)}", "URL_STYLE 'path'"]
                if parsed.scheme == "http":
                    parts.append("USE_SSL false")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('iceberg_storage')} ({', '.join(parts)})"
            )
        azure = self._masked("storage_azure_connection_string")
        if azure:
            load_extension(conn, "azure")
            conn.execute(
                f"CREATE OR REPLACE SECRET {self._secret_name('iceberg_azure')} (TYPE AZURE, CONNECTION_STRING {lit(azure)})"
            )

    def _google_token(self) -> str:
        """An access token for the BigLake metastore, from the service account."""
        oauth2 = require_module(
            module_name="google.oauth2.service_account",
            source_name="Iceberg REST catalog",
            uv_groups=["iceberg-rest"],
            detail="google-auth signs in to the BigLake metastore.",
        )
        transport = require_module(
            module_name="google.auth.transport.requests",
            source_name="Iceberg REST catalog",
            uv_groups=["iceberg-rest"],
        )
        info = self._masked("gcp_credentials_json")
        if info:
            import json

            credentials = oauth2.Credentials.from_service_account_info(
                json.loads(info), scopes=[_GOOGLE_SCOPE]
            )
        else:
            google_auth = require_module(
                module_name="google.auth",
                source_name="Iceberg REST catalog",
                uv_groups=["iceberg-rest"],
            )
            credentials, _project = google_auth.default(scopes=[_GOOGLE_SCOPE])
        credentials.refresh(transport.Request())
        return str(credentials.token)

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str | None:
        parsed = urlsplit(self._catalog_uri())
        return parsed.netloc or None

    def _build_external_url(self, table_ref: TableRef) -> str:
        return f"{self._catalog_uri()}/v1/namespaces/{table_ref.schema}/tables/{table_ref.table}"

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {
            "table_format": "iceberg",
            "namespace": table_ref.schema,
            "catalog_uri": self._catalog_uri(),
        }
