from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

from ...models.generated_input import S3CompatibleStorageInput
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase
from ..s3_client import build_s3_client

logger = logging.getLogger(__name__)


class S3CompatibleStorageSource(ObjectStorageSourceBase):
    source_type = "s3_compatible_storage"
    provider_label = "S3_COMPATIBLE_STORAGE"
    input_model = S3CompatibleStorageInput

    def _required_bucket(self) -> str:
        bucket = str(self.config.required.bucket).strip()
        if not bucket:
            raise ValueError("required.bucket must be set")
        return bucket

    def _build_client(self) -> Any:
        return build_s3_client(
            source_name="S3 Compatible Storage",
            uv_groups=["s3-compatible-storage"],
            region_name=self._string_or_none(self._connection_option("region_name")),
            endpoint_url=self._string_or_none(self._connection_option("endpoint_url")),
            aws_access_key_id=self._masked_value("aws_access_key_id"),
            aws_secret_access_key=self._masked_value("aws_secret_access_key"),
            aws_session_token=self._masked_value("aws_session_token"),
            verify_ssl=self._verify_ssl(),
            request_timeout_seconds=self._request_timeout_seconds(),
        )

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    def _list_objects(self) -> Iterator[ObjectRef]:
        client = self._client()
        bucket = self._required_bucket()
        prefix = self._prefix()
        max_keys = self._max_keys_per_page()

        continuation_token: str | None = None

        while True:
            params: dict[str, Any] = {
                "Bucket": bucket,
                "MaxKeys": max_keys,
            }
            if prefix:
                params["Prefix"] = prefix
            if continuation_token:
                params["ContinuationToken"] = continuation_token

            response = client.list_objects_v2(**params)
            for item in response.get("Contents", []) or []:
                key = str(item.get("Key") or "")
                if not key or key.endswith("/"):
                    continue

                size = int(item.get("Size") or 0)
                if size == 0 and not self._include_empty_objects():
                    continue
                if not self._object_matches_extension_filters(key):
                    continue

                yield ObjectRef(
                    key=key,
                    size=size,
                    last_modified=self._parse_datetime(item.get("LastModified")),
                    etag=str(item.get("ETag")).strip('"') if item.get("ETag") else None,
                )

            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                break

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        client = self._client()
        bucket = self._required_bucket()
        max_bytes = self._max_object_bytes()

        response = client.get_object(Bucket=bucket, Key=ref.key)
        body = response["Body"]
        try:
            # Read one byte past the cap so we can detect truncation without
            # ever materializing the full (potentially huge) object body.
            file_bytes = body.read(max_bytes + 1)
        finally:
            try:
                body.close()
            except Exception:
                logger.debug("Failed to close S3 response body")

        if len(file_bytes) > max_bytes:
            file_bytes = file_bytes[:max_bytes]
            logger.warning(
                "Truncated s3://%s/%s to %d of %d bytes for content extraction",
                bucket,
                ref.key,
                max_bytes,
                ref.size,
            )

        content_type = response.get("ContentType")
        return file_bytes, str(content_type) if content_type else None

    def _external_url(self, key: str) -> str:
        bucket = self._required_bucket()
        endpoint_url = self._string_or_none(self._connection_option("endpoint_url"))
        if endpoint_url:
            endpoint = endpoint_url.rstrip("/")
            encoded_bucket = quote(bucket, safe="")
            encoded_key = quote(key, safe="/")
            return f"{endpoint}/{encoded_bucket}/{encoded_key}"
        return f"s3://{bucket}/{key}"
