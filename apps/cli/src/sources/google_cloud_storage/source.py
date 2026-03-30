from __future__ import annotations

import json
from typing import Any

from ...models.generated_input import GoogleCloudStorageInput
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase


class GoogleCloudStorageSource(ObjectStorageSourceBase):
    source_type = "google_cloud_storage"
    provider_label = "GOOGLE_CLOUD_STORAGE"
    input_model = GoogleCloudStorageInput

    def _required_bucket(self) -> str:
        bucket = str(self.config.required.bucket).strip()
        if not bucket:
            raise ValueError("required.bucket must be set")
        return bucket

    def _build_client(self) -> Any:
        storage_module = require_module(
            module_name="google.cloud.storage",
            source_name="Google Cloud Storage",
            uv_groups=["google-cloud-storage"],
            detail="Google Cloud Storage requires google-cloud-storage.",
        )

        project = self._string_or_none(self._connection_option("project_id"))
        credentials_json = self._masked_value("gcp_credentials_json")
        credentials_file = self._string_or_none(self._connection_option("gcp_credentials_file"))

        if credentials_json:
            service_account_module = require_module(
                module_name="google.oauth2.service_account",
                source_name="Google Cloud Storage",
                uv_groups=["google-cloud-storage"],
                detail="Inline service account credentials require google-auth support.",
            )
            credentials = service_account_module.Credentials.from_service_account_info(
                json.loads(credentials_json)
            )
            return storage_module.Client(project=project, credentials=credentials)

        if credentials_file:
            service_account_module = require_module(
                module_name="google.oauth2.service_account",
                source_name="Google Cloud Storage",
                uv_groups=["google-cloud-storage"],
                detail="File-based service account credentials require google-auth support.",
            )
            credentials = service_account_module.Credentials.from_service_account_file(
                credentials_file
            )
            return storage_module.Client(project=project, credentials=credentials)

        return storage_module.Client(project=project)

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    def _list_objects(self) -> list[ObjectRef]:
        client = self._client()
        bucket = self._required_bucket()
        prefix = self._prefix()
        max_keys = self._max_keys_per_page()
        timeout = self._request_timeout_seconds()

        object_refs: list[ObjectRef] = []
        blobs = client.list_blobs(
            bucket_or_name=bucket,
            prefix=prefix or None,
            page_size=max_keys,
            timeout=timeout,
        )
        for blob in blobs:
            key = str(getattr(blob, "name", "") or "")
            if not key or key.endswith("/"):
                continue

            size = int(getattr(blob, "size", 0) or 0)
            if size == 0 and not self._include_empty_objects():
                continue
            if not self._object_matches_extension_filters(key):
                continue

            object_refs.append(
                ObjectRef(
                    key=key,
                    size=size,
                    last_modified=self._parse_datetime(getattr(blob, "updated", None)),
                    etag=str(getattr(blob, "etag", "") or "") or None,
                    content_type_hint=str(getattr(blob, "content_type", "") or "") or None,
                )
            )

        return object_refs

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None, bool]:
        client = self._client()
        bucket = client.bucket(self._required_bucket())
        blob = bucket.blob(ref.key)

        max_bytes = self._max_object_bytes()
        timeout = self._request_timeout_seconds()

        if ref.size > max_bytes:
            file_bytes = blob.download_as_bytes(start=0, end=max_bytes - 1, timeout=timeout)
            return file_bytes, ref.content_type_hint, True

        file_bytes = blob.download_as_bytes(timeout=timeout)
        return file_bytes, ref.content_type_hint, False

    def _external_url(self, key: str) -> str:
        return f"gs://{self._required_bucket()}/{key}"
