"""Shared fakes for the JVM-free lakehouse source tests (Delta Lake, Iceberg).

The tests run against the real DuckDB engine (dev dependency) over local
Parquet files; only the S3 listing and the format-native table handles are
faked.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb


def write_parquet(path: Path, rows: int = 12) -> Path:
    """Write a small id/email Parquet file and return its path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        "COPY ("
        f"SELECT r AS id, 'user' || r || '@example.com' AS email FROM range({rows}) t(r)"
        f") TO '{path.as_posix()}' (FORMAT PARQUET)"
    )
    return path


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
