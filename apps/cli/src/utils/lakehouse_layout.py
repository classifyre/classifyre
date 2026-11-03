"""Recognise lakehouse tables from object keys alone.

A lakehouse table is a directory of files, and none of them is the table on its
own: a Delta table's Parquet files include ones its log has removed, an Iceberg
or Hudi table's include files from every snapshot it keeps, and all of them carry
deletes, renames and schema changes in metadata no single file reflects. Scanning
those files one by one reports rows the table no longer holds, under column names
it no longer uses.

So every bucket source (S3, Azure Blob, GCS, local folder) recognises the layout
here, leaves the table's files alone, and reads each table as one asset through
its format's own reader (``utils.lakehouse_tables``).

Markers, checked on keys only so discovery reads nothing:

* Delta Lake — ``<root>/_delta_log/…``
* Apache Iceberg — ``<root>/metadata/<name>.metadata.json``
* Apache Paimon — ``<root>/snapshot/…`` and ``<root>/schema/schema-<n>`` both present
* Apache Hudi — ``<root>/.hoodie/…``
* Lance — ``<root>/_versions/<n>.manifest``

A directory can carry more than one: a Delta table with UniForm also writes
Iceberg metadata, and Apache XTable translates any of them into the others. Then
``FORMAT_PRECEDENCE`` picks the reader, native format first.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

DELTA = "delta"
ICEBERG = "iceberg"
PAIMON = "paimon"
HUDI = "hudi"
LANCE = "lance"

# Which reader wins when one directory carries several formats' metadata.
FORMAT_PRECEDENCE = (DELTA, ICEBERG, PAIMON, HUDI, LANCE)

DELTA_LOG_MARKER = "/_delta_log/"
HUDI_MARKER = "/.hoodie/"
_ICEBERG_METADATA_KEY_RE = re.compile(r"^(?P<root>.*?)/?metadata/[^/]+\.metadata\.json$")
_PAIMON_SNAPSHOT_RE = re.compile(r"^(?P<root>.+)/snapshot/(?:LATEST|EARLIEST|snapshot-\d+)$")
_PAIMON_SCHEMA_RE = re.compile(r"^(?P<root>.+)/schema/schema-\d+$")
_LANCE_MANIFEST_RE = re.compile(r"^(?P<root>.+)/_versions/[^/]+\.manifest$")


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


def hudi_table_root(key: str) -> str | None:
    """The table root a ``.hoodie/`` key belongs to, else None."""
    marker = key.find(HUDI_MARKER)
    if marker < 0:
        return None
    return key[:marker] or None


def lance_table_root(key: str) -> str | None:
    """The dataset root a ``_versions/*.manifest`` key belongs to, else None."""
    match = _LANCE_MANIFEST_RE.match(key)
    return match.group("root") if match else None


def table_roots(keys: Iterable[str]) -> dict[str, str]:
    """``{table root: format}`` for every lakehouse table among ``keys``."""
    found: dict[str, set[str]] = {}
    paimon_snapshots: set[str] = set()
    paimon_schemas: set[str] = set()

    def note(root: str | None, table_format: str) -> None:
        if root:
            found.setdefault(root.strip("/"), set()).add(table_format)

    for key in keys:
        note(delta_table_root(key), DELTA)
        note(iceberg_table_root(key), ICEBERG)
        note(hudi_table_root(key), HUDI)
        note(lance_table_root(key), LANCE)
        if match := _PAIMON_SNAPSHOT_RE.match(key):
            paimon_snapshots.add(match.group("root").strip("/"))
        elif match := _PAIMON_SCHEMA_RE.match(key):
            paimon_schemas.add(match.group("root").strip("/"))

    # A Paimon table always has both; either alone is just a folder name.
    for root in paimon_snapshots & paimon_schemas:
        found.setdefault(root, set()).add(PAIMON)

    roots: dict[str, str] = {}
    for root, formats in found.items():
        roots[root] = next(f for f in FORMAT_PRECEDENCE if f in formats)
    # A table nested inside another table's directory is that table's own file
    # (Hudi keeps Iceberg-shaped metadata under .hoodie/ with XTable, a Delta
    # table's _delta_log may hold anything): only the outermost root counts.
    return {root: fmt for root, fmt in roots.items() if table_root_of(root, roots) is None}


def table_root_of(key: str, roots: dict[str, str]) -> str | None:
    """The table root ``key`` lies under, or None when it is an ordinary file."""
    parts = key.strip("/").split("/")
    for depth in range(len(parts) - 1, 0, -1):
        candidate = "/".join(parts[:depth])
        if candidate in roots:
            return candidate
    return None
