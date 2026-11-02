"""Shared fakes for the JVM-free lakehouse source tests (Delta Lake, Iceberg).

The tests run against the real DuckDB engine (``delta_scan`` / ``iceberg_scan``)
over committed fixture tables in ``tests/fixtures/lakehouse``; only the S3
listing and the format-native metadata handles are faked.
"""

from __future__ import annotations

from typing import Any


class FakeS3Client:
    """Minimal boto3-style client: paginated list_objects_v2 over fixed keys."""

    def __init__(self, keys: list[str]) -> None:
        self._keys = keys
        self.list_calls: list[dict[str, Any]] = []

    def list_objects_v2(self, **params: Any) -> dict[str, Any]:
        self.list_calls.append(params)
        prefix = params.get("Prefix") or ""
        matched = [k for k in self._keys if k.startswith(prefix)]
        return {
            "Contents": [{"Key": k, "Size": 1} for k in matched],
            "IsTruncated": False,
        }
