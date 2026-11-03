"""Catalog and engine sources for lakehouses: DuckLake, Iceberg REST, Trino,
Athena, BigQuery, Redshift.

DuckLake runs against a real local lake (DuckDB's ``ducklake`` extension). The
others talk to services, so their drivers are faked here and the lab
(``development/lakehouse-lab``) runs them against real Polaris, Gravitino and Trino.
"""

from __future__ import annotations

import base64
import json
import re
import sys
import types
from pathlib import Path
from typing import Any

import duckdb
import pytest

from src.sources.athena.source import _presto_view_sql, glue_table_format
from src.sources.bigquery.source import BigQuerySource, bigquery_table_format
from src.sources.ducklake.source import DuckLakeSource
from src.sources.iceberg_rest.source import IcebergRestSource
from src.sources.redshift.source import spectrum_table_format
from src.sources.trino.source import TrinoSource
from src.utils.duckdb_engine import DuckDBExtensionUnavailableError, load_extension

# ── DuckLake (real) ──────────────────────────────────────────────────────


def _lake(tmp_path: Path, rows: int = 12) -> Path:
    conn = duckdb.connect()
    try:
        load_extension(conn, "ducklake")
    except DuckDBExtensionUnavailableError as exc:
        pytest.skip(str(exc))
    catalog = tmp_path / "meta.ducklake"
    conn.execute(f"ATTACH 'ducklake:{catalog}' AS lake (DATA_PATH '{tmp_path / 'data'}/')")
    conn.execute(
        "CREATE TABLE lake.people AS SELECT r AS id, 'person' || r || '@lake.example.com' AS email "
        f"FROM range(1, {rows + 2}) t(r)"
    )
    conn.execute("DELETE FROM lake.people WHERE id = 2")
    conn.execute("ALTER TABLE lake.people RENAME COLUMN email TO contact")
    conn.close()
    return catalog


def _ducklake(catalog: Path, sampling: dict) -> DuckLakeSource:
    return DuckLakeSource(
        {
            "type": "DUCKLAKE",
            "required": {"catalog": str(catalog)},
            "masked": {},
            "sampling": sampling,
        },
        source_id="s",
        runner_id="r",
    )


async def test_ducklake_fetch_content_pages_batches_for_all_strategy(tmp_path: Path) -> None:
    """rows_per_page=10 over 12 live rows: every row, deletes applied, renames resolved."""
    source = _ducklake(_lake(tmp_path), {"strategy": "ALL", "rows_per_page": 10})
    assets = [a async for batch in source.extract_raw() for a in batch]
    assert [a.name for a in assets] == ["meta.ducklake.main.people"]
    table = assets[0]
    assert table.metadata["table_format"] == "ducklake"
    assert [c["name"] for c in table.metadata["columns"]] == ["id", "contact"]
    pages = [text async for _raw, text in source.fetch_content_pages(table.hash)]
    text = "\n".join(pages)
    assert text.count("row_") == 12
    assert "person2@lake.example.com" not in text
    assert "person13@lake.example.com" in text
    source.cleanup()


# ── Iceberg REST (attach statements) ─────────────────────────────────────


class _Recorder:
    def __init__(self) -> None:
        self.sql: list[str] = []

    def execute(self, sql: str, *_args: Any) -> _Recorder:
        self.sql.append(sql)
        return self


def _attach_sql(
    monkeypatch: pytest.MonkeyPatch, required: dict, masked: dict, connection: dict
) -> str:
    monkeypatch.setattr("src.sources.iceberg_rest.source.load_extension", lambda *_a: None)
    source = IcebergRestSource(
        {
            "type": "ICEBERG_REST",
            "required": required,
            "masked": masked,
            "optional": {"connection": connection},
            "sampling": {"strategy": "ALL"},
        }
    )
    recorder = _Recorder()
    source._attach(recorder)
    return "\n".join(recorder.sql)


