from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from ...models.generated_input import AzureBlobStorageInput
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)


class AzureBlobStorageSource(ObjectStorageSourceBase):
    source_type = "azure_blob_storage"
    provider_label = "AZURE_BLOB_STORAGE"
    input_model = AzureBlobStorageInput

    def _required_container(self) -> str:
        container = str(self.config.required.container).strip()
        if not container:
            raise ValueError("required.container must be set")
        return container

    def _required_account_url(self) -> str:
        account_url = str(self.config.required.account_url).strip()
        if not account_url:
            raise ValueError("required.account_url must be set")
        return account_url.rstrip("/")

    def _build_client(self) -> Any:
        blob_module = require_module(
            module_name="azure.storage.blob",
            source_name="Azure Blob Storage",
            uv_groups=["azure-blob-storage"],
            detail="Azure Blob storage requires azure-storage-blob.",
        )
        blob_service_client_cls = blob_module.BlobServiceClient

        connection_string = self._masked_value("azure_connection_string")
        if connection_string:
            return blob_service_client_cls.from_connection_string(connection_string)

        account_url = self._required_account_url()
        account_key = self._masked_value("azure_account_key")
        sas_token = self._masked_value("azure_sas_token")

        if account_key:
            return blob_service_client_cls(account_url=account_url, credential=account_key)
        if sas_token:
            return blob_service_client_cls(account_url=account_url, credential=sas_token)

        client_id = self._masked_value("azure_client_id")
        client_secret = self._masked_value("azure_client_secret")
        tenant_id = self._masked_value("azure_tenant_id")

        identity_module = require_module(
            module_name="azure.identity",
            source_name="Azure Blob Storage",
            uv_groups=["azure-blob-storage"],
            detail="Managed identity and service principal auth require azure-identity.",
        )
        if client_id and client_secret and tenant_id:
            credential = identity_module.ClientSecretCredential(
                tenant_id=tenant_id,
                client_id=client_id,
                client_secret=client_secret,
            )
        else:
            credential = identity_module.DefaultAzureCredential()

        return blob_service_client_cls(account_url=account_url, credential=credential)

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    def _list_objects(self) -> list[ObjectRef]:
        blob_service_client = self._client()
        container_client = blob_service_client.get_container_client(self._required_container())

        prefix = self._prefix()
        max_keys = self._max_keys_per_page()
        timeout = self._request_timeout_seconds()

        list_blobs = container_client.list_blobs(name_starts_with=prefix, timeout=timeout)

        object_refs: list[ObjectRef] = []
        for page in list_blobs.by_page(results_per_page=max_keys):
            for item in page:
                key = str(getattr(item, "name", "") or "")
                if not key or key.endswith("/"):
                    continue

                size = int(getattr(item, "size", 0) or 0)
                if size == 0 and not self._include_empty_objects():
                    continue
                if not self._object_matches_extension_filters(key):
                    continue

                content_settings = getattr(item, "content_settings", None)
                content_type_hint = getattr(content_settings, "content_type", None)
                object_refs.append(
                    ObjectRef(
                        key=key,
                        size=size,
                        last_modified=self._parse_datetime(getattr(item, "last_modified", None)),
                        etag=str(getattr(item, "etag", "") or "") or None,
                        content_type_hint=str(content_type_hint) if content_type_hint else None,
                    )
                )

        return object_refs

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None, bool]:
        blob_service_client = self._client()
        container_client = blob_service_client.get_container_client(self._required_container())
        blob_client = container_client.get_blob_client(ref.key)

        max_bytes = self._max_object_bytes()
        timeout = self._request_timeout_seconds()
        length = max_bytes if ref.size > max_bytes else None

        downloader = blob_client.download_blob(offset=0, length=length, timeout=timeout)
        file_bytes = downloader.readall()
        return file_bytes, ref.content_type_hint, ref.size > max_bytes

    def _external_url(self, key: str) -> str:
        account_url = self._required_account_url().rstrip("/")
        container = self._required_container()
        encoded_container = quote(container, safe="")
        encoded_key = quote(key, safe="/")
        return f"{account_url}/{encoded_container}/{encoded_key}"
