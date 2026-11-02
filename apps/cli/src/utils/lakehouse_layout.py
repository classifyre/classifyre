"""Recognise Delta Lake and Apache Iceberg tables from object keys alone.

A lakehouse table is a directory of files, and none of them is the table on its
own: a Delta table's Parquet files include ones its log has removed, an Iceberg
table's include files from every snapshot it keeps, and both carry deletes,
renames and schema changes in metadata no single file reflects. Scanning those
files one by one reports rows the table no longer holds, under column names it
no longer uses.

So the layout is recognised in one place: the Delta Lake and Iceberg sources use
it to find their tables, and the object-storage sources use it to leave a table's
files alone (see ``ObjectStorageSourceBase._without_table_files``).
"""

from __future__ import annotations

import re
from collections.abc import Iterable

DELTA = "delta"
ICEBERG = "iceberg"

DELTA_LOG_MARKER = "/_delta_log/"
_ICEBERG_METADATA_KEY_RE = re.compile(r"^(?P<root>.*?)/?metadata/[^/]+\.metadata\.json$")


def delta_table_root(key: str) -> str | None:
    """The table root a ``_delta_log/`` key belongs to, else None."""
    marker = key.find(DELTA_LOG_MARKER)
    if marker < 0:
        return None
    return key[:marker] or None


def iceberg_table_root(key: str) -> str | None:
    """The table root a ``metadata/*.metadata.json`` key belongs to, else None."""
    match = _ICEBERG_METADATA_KEY_RE.match(key)
    if not match:
        return None
    return match.group("root") or None


def table_roots(keys: Iterable[str]) -> dict[str, str]:
    """``{table root: format}`` for every Delta or Iceberg table among ``keys``."""
    roots: dict[str, str] = {}
    for key in keys:
        root = delta_table_root(key)
        if root:
            roots.setdefault(root.strip("/"), DELTA)
            continue
        root = iceberg_table_root(key)
        if root:
            roots.setdefault(root.strip("/"), ICEBERG)
    return roots


def table_root_of(key: str, roots: dict[str, str]) -> str | None:
    """The table root ``key`` lies under, or None when it is an ordinary file."""
    parts = key.strip("/").split("/")
    for depth in range(len(parts) - 1, 0, -1):
        candidate = "/".join(parts[:depth])
        if candidate in roots:
            return candidate
    return None
