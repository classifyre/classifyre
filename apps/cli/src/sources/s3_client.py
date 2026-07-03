"""Shared boto3 client construction for S3-compatible storage.

Used by the S3 Compatible Storage object source and the lakehouse sources
(Delta Lake, Iceberg), which reuse the same connection configuration shape:
optional static credentials in ``masked`` plus ``region_name`` /
``endpoint_url`` / ``request_timeout_seconds`` / ``verify_ssl`` under
``optional.connection``.
"""

from __future__ import annotations

import logging
from typing import Any

from .dependencies import require_module

logger = logging.getLogger(__name__)


def build_s3_client(
    *,
    source_name: str,
    uv_groups: list[str],
    region_name: str | None = None,
    endpoint_url: str | None = None,
    aws_access_key_id: str | None = None,
    aws_secret_access_key: str | None = None,
    aws_session_token: str | None = None,
    verify_ssl: bool = True,
    request_timeout_seconds: float = 30,
) -> Any:
    """Build a boto3 S3 client from S3-compatible connection settings.

    Falls back to the ambient AWS credentials chain when no static keys are
    provided (matching the S3 Compatible Storage source behavior).
    """
    boto3 = require_module(
        module_name="boto3",
        source_name=source_name,
        uv_groups=uv_groups,
        detail=f"{source_name} requires boto3 for S3-compatible storage access.",
    )

    kwargs: dict[str, Any] = {}
    if region_name:
        kwargs["region_name"] = region_name
    if endpoint_url:
        kwargs["endpoint_url"] = endpoint_url
    if aws_access_key_id and aws_secret_access_key:
        kwargs["aws_access_key_id"] = aws_access_key_id
        kwargs["aws_secret_access_key"] = aws_secret_access_key
        if aws_session_token:
            kwargs["aws_session_token"] = aws_session_token

    kwargs["verify"] = verify_ssl

    try:
        botocore_config = require_module(
            module_name="botocore.config",
            source_name=source_name,
            uv_groups=uv_groups,
            detail=f"{source_name} uses botocore timeout configuration.",
        )
        timeout = int(request_timeout_seconds)
        kwargs["config"] = botocore_config.Config(
            connect_timeout=timeout,
            read_timeout=timeout,
        )
    except Exception:
        logger.debug("Could not initialize botocore timeout configuration; using defaults")

    return boto3.client("s3", **kwargs)
