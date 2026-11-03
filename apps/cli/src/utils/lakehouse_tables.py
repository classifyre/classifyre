"""Read a lakehouse table found in a bucket as one table.

``utils.lakehouse_layout`` finds the table roots; this module turns a root into
its metadata (columns, row count, version) and its rows, whichever bucket it is
in. A bucket source describes its storage once (``TableStorage``) and every
format reads through it.

Which reader reads what — each one applies the format's deletes and schema
evolution, which is the point of reading the table rather than its files:

* **Delta Lake, Apache Iceberg — DuckDB** (``delta_scan`` / ``iceberg_scan``):
  deletion vectors, positional and equality deletes, column mapping and renames.
* **Lance — pylance**: DuckDB's Lance reader does not take DuckDB's storage
  secrets, so a Lance dataset on S3 or Azure was unreadable through it.
* **Apache Hudi — hudi-rs** (the ``hudi`` package): copy-on-write and merge-on-read
  snapshot reads. DuckDB has only a community extension.
* **Apache Paimon — pypaimon**: native reader, merges primary-key tables.
  DuckDB's community extension reads local tables only: it cannot be handed
  storage credentials.

Metadata comes from the table's own small metadata files, read through the
bucket source's client (``read``), never from a full scan: a Delta log replay, an
Iceberg ``metadata.json``, a Paimon snapshot, Hudi's ``hoodie.properties``. The
row count is reported only where it is exact — it is what lets a sampling window
prove a table was read to the end.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from .duckdb_engine import connect, load_extension, sql_literal
from .lakehouse_layout import DELTA, HUDI, ICEBERG, LANCE, PAIMON
from .table_files import TableBatch

logger = logging.getLogger(__name__)

_DEFAULT_BATCH_ROWS = 1000

ReadObject = Callable[[str], bytes]


@dataclass(frozen=True)
class TableStorage:
    """How a bucket source lets the table readers reach its storage.

    ``uri`` maps an object key to the URI the readers open (``s3://bucket/key``,
    ``az://container/key``, ``gs://bucket/key`` or a local path).
    ``duckdb_secret`` is the body of a ``CREATE SECRET`` (None for local paths)
    and ``duckdb_extensions`` the filesystem extensions it needs.
    ``object_store_options`` configure the Rust readers (pylance, hudi-rs) and
    ``paimon_options`` pypaimon's filesystem. ``unreadable`` maps a format this
    storage cannot serve to the reason, which the scan logs instead of failing.
    """

    uri: Callable[[str], str]
    duckdb_secret: str | None = None
    duckdb_extensions: tuple[str, ...] = ()
    object_store_options: dict[str, str] = field(default_factory=dict)
    paimon_options: dict[str, str] = field(default_factory=dict)
    unreadable: dict[str, str] = field(default_factory=dict)


@dataclass
class LakehouseTable:
    """One table: where it is, what it is, and what its metadata says."""

    root: str
    table_format: str
    storage: TableStorage
    keys: list[str]
    # Iceberg: metadata file stem. Delta/Lance: version. Paimon: snapshot id.
    version: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def uri(self) -> str:
        return self.storage.uri(self.root)

    @property
    def row_count(self) -> int | None:
        value = self.metadata.get("row_count")
        return value if isinstance(value, int) else None

    def fingerprint(self) -> str:
        """Changes whenever the table does: its format and current version."""
        return f"{self.table_format}:{self.version or ''}"


# ── Metadata ─────────────────────────────────────────────────────────────


def describe_table(table: LakehouseTable, read: ReadObject) -> LakehouseTable:
    """Fill ``version`` and ``metadata`` from the table's metadata files.

    Best effort: a table whose metadata cannot be parsed is still read (its
    reader knows the format better than this summary does), it just reports
    less about itself.
    """
    describers = {
        DELTA: _describe_delta,
        ICEBERG: _describe_iceberg,
        PAIMON: _describe_paimon,
        HUDI: _describe_hudi,
        LANCE: _describe_lance,
    }
    try:
        describers[table.table_format](table, read)
    except Exception as exc:
        logger.warning("Could not read %s metadata for %s: %s", table.table_format, table.root, exc)
    table.metadata["table_format"] = table.table_format
    return table


def _relative(table: LakehouseTable, key: str) -> str:
    return key[len(table.root) :].lstrip("/")


_DELTA_COMMIT_RE = re.compile(r"_delta_log/(\d{20})\.json$")
_DELTA_CHECKPOINT_RE = re.compile(r"_delta_log/(\d{20})\.checkpoint(?:\.\d+\.\d+)?\.parquet$")


def _describe_delta(table: LakehouseTable, read: ReadObject) -> None:
    """Replay the Delta log: the latest checkpoint, then every commit after it."""
    import io

    commits = sorted(
        (int(m.group(1)), key) for key in table.keys if (m := _DELTA_COMMIT_RE.search(key))
    )
    checkpoints: dict[int, list[str]] = {}
    for key in table.keys:
        if m := _DELTA_CHECKPOINT_RE.search(key):
            checkpoints.setdefault(int(m.group(1)), []).append(key)
    if not commits and not checkpoints:
        return
    latest = max([v for v, _ in commits] + list(checkpoints))
    table.version = str(latest)

    adds: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    protocol: dict[str, Any] = {}
    start = -1
    if checkpoints:
        start = max(checkpoints)
        import pyarrow.parquet as pq

        for key in checkpoints[start]:
            rows = pq.read_table(io.BytesIO(read(key))).to_pylist()
            for row in rows:
                _apply_delta_action(row, adds, meta, protocol)
    for version, key in commits:
        if version <= start:
            continue
        for line in read(key).decode("utf-8").splitlines():
            if line.strip():
                _apply_delta_action(json.loads(line), adds, meta, protocol)

    if meta.get("schemaString"):
        fields = json.loads(meta["schemaString"]).get("fields", [])
        table.metadata["columns"] = [
            {"name": f["name"], "type": f["type"] if isinstance(f["type"], str) else "struct"}
            for f in fields
        ]
    if meta.get("partitionColumns"):
        table.metadata["partition_columns"] = list(meta["partitionColumns"])
    if protocol.get("minReaderVersion") is not None:
        table.metadata["format_version"] = int(protocol["minReaderVersion"])
    table.metadata["num_files"] = len(adds)
    table.metadata["history_length"] = len(commits)
    rows_total = 0
    for add in adds.values():
        stats = add.get("stats")
        records = json.loads(stats).get("numRecords") if isinstance(stats, str) else None
        if records is None:
            return  # without every file's count the total would be a guess
        deleted = (add.get("deletionVector") or {}).get("cardinality") or 0
        rows_total += int(records) - int(deleted)
    table.metadata["row_count"] = rows_total


def _apply_delta_action(
    action: dict[str, Any],
    adds: dict[str, dict[str, Any]],
    meta: dict[str, Any],
    protocol: dict[str, Any],
) -> None:
    if add := action.get("add"):
        adds[str(add["path"])] = add
    if remove := action.get("remove"):
        adds.pop(str(remove["path"]), None)
    if metadata := action.get("metaData"):
        meta.clear()
        meta.update(metadata)
    if proto := action.get("protocol"):
        protocol.clear()
        protocol.update(proto)


_ICEBERG_VERSION_RE = re.compile(r"^(?:v(\d+)|(\d+)-[^/.]+)(?:\.[A-Za-z0-9]+)?\.metadata\.json$")


def iceberg_metadata_version(name: str) -> int | None:
    """The version number in an Iceberg metadata file name, or None."""
    match = _ICEBERG_VERSION_RE.match(name.rsplit("/", 1)[-1])
    return int(match.group(1) or match.group(2)) if match else None


def current_iceberg_metadata_key(keys: list[str], read: ReadObject, root: str) -> str | None:
    """The current ``metadata.json`` of an Iceberg table found by path.

    Ranked by the version in the file name, compared as a number (as text, ``v9``
    sorts after ``v10``). ``version-hint.text`` is read only when no name carries
    a number: a writer bumps it after the new file exists, so it can only lag.
    """
    prefix = f"{root}/metadata/"
    candidates = [k for k in keys if k.startswith(prefix) and k.endswith(".metadata.json")]
    if not candidates:
        return None
    numbered = [(v, k) for k in candidates if (v := iceberg_metadata_version(k)) is not None]
    if numbered:
        return max(numbered)[1]
    try:
        hint = read(f"{prefix}version-hint.text").decode("utf-8", errors="replace").strip()
    except Exception:
        hint = ""
    if hint:
        name = hint.rsplit("/", 1)[-1]
        for key in candidates:
            if key.rsplit("/", 1)[-1] in (name, f"v{name}.metadata.json", f"{name}.metadata.json"):
                return key
    return max(candidates)


def _describe_iceberg(table: LakehouseTable, read: ReadObject) -> None:
    key = current_iceberg_metadata_key(table.keys, read, table.root)
    if key is None:
        return
    table.version = key.rsplit("/", 1)[-1].removesuffix(".metadata.json")
    doc = json.loads(read(key))
    table.metadata["format_version"] = int(doc.get("format-version", 1))
    schema_id = doc.get("current-schema-id")
    schemas = doc.get("schemas") or ([doc["schema"]] if doc.get("schema") else [])
    schema = next(
        (s for s in schemas if s.get("schema-id") == schema_id), schemas[-1] if schemas else None
    )
    if schema:
        table.metadata["columns"] = [
            {"name": f["name"], "type": f["type"] if isinstance(f["type"], str) else "struct"}
            for f in schema.get("fields", [])
        ]
    spec_id = doc.get("default-spec-id")
    for spec in doc.get("partition-specs") or []:
        if spec.get("spec-id") == spec_id and spec.get("fields"):
            table.metadata["partition_columns"] = [f["name"] for f in spec["fields"]]
    snapshot_id = doc.get("current-snapshot-id")
    snapshot = next(
        (s for s in doc.get("snapshots") or [] if s.get("snapshot-id") == snapshot_id), None
    )
    if snapshot is None:
        table.metadata["row_count"] = 0
        table.metadata["num_files"] = 0
        return
    table.metadata["snapshot_id"] = str(snapshot_id)
    summary = snapshot.get("summary") or {}
    if summary.get("total-data-files") is not None:
        table.metadata["num_files"] = int(summary["total-data-files"])
    deletes = sum(
        int(summary.get(name) or 0) for name in ("total-position-deletes", "total-equality-deletes")
    )
    # Records minus deletes is exact only without deletes: an equality delete can
    # match any number of rows, and a position delete may repeat.
    if summary.get("total-records") is not None and deletes == 0:
        table.metadata["row_count"] = int(summary["total-records"])


def _describe_paimon(table: LakehouseTable, read: ReadObject) -> None:
    latest = read(f"{table.root}/snapshot/LATEST").decode("utf-8").strip()
    table.version = latest
    snapshot = json.loads(read(f"{table.root}/snapshot/snapshot-{latest}"))
    schema = json.loads(read(f"{table.root}/schema/schema-{snapshot.get('schemaId', 0)}"))
    table.metadata["columns"] = [
        {"name": f["name"], "type": f["type"] if isinstance(f["type"], str) else "struct"}
        for f in schema.get("fields", [])
    ]
    if schema.get("partitionKeys"):
        table.metadata["partition_columns"] = list(schema["partitionKeys"])
    table.metadata["format_version"] = int(snapshot.get("version", 3))
    table.metadata["snapshot_id"] = str(latest)
    # An append table's record count is its row count. A primary-key table counts
    # every version of a key until compaction merges them.
    if not schema.get("primaryKeys") and snapshot.get("totalRecordCount") is not None:
        table.metadata["row_count"] = int(snapshot["totalRecordCount"])


def _describe_hudi(table: LakehouseTable, read: ReadObject) -> None:
    props: dict[str, str] = {}
    text = read(f"{table.root}/.hoodie/hoodie.properties").decode("utf-8", errors="replace")
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            name, _, value = line.partition("=")
            props[name.strip()] = value.strip()
    if props.get("hoodie.table.version"):
        table.metadata["format_version"] = int(props["hoodie.table.version"])
    if props.get("hoodie.table.partition.fields"):
        table.metadata["partition_columns"] = props["hoodie.table.partition.fields"].split(",")
    if props.get("hoodie.table.type"):
        table.metadata["hudi_table_type"] = props["hoodie.table.type"]
    # The latest completed instant on the timeline is the table's version.
    instants = sorted(
        key.rsplit("/", 1)[-1].split(".", 1)[0]
        for key in table.keys
        if "/.hoodie/" in key
        and re.search(r"/\d{14,}(?:_\d+)?\.(commit|deltacommit|replacecommit)$", key)
    )
    if instants:
        table.version = instants[-1]
    schema = props.get("hoodie.table.create.schema")
    if schema:
        try:
            fields = json.loads(schema.replace("\\:", ":")).get("fields", [])
            table.metadata["columns"] = [
                {"name": f["name"], "type": f["type"] if isinstance(f["type"], str) else "struct"}
                for f in fields
                if not str(f["name"]).startswith("_hoodie_")
            ]
        except (ValueError, KeyError):
            pass


def _describe_lance(table: LakehouseTable, _read: ReadObject) -> None:
    # Manifest names count down from 2**64 in newer datasets, so the version is
    # taken from the dataset rather than from the file names.
    dataset = _lance_dataset(table)
    table.version = str(dataset.version)
    table.metadata["columns"] = [{"name": f.name, "type": str(f.type)} for f in dataset.schema]
    table.metadata["row_count"] = int(dataset.count_rows())
    table.metadata["num_files"] = len(dataset.get_fragments())


# ── Rows ─────────────────────────────────────────────────────────────────


def iter_lakehouse_batches(
    table: LakehouseTable,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
    batch_rows: int = _DEFAULT_BATCH_ROWS,
) -> Iterator[TableBatch]:
    """The table's current rows ``[start_row, start_row + max_rows)`` as batches."""
    begin = max(0, start_row)
    if max_rows is not None and max_rows <= 0:
        return
    if table.table_format in (DELTA, ICEBERG):
        yield from _duckdb_table_batches(table, begin, max_rows, batch_rows)
    elif table.table_format == PAIMON:
        yield from _window(_paimon_batches(table), begin, max_rows)
    elif table.table_format == LANCE:
        dataset = _lance_dataset(table)
        scanner = dataset.scanner(offset=begin or None, limit=max_rows, batch_size=batch_rows)
        yield from _numbered(scanner.to_batches(), begin)
    elif table.table_format == HUDI:
        yield from _window(_hudi_batches(table), begin, max_rows)
    else:
        raise ValueError(f"Unknown lakehouse table format: {table.table_format}")


def _duckdb_table_batches(
    table: LakehouseTable, begin: int, max_rows: int | None, batch_rows: int
) -> Iterator[TableBatch]:
    conn = connect()
    try:
        for extension in (*table.storage.duckdb_extensions, table.table_format):
            load_extension(conn, extension)
        if table.storage.duckdb_secret:
            conn.execute(
                f"CREATE OR REPLACE SECRET lakehouse_storage ({table.storage.duckdb_secret})"
            )
        if table.table_format == DELTA:
            scan = f"delta_scan({sql_literal(table.uri)})"
        elif table.version:
            # Root + version rather than the metadata file's path: only that form
            # takes allow_moved_paths, which resolves a table copied away from
            # the absolute paths it was written with.
            scan = (
                f"iceberg_scan({sql_literal(table.uri)}, allow_moved_paths = true, "
                f"version = {sql_literal(table.version)}, "
                "version_name_format = '%s%s.metadata.json')"
            )
        else:
            # No version (its metadata could not be read): let the reader
            # resolve the current snapshot itself rather than naming an empty
            # version, which matches no metadata file.
            scan = f"iceberg_scan({sql_literal(table.uri)}, allow_moved_paths = true)"
        query = f"SELECT * FROM {scan}"
        if max_rows is not None:
            query += f" LIMIT {int(max_rows)}"
        if begin:
            query += f" OFFSET {int(begin)}"
        yield from _numbered(conn.sql(query).to_arrow_reader(batch_rows), begin)
    finally:
        conn.close()


def _numbered(batches: Any, first_row: int) -> Iterator[TableBatch]:
    row = first_row
    for batch in batches:
        if batch.num_rows:
            yield TableBatch(batch=batch, first_row=row)
            row += batch.num_rows


def _window(batches: Iterator[Any], begin: int, max_rows: int | None) -> Iterator[TableBatch]:
    """Decode-and-drop windowing for readers that cannot skip rows themselves."""
    end = None if max_rows is None else begin + max_rows
    position = 0
    for batch in batches:
        batch_start, position = position, position + batch.num_rows
        if position <= begin:
            continue
        if end is not None and batch_start >= end:
            return
        offset = max(0, begin - batch_start)
        length = batch.num_rows - offset
        if end is not None:
            length = min(length, end - (batch_start + offset))
        if length > 0:
            yield TableBatch(batch=batch.slice(offset, length), first_row=batch_start + offset)


def _require(module_name: str) -> Any:
    from ..detectors.dependencies import require_module

    return require_module(module_name, "lakehouse tables", ["lakehouse"])


def _lance_dataset(table: LakehouseTable) -> Any:
    lance = _require("lance")
    return lance.dataset(table.uri, storage_options=table.storage.object_store_options or None)


def _hudi_batches(table: LakehouseTable) -> Iterator[Any]:
    hudi = _require("hudi")
    builder = hudi.HudiTableBuilder.from_base_uri(table.uri)
    if table.storage.object_store_options:
        builder = builder.with_storage_options(table.storage.object_store_options)
    yield from builder.build().read_snapshot()


def _paimon_batches(table: LakehouseTable) -> Iterator[Any]:
    """A Paimon table is ``<warehouse>/<database>.db/<table>``; open it that way."""
    pypaimon = _require("pypaimon")
    database_dir, _, table_name = table.root.rpartition("/")
    warehouse_key, _, database_name = database_dir.rpartition("/")
    if not database_name.endswith(".db"):
        raise ValueError(f"Paimon table {table.root} is not under a <database>.db folder")
    catalog = pypaimon.CatalogFactory.create(
        {"warehouse": table.storage.uri(warehouse_key), **table.storage.paimon_options}
    )
    paimon_table = catalog.get_table(f"{database_name.removesuffix('.db')}.{table_name}")
    read_builder = paimon_table.new_read_builder()
    splits = read_builder.new_scan().plan().splits()
    yield from read_builder.new_read().to_arrow(splits).to_batches()
