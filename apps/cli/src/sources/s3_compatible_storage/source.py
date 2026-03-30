from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from ...models.generated_input import S3CompatibleStorageInput
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

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
        boto3 = require_module(
            module_name="boto3",
            source_name="S3 Compatible Storage",
            uv_groups=["s3-compatible-storage"],
            detail="S3-compatible storage requires boto3.",
        )

        kwargs: dict[str, Any] = {}
        region_name = self._string_or_none(self._connection_option("region_name"))
        endpoint_url = self._string_or_none(self._connection_option("endpoint_url"))
        aws_access_key_id = self._masked_value("aws_access_key_id")
        aws_secret_access_key = self._masked_value("aws_secret_access_key")
        aws_session_token = self._masked_value("aws_session_token")

        if region_name:
            kwargs["region_name"] = region_name
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        if aws_access_key_id and aws_secret_access_key:
            kwargs["aws_access_key_id"] = aws_access_key_id
            kwargs["aws_secret_access_key"] = aws_secret_access_key
            if aws_session_token:
                kwargs["aws_session_token"] = aws_session_token

        kwargs["verify"] = self._verify_ssl()

        try:
            botocore_config = require_module(
                module_name="botocore.config",
                source_name="S3 Compatible Storage",
                uv_groups=["s3-compatible-storage"],
                detail="S3-compatible storage uses botocore timeout configuration.",
            )
            timeout = int(self._request_timeout_seconds())
            kwargs["config"] = botocore_config.Config(
                connect_timeout=timeout,
                read_timeout=timeout,
            )
        except Exception:
            logger.debug("Could not initialize botocore timeout configuration; using defaults")

        return boto3.client("s3", **kwargs)

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    def _list_objects(self) -> list[ObjectRef]:
        client = self._client()
        bucket = self._required_bucket()
        prefix = self._prefix()
        max_keys = self._max_keys_per_page()

        object_refs: list[ObjectRef] = []
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

                object_refs.append(
                    ObjectRef(
                        key=key,
                        size=size,
                        last_modified=self._parse_datetime(item.get("LastModified")),
                        etag=str(item.get("ETag")).strip('"') if item.get("ETag") else None,
                    )
                )

            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                break

        return object_refs

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None, bool]:
        client = self._client()
        bucket = self._required_bucket()
        max_bytes = self._max_object_bytes()

        params: dict[str, Any] = {"Bucket": bucket, "Key": ref.key}
        truncated = False
        if ref.size > max_bytes:
            params["Range"] = f"bytes=0-{max_bytes - 1}"
            truncated = True

        response = client.get_object(**params)
        body = response["Body"]
        try:
            file_bytes = body.read()
        finally:
            try:
                body.close()
            except Exception:
                logger.debug("Failed to close S3 response body")

        content_type = response.get("ContentType")
        return file_bytes, str(content_type) if content_type else None, truncated

    def _external_url(self, key: str) -> str:
        bucket = self._required_bucket()
        endpoint_url = self._string_or_none(self._connection_option("endpoint_url"))
        if endpoint_url:
            endpoint = endpoint_url.rstrip("/")
            encoded_bucket = quote(bucket, safe="")
            encoded_key = quote(key, safe="/")
            return f"{endpoint}/{encoded_bucket}/{encoded_key}"
        return f"s3://{bucket}/{key}"
