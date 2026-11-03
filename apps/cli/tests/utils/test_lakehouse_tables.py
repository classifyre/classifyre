"""Lakehouse tables found in a bucket or folder, read as one table each.

The Delta and Iceberg fixtures are committed (``tests/fixtures/lakehouse``, see
``make_fixtures.py``): a Delta table with a deleted row whose old file is still on
disk, and an Iceberg table with a renamed column, written elsewhere. Lance and
Paimon tables are written per test when their readers are installed (the
``lakehouse`` group); those tests skip otherwise.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pyarrow as pa
import pytest

from src.pipeline.payload_window import PayloadWindowStore
from src.sources.local_folder.source import LocalFolderSource
from src.utils import lakehouse_tables
from src.utils.lakehouse_layout import (
    DELTA,
    HUDI,
    ICEBERG,
    LANCE,
    PAIMON,
    table_root_of,
    table_roots,
)
from src.utils.lakehouse_tables import (
    LakehouseTable,
    TableStorage,
    current_iceberg_metadata_key,
    describe_table,
    iter_lakehouse_batches,
)
from src.utils.urn import Urn

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "lakehouse"


# ── Detection ────────────────────────────────────────────────────────────


def test_every_format_is_recognised_by_its_marker() -> None:
    keys = [
        "w/orders/_delta_log/00000000000000000000.json",
        "w/orders/part-0.parquet",
        "w/contacts/metadata/00001-a.metadata.json",
        "w/contacts/data/x.parquet",
        "w/crm.db/people/snapshot/LATEST",
        "w/crm.db/people/schema/schema-0",
        "w/trips/.hoodie/hoodie.properties",
        "w/trips/.hoodie/metadata/.hoodie/hoodie.properties",
        "w/vectors.lance/_versions/1.manifest",
        "w/vectors.lance/data/a.lance",
        "plain/report.csv",
    ]
    assert table_roots(keys) == {
        "w/orders": DELTA,
        "w/contacts": ICEBERG,
        "w/crm.db/people": PAIMON,
        "w/trips": HUDI,
        "w/vectors.lance": LANCE,
    }
    assert table_root_of("plain/report.csv", table_roots(keys)) is None


def test_a_uniform_table_is_read_as_delta() -> None:
    """Delta with UniForm also writes Iceberg metadata; Delta is the native format."""
    keys = ["t/_delta_log/00000000000000000000.json", "t/metadata/v1.metadata.json"]
    assert table_roots(keys) == {"t": DELTA}


def test_a_snapshot_folder_alone_is_not_a_paimon_table() -> None:
    assert table_roots(["backups/snapshot/LATEST"]) == {}


# ── Metadata and rows ────────────────────────────────────────────────────


def _local_table(base: Path, root: str, table_format: str) -> LakehouseTable:
    keys = [p.relative_to(base).as_posix() for p in (base / root).rglob("*") if p.is_file()]
    table = LakehouseTable(
        root=root,
        table_format=table_format,
        storage=TableStorage(uri=lambda key: str(base / key)),
        keys=keys,
    )
    return describe_table(table, lambda key: (base / key).read_bytes())


def _rows(table: LakehouseTable, **window: int) -> list[dict]:
    return [
        row for item in iter_lakehouse_batches(table, **window) for row in item.batch.to_pylist()
    ]


def test_delta_table_reads_live_rows_only() -> None:
    table = _local_table(_FIXTURES, "delta_orders", DELTA)
    assert table.version == "1"
    assert table.metadata["row_count"] == 11
    assert [c["name"] for c in table.metadata["columns"]] == ["id", "email"]
    emails = {row["email"] for row in _rows(table)}
    assert len(emails) == 11
    assert "ada.ferrow2@example.com" not in emails  # deleted; its file is still there


def test_iceberg_table_reads_a_renamed_column_as_one() -> None:
    table = _local_table(_FIXTURES, "iceberg_contacts", ICEBERG)
    assert table.metadata["row_count"] == 12
    rows = _rows(table)
    assert len(rows) == 12
    assert set(rows[0]) == {"id", "contact"}
    assert all(row["contact"] for row in rows)


def test_row_window_is_pushed_down() -> None:
    table = _local_table(_FIXTURES, "delta_orders", DELTA)
    batches = list(iter_lakehouse_batches(table, start_row=4, max_rows=3))
    assert [item.first_row for item in batches] == [4]
    assert batches[0].batch.num_rows == 3


def test_iceberg_metadata_versions_compare_as_numbers() -> None:
    keys = [f"t/metadata/v{n}.metadata.json" for n in range(1, 12)]
    assert (
        current_iceberg_metadata_key(keys, lambda _key: b"", "t") == "t/metadata/v11.metadata.json"
    )


def test_iceberg_version_hint_names_an_unnumbered_file() -> None:
    keys = ["t/metadata/zeta.metadata.json", "t/metadata/alpha.metadata.json"]
    hints = {"t/metadata/version-hint.text": b"alpha.metadata.json\n"}
    assert current_iceberg_metadata_key(keys, hints.__getitem__, "t") == (
        "t/metadata/alpha.metadata.json"
    )


def test_lance_dataset_reads_without_deleted_rows(tmp_path: Path) -> None:
    lance = pytest.importorskip("lance")
    dataset = lance.write_dataset(
        pa.table({"id": [1, 2, 3], "email": ["a@x.test", "b@x.test", "c@x.test"]}),
        str(tmp_path / "people.lance"),
    )
    dataset.delete("id = 2")
    table = _local_table(tmp_path, "people.lance", LANCE)
    assert table.metadata["row_count"] == 2
    assert [row["id"] for row in _rows(table)] == [1, 3]


def test_paimon_primary_key_table_merges_upserts(tmp_path: Path) -> None:
    pypaimon = pytest.importorskip("pypaimon")
    catalog = pypaimon.CatalogFactory.create({"warehouse": str(tmp_path / "wh")})
    catalog.create_database("crm", True)
    schema = pypaimon.Schema.from_pyarrow_schema(
        pa.schema([("id", pa.int64()), ("email", pa.string())]),
        primary_keys=["id"],
        options={"bucket": "1"},
    )
    catalog.create_table("crm.people", schema, True)
    for batch in (
        {"id": [1, 2], "email": ["a@x.test", "b@x.test"]},
        {"id": [2], "email": ["b.updated@x.test"]},
    ):
        paimon_table = catalog.get_table("crm.people")
        builder = paimon_table.new_batch_write_builder()
        writer, commit = builder.new_write(), builder.new_commit()
        writer.write_arrow(pa.table(batch))
        commit.commit(writer.prepare_commit())
        writer.close()
        commit.close()
    table = _local_table(tmp_path, "wh/crm.db/people", PAIMON)
    assert table.version == "2"
    # A primary-key table's record count is not its row count until compaction.
    assert "row_count" not in table.metadata
    assert sorted(row["email"] for row in _rows(table)) == ["a@x.test", "b.updated@x.test"]


# ── In a bucket source ───────────────────────────────────────────────────


def _folder(tmp_path: Path) -> Path:
    root = tmp_path / "lake"
    shutil.copytree(_FIXTURES / "delta_orders", root / "warehouse" / "delta_orders")
    shutil.copytree(_FIXTURES / "iceberg_contacts", root / "warehouse" / "iceberg_contacts")
    (root / "notes.csv").write_text("name,email\nPip Marlow,pip@example.com\n")
    return root


def _source(path: Path, sampling: dict) -> LocalFolderSource:
    return LocalFolderSource(
        {
            "type": "LOCAL_FOLDER",
            "required": {"path": str(path)},
            "masked": {},
            "optional": {},
            "sampling": sampling,
        },
        source_id="s",
        runner_id="r",
    )


async def test_folder_scan_emits_each_table_as_one_asset(tmp_path: Path) -> None:
    source = _source(_folder(tmp_path), {"strategy": "ALL"})
    assets = [a async for batch in source.extract_raw() for a in batch]
    by_name = {a.name: a for a in assets}
    # The tables' own files are not assets; the plain CSV beside them is.
    assert set(by_name) == {"delta_orders", "iceberg_contacts", "notes.csv"}
    delta = by_name["delta_orders"]
    assert delta.asset_kind == "table"
    assert delta.metadata["table_format"] == "delta"
    assert delta.metadata["row_count"] == 11
    assert delta.metadata["table_name"] == "warehouse/delta_orders"
    assert delta.urn and delta.urn.startswith("delta://")
    # The authority holds no path: the URN survives a parse round-trip with the
    # authority the source built it with.
    assert source._lakehouse_authority() == "localhost"
    assert Urn.parse(delta.urn).authority == "localhost"
    assert Urn.parse(delta.urn) == Urn.of(
        "delta", "localhost", *source._lakehouse_prefix(), "warehouse", "delta_orders"
    )
    pages = [text async for _raw, text in source.fetch_content_pages(delta.hash)]
    assert len(pages) == 11
    assert "ada.ferrow2@example.com" not in "".join(pages)


async def test_automatic_window_sweeps_a_table_to_its_end(tmp_path: Path) -> None:
    """Rows 1-10, then 11-12 and done: the metadata's row count proves it."""
    folder = _folder(tmp_path)
    recipe_sampling = {"strategy": "AUTOMATIC", "rows_per_page": 10}
    seen: list[int] = []
    prior: dict | None = None
    for _run in range(2):
        source = _source(folder, recipe_sampling)
        store = PayloadWindowStore.from_recipe({"sampling": recipe_sampling})
        source.attach_payload_windows(store)
        assets = [a async for batch in source.extract_raw() for a in batch]
        table = next(a for a in assets if a.name == "iceberg_contacts")
        if prior is not None:
            store.record_prior([{"hash": table.hash, "cursor": prior}])
        pages = [text async for _raw, text in source.fetch_content_pages(table.hash)]
        seen += [int(page.split(":", 1)[0].removeprefix("row_")) for page in pages]
        prior = store.cursor_payload_for(table)
    assert seen == list(range(1, 13))
    assert prior is not None and prior["exhausted"] is True


