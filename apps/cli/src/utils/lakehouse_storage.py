"""``TableStorage`` for each bucket provider, from the credentials it already has.

A lakehouse table is read by readers that open its storage themselves — DuckDB
for Delta and Iceberg, the Rust ``object_store`` readers for Lance and Hudi,
pypaimon's filesystem for Paimon — so each provider describes its storage once,
in each reader's terms. The keys below are those readers' own option names.

What each provider supports (see the lakehouse docs page for the tested matrix):

* **S3-compatible** — every format.
* **Azure Blob / ADLS / OneLake** — Delta, Iceberg, Lance, Hudi. pypaimon has no
  Azure filesystem, so Paimon on Azure is not readable.
* **GCS** — Lance, Hudi and Paimon with the service-account key; Delta and
  Iceberg need an HMAC key, because DuckDB reaches GCS through its
  S3-interoperable API.
* **Local folder** — every format, through plain paths.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from .duckdb_engine import sql_literal
from .lakehouse_layout import DELTA, ICEBERG, PAIMON
from .lakehouse_tables import TableStorage

_AZURITE_ACCOUNT = "devstoreaccount1"


def azure_account_name(account_url: str) -> str:
    """The storage account named by an Azure blob endpoint URL.

    An Azurite URL (``http://host:10000/devstoreaccount1``) carries the account
    in its path, a real one (``https://<account>.blob.core.windows.net``) in
    its host. A URN authority holds a name, never a URL, so table identities
    use this rather than the endpoint.
    """
    parsed = urlsplit(account_url)
    path_account = parsed.path.strip("/").split("/", 1)[0]
    return path_account or (parsed.hostname or "").split(".", 1)[0]


def s3_table_storage(
    *,
    bucket: str,
    access_key_id: str | None,
    secret_access_key: str | None,
    session_token: str | None,
    region: str | None,
    endpoint_url: str | None,
) -> TableStorage:
    secret = ["TYPE S3"]
    object_store: dict[str, str] = {}
    paimon: dict[str, str] = {}
    if access_key_id and secret_access_key:
        secret += [
            f"KEY_ID {sql_literal(access_key_id)}",
            f"SECRET {sql_literal(secret_access_key)}",
        ]
        object_store |= {
            "aws_access_key_id": access_key_id,
            "aws_secret_access_key": secret_access_key,
        }
        paimon |= {"fs.s3.accessKeyId": access_key_id, "fs.s3.accessKeySecret": secret_access_key}
        if session_token:
            secret.append(f"SESSION_TOKEN {sql_literal(session_token)}")
            object_store["aws_session_token"] = session_token
            paimon["fs.s3.securityToken"] = session_token
    else:
        secret.append("PROVIDER credential_chain")
    if region:
        secret.append(f"REGION {sql_literal(region)}")
        object_store["aws_region"] = region
        paimon["fs.s3.region"] = region
    if endpoint_url:
        parsed = urlsplit(endpoint_url)
        host = parsed.netloc or parsed.path
        insecure = parsed.scheme == "http"
        # Custom endpoints (MinIO, SeaweedFS, R2, B2, Garage) want path-style
        # addressing; plain HTTP only ever means a local test setup.
        secret += [f"ENDPOINT {sql_literal(host)}", "URL_STYLE 'path'"]
        if insecure:
            secret.append("USE_SSL false")
        object_store |= {
            "aws_endpoint": endpoint_url.rstrip("/"),
            "aws_virtual_hosted_style_request": "false",
        }
        if insecure:
            object_store["aws_allow_http"] = "true"
        paimon |= {"fs.s3.endpoint": endpoint_url.rstrip("/"), "fs.s3.path-style-access": "true"}
    return TableStorage(
        uri=lambda key: f"s3://{bucket}/{key.lstrip('/')}",
        duckdb_secret=", ".join(secret),
        duckdb_extensions=("httpfs",),
        object_store_options=object_store,
        paimon_options=paimon,
    )


def azure_table_storage(
    *,
    account_url: str,
    container: str,
    connection_string: str | None,
    account_key: str | None,
    sas_token: str | None,
    client_id: str | None,
    client_secret: str | None,
    tenant_id: str | None,
) -> TableStorage:
    """Azure Blob Storage, ADLS Gen2 and OneLake (its blob endpoint)."""
    parsed = urlsplit(account_url)
    account = azure_account_name(account_url)
    emulated = parsed.scheme == "http" or account == _AZURITE_ACCOUNT
    blob_endpoint = account_url.rstrip("/")

    object_store: dict[str, str] = {"azure_storage_account_name": account}
    if emulated:
        object_store |= {"azure_storage_use_emulator": "true", "allow_http": "true"}
        # In emulator mode the Rust object_store readers (Lance, Hudi, and the
        # Delta kernel inside DuckDB, which turns emulator mode on by itself for
        # the Azurite account) take the endpoint only from this variable, and
        # otherwise go to 127.0.0.1:10000 whatever account_url says.
        os.environ["AZURITE_BLOB_STORAGE_URL"] = f"{parsed.scheme}://{parsed.netloc}"
    elif not blob_endpoint.endswith(".blob.core.windows.net"):
        object_store["azure_storage_endpoint"] = blob_endpoint  # OneLake, sovereign clouds

    if connection_string:
        secret = f"TYPE AZURE, CONNECTION_STRING {sql_literal(connection_string)}"
        for part in connection_string.split(";"):
            name, _, value = part.partition("=")
            if name.strip().lower() == "accountkey":
                object_store["azure_storage_account_key"] = value
            elif name.strip().lower() == "sharedaccesssignature":
                object_store["azure_storage_sas_key"] = value
    elif account_key:
        built = (
            f"DefaultEndpointsProtocol={parsed.scheme or 'https'};AccountName={account};"
            f"AccountKey={account_key};BlobEndpoint={blob_endpoint};"
        )
        secret = f"TYPE AZURE, CONNECTION_STRING {sql_literal(built)}"
        object_store["azure_storage_account_key"] = account_key
    elif sas_token:
        built = f"BlobEndpoint={blob_endpoint};SharedAccessSignature={sas_token.lstrip('?')};"
        secret = f"TYPE AZURE, CONNECTION_STRING {sql_literal(built)}"
        object_store["azure_storage_sas_key"] = sas_token.lstrip("?")
    elif client_id and client_secret and tenant_id:
        secret = (
            "TYPE AZURE, PROVIDER service_principal, "
            f"TENANT_ID {sql_literal(tenant_id)}, CLIENT_ID {sql_literal(client_id)}, "
            f"CLIENT_SECRET {sql_literal(client_secret)}, ACCOUNT_NAME {sql_literal(account)}"
        )
        object_store |= {
            "azure_client_id": client_id,
            "azure_client_secret": client_secret,
            "azure_tenant_id": tenant_id,
        }
    else:
        secret = f"TYPE AZURE, PROVIDER credential_chain, ACCOUNT_NAME {sql_literal(account)}"
    return TableStorage(
        uri=lambda key: f"az://{container}/{key.lstrip('/')}",
        duckdb_secret=secret,
        duckdb_extensions=("azure",),
        object_store_options=object_store,
        unreadable={PAIMON: "the Paimon reader has no Azure filesystem"},
    )


def gcs_table_storage(
    *,
    bucket: str,
    service_account_json: str | None,
    hmac_key_id: str | None,
    hmac_secret: str | None,
) -> TableStorage:
    object_store: dict[str, str] = {}
    if service_account_json:
        object_store["google_service_account_key"] = service_account_json
    secret: str | None = None
    unreadable: dict[str, str] = {}
    if hmac_key_id and hmac_secret:
        secret = f"TYPE GCS, KEY_ID {sql_literal(hmac_key_id)}, SECRET {sql_literal(hmac_secret)}"
    else:
        reason = "reading it from GCS needs an HMAC key (masked.gcs_hmac_key_id / gcs_hmac_secret)"
        unreadable = {DELTA: reason, ICEBERG: reason}
    return TableStorage(
        uri=lambda key: f"gs://{bucket}/{key.lstrip('/')}",
        duckdb_secret=secret,
        duckdb_extensions=("httpfs",),
        object_store_options=object_store,
        unreadable=unreadable,
    )


def local_table_storage(base: Path) -> TableStorage:
    return TableStorage(uri=lambda key: str(base / key.lstrip("/")))