def test_iceberg_rest_oauth2_attach(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = _attach_sql(
        monkeypatch,
        {"catalog_uri": "https://polaris.example.com/api/catalog", "auth_mode": "oauth2"},
        {"client_id": "svc", "client_secret": "pw"},
        {"warehouse": "analytics", "oauth2_scope": "PRINCIPAL_ROLE:ALL"},
    )
    assert "CLIENT_ID 'svc'" in sql
    assert "OAUTH2_SERVER_URI 'https://polaris.example.com/api/catalog/v1/oauth/tokens'" in sql
    assert "OAUTH2_SCOPE 'PRINCIPAL_ROLE:ALL'" in sql
    assert re.search(
        r"ATTACH 'analytics' AS catalog \(TYPE iceberg, ENDPOINT .*SECRET iceberg_catalog\)", sql
    )


def test_iceberg_rest_s3_tables_signs_with_sigv4(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = _attach_sql(
        monkeypatch,
        {"catalog_uri": "https://s3tables.us-east-1.amazonaws.com/iceberg", "auth_mode": "sigv4"},
        {"aws_access_key_id": "AK", "aws_secret_access_key": "SK"},
        {
            "warehouse": "arn:aws:s3tables:us-east-1:111122223333:bucket/lab",
            "sigv4_region": "us-east-1",
        },
    )
    assert "TYPE S3, KEY_ID 'AK', SECRET 'SK', REGION 'us-east-1'" in sql
    assert "ENDPOINT_TYPE s3_tables" in sql


def test_iceberg_rest_without_vending_uses_own_storage_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sql = _attach_sql(
        monkeypatch,
        {"catalog_uri": "http://catalog:8181", "auth_mode": "none"},
        {"storage_access_key_id": "lab", "storage_secret_access_key": "secret"},
        {"access_delegation": "none", "storage_s3_endpoint": "http://minio:9000"},
    )
    assert "AUTHORIZATION_TYPE 'none'" in sql
    assert "ACCESS_DELEGATION_MODE 'none'" in sql
    assert "ENDPOINT 'minio:9000', URL_STYLE 'path', USE_SSL false" in sql


def test_iceberg_rest_oauth2_needs_client_credentials() -> None:
    with pytest.raises(ValueError, match="client_id"):
        IcebergRestSource(
            {
                "type": "ICEBERG_REST",
                "required": {"catalog_uri": "https://c.example.com", "auth_mode": "oauth2"},
                "masked": {},
                "sampling": {"strategy": "ALL"},
            }
        )


# ── Trino (fake driver) ──────────────────────────────────────────────────


class _TrinoCursor:
    def __init__(self, data: dict[str, list[tuple]]) -> None:
        self._data = data
        self._rows: list[tuple] = []
        self.description: list[tuple] = []
        self.queries: list[str] = data.setdefault("__log__", [])  # type: ignore[assignment]

    def __enter__(self) -> _TrinoCursor:
        return self

    def __exit__(self, *_a: object) -> None:
        return None

    def execute(self, query: str, *_args: Any) -> None:
        self.queries.append(query)
        if "system.metadata.catalogs" in query:
            self._rows = [("lake", "iceberg"), ("system", "system")]
        elif "information_schema.tables" in query:
            self._rows = [
                ("crm", "people", "BASE TABLE"),
                ("information_schema", "tables", "BASE TABLE"),
            ]
        elif "information_schema.columns" in query:
            self._rows = [("id", "bigint"), ("email", "varchar")]
        elif "information_schema.views" in query:
            self._rows = []
        elif 'FROM "lake"."crm"."people"' in query:
            people = [(i, f"p{i}@trino.example.com") for i in range(1, 13)]
            match = re.search(r"OFFSET (\d+) LIMIT (\d+)", query)
            if match:
                start, size = int(match.group(1)), int(match.group(2))
                people = people[start : start + size]
            self._rows = people
            self.description = [("id",), ("email",)]
        else:
            self._rows = []

    def fetchall(self) -> list[tuple]:
        rows, self._rows = self._rows, []
        return rows

    def fetchmany(self, size: int) -> list[tuple]:
        rows, self._rows = self._rows[:size], self._rows[size:]
        return rows

    def close(self) -> None:
        return None


def _trino(monkeypatch: pytest.MonkeyPatch, sampling: dict) -> tuple[TrinoSource, dict]:
    data: dict[str, list[tuple]] = {}
    dbapi = types.SimpleNamespace(
        connect=lambda **_kw: types.SimpleNamespace(
            cursor=lambda: _TrinoCursor(data), close=lambda: None
        )
    )
    auth = types.SimpleNamespace(BasicAuthentication=lambda *a: a, JWTAuthentication=lambda t: t)
    modules = {"trino.dbapi": dbapi, "trino.auth": auth}
    monkeypatch.setattr(
        "src.sources.trino.source.require_module", lambda module_name, **_kw: modules[module_name]
    )
    source = TrinoSource(
        {
            "type": "TRINO",
            "required": {"host": "trino.lab", "port": 8080},
            "masked": {"username": "reader"},
            "sampling": sampling,
        },
        source_id="s",
        runner_id="r",
    )
    return source, data


async def test_trino_fetch_content_pages_batches_for_all_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, _data = _trino(monkeypatch, {"strategy": "ALL", "rows_per_page": 10})
    assets = [a async for batch in source.extract_raw() for a in batch]
    assert [a.name for a in assets] == ["lake.crm.people"]  # system catalog and schema skipped
    assert assets[0].metadata["table_format"] == "iceberg"
    # 8080 is Trino's default port, so the URN leaves it out.
    assert assets[0].urn == "trino://trino.lab/lake/crm/people"
    pages = [text async for _raw, text in source.fetch_content_pages(assets[0].hash)]
    assert "\n".join(pages).count("row_") == 12


async def test_trino_automatic_pages_with_inline_offset(monkeypatch: pytest.MonkeyPatch) -> None:
    source, data = _trino(monkeypatch, {"strategy": "AUTOMATIC", "rows_per_page": 10})
    assets = [a async for batch in source.extract_raw() for a in batch]
    pages = [text async for _raw, text in source.fetch_content_pages(assets[0].hash)]
    assert "\n".join(pages).count("row_") == 10
    assert any("OFFSET 0 LIMIT 10" in q for q in data["__log__"])  # type: ignore[union-attr]


# ── Athena, BigQuery, Redshift (format detection, views) ─────────────────


def test_glue_tables_say_their_format() -> None:
    assert (
        glue_table_format({"TableType": "EXTERNAL_TABLE", "Parameters": {"table_type": "ICEBERG"}})
        == "iceberg"
    )
    assert glue_table_format({"Parameters": {"spark.sql.sources.provider": "delta"}}) == "delta"
    hudi = {"StorageDescriptor": {"InputFormat": "org.apache.hudi.hadoop.HoodieParquetInputFormat"}}
    assert glue_table_format(hudi) == "hudi"
    assert glue_table_format({"TableType": "VIRTUAL_VIEW"}) == "view"
    assert glue_table_format({"TableType": "EXTERNAL_TABLE"}) == "external"


def test_athena_view_sql_is_decoded_from_the_presto_comment() -> None:
    payload = base64.b64encode(
        json.dumps({"originalSql": "SELECT * FROM sales.orders"}).encode()
    ).decode()
    assert _presto_view_sql(f"/* Presto View: {payload} */") == "SELECT * FROM sales.orders"


def test_bigquery_tables_say_their_format() -> None:
    def table(table_type: str, properties: dict) -> Any:
        return types.SimpleNamespace(table_type=table_type, _properties=properties)

    assert (
        bigquery_table_format(table("TABLE", {"biglakeConfiguration": {"fileFormat": "PARQUET"}}))
        == "iceberg"
    )
    assert (
        bigquery_table_format(
            table("EXTERNAL", {"externalDataConfiguration": {"sourceFormat": "DELTA_LAKE"}})
        )
        == "delta"
    )
    assert (
        bigquery_table_format(
            table("EXTERNAL", {"externalDataConfiguration": {"sourceFormat": "PARQUET"}})
        )
        == "external"
    )
    assert bigquery_table_format(table("VIEW", {})) == "view"
    assert bigquery_table_format(table("TABLE", {})) == "native"


def test_bigquery_pages_with_list_rows_not_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    """A plain read costs nothing: tabledata.list, never a billed query."""
    field = lambda name: types.SimpleNamespace(name=name, field_type="STRING")  # noqa: E731
    table = types.SimpleNamespace(
        table_type="TABLE", schema=[field("id"), field("email")], _properties={}
    )
    calls: list[tuple] = []

    class _Client:
        def get_table(self, _ref: str) -> Any:
            return table

        def list_rows(self, _table: Any, **kwargs: Any) -> list[Any]:
            calls.append(("list_rows", kwargs.get("start_index"), kwargs.get("max_results")))
            return [
                types.SimpleNamespace(values=lambda i=i: (i, f"b{i}@bq.example.com"))
                for i in range(3)
            ]

        def query(self, *_a: Any, **_kw: Any) -> Any:
            raise AssertionError("a plain page must not run a query")

    source = BigQuerySource(
        {
            "type": "BIGQUERY",
            "required": {"project_id": "acme"},
            "masked": {},
            "sampling": {"strategy": "AUTOMATIC"},
        }
    )
    monkeypatch.setattr(source, "_client", _Client)
    from src.sources.tabular_utils import TableRef

    rows, names = source._fetch_one_page(
        TableRef(database="acme", schema="crm", table="people"), "", 10, 20
    )
    assert calls == [("list_rows", 20, 10)]
    assert names == ["id", "email"] and len(rows) == 3


def test_spectrum_tables_say_their_format() -> None:
    assert spectrum_table_format("org.apache.hudi.hadoop.HoodieParquetInputFormat", "") == "hudi"
    assert spectrum_table_format("", '{"table_type":"ICEBERG"}') == "iceberg"
    assert (
        spectrum_table_format("org.apache.hadoop.hive.ql.io.SymlinkTextInputFormat", "") == "delta"
    )
    assert (
        spectrum_table_format("org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat", "")
        == "external"
    )


def test_new_sources_are_registered() -> None:
    from src.sources import list_available_sources

    available = set(list_available_sources())
    assert {"iceberg_rest", "ducklake", "trino", "athena", "bigquery", "redshift"} <= available
    assert not {"delta_lake", "iceberg"} & available
    assert "src.sources.delta_lake" not in sys.modules