async def test_a_format_the_storage_cannot_read_is_skipped(tmp_path: Path, monkeypatch) -> None:
    folder = _folder(tmp_path)
    source = _source(folder, {"strategy": "ALL"})
    storage = source._lakehouse_storage()
    assert storage is not None
    blocked = TableStorage(uri=storage.uri, unreadable={DELTA: "not here"})
    monkeypatch.setattr(source, "_lakehouse_storage", lambda: blocked)
    names = {a.name async for batch in source.extract_raw() for a in batch}
    assert "delta_orders" not in names
    assert "iceberg_contacts" in names


def _iceberg_scan_sql(table_version: str | None, monkeypatch: pytest.MonkeyPatch) -> str:
    queries: list[str] = []

    class _FakeResult:
        def to_arrow_reader(self, _batch_rows: int) -> list:
            return []

    class _FakeConn:
        def execute(self, _sql: str) -> None:
            return None

        def sql(self, query: str) -> _FakeResult:
            queries.append(query)
            return _FakeResult()

        def close(self) -> None:
            return None

    monkeypatch.setattr(lakehouse_tables, "connect", lambda *_args, **_kwargs: _FakeConn())
    monkeypatch.setattr(lakehouse_tables, "load_extension", lambda _conn, _name: None)
    table = LakehouseTable(
        root="warehouse/contacts",
        table_format=ICEBERG,
        storage=TableStorage(uri=lambda key: f"s3://bucket/{key}"),
        keys=[],
        version=table_version,
    )
    list(lakehouse_tables.iter_lakehouse_batches(table))
    assert len(queries) == 1
    return queries[0]


def test_iceberg_scan_omits_version_when_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a version the reader resolves the current snapshot itself.

    An empty version string names no metadata file, so it must be left out.
    """
    assert "version =" not in _iceberg_scan_sql(None, monkeypatch)


def test_iceberg_scan_pins_version_when_known(monkeypatch: pytest.MonkeyPatch) -> None:
    assert "version = 'v1'" in _iceberg_scan_sql("v1", monkeypatch)
