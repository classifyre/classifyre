"""SQL over asset tables (src/query): the gate, the session, the runner."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from src.query.runner import RESULT_MARKER, ensure_dependencies, run_query, run_query_command
from src.utils.uv_sync import auto_install_enabled, sync_group

# DuckDB, pyarrow (file-processing) and SQLGlot (lineage) are optional groups.
# Register them with the shared installer, which re-syncs the venv with every
# group it knows of: a group synced only by the test script is unknown to it,
# and the first on-demand install by another test (another group, --no-dev)
# would remove it mid-run.
if auto_install_enabled():
    for _group in ("file-processing", "lineage"):
        sync_group(_group)
try:
    ensure_dependencies()
except Exception as exc:  # auto-install off and the groups absent
    pytest.skip(f"query dependencies unavailable: {exc}", allow_module_level=True)

from src.query.gate import QueryRefusedError, TableName, validate

duckdb = pytest.importorskip("duckdb")
pa = pytest.importorskip("pyarrow")
pytest.importorskip("pyarrow.parquet")

ALLOWED = {
    TableName.of("crm", "public", "customers"),
    TableName.of("lake", "shop", "orders"),
}

# The proof of concept's bypass list, plus the ways a table-level allowlist can
# be walked around: system catalogs, hidden attachments, paths, table functions.
BYPASSES = [
    "SELECT * FROM __src_0.public.customers",
    "SELECT * FROM postgres_query('__src_crm', 'select * from customers')",
    "SELECT * FROM read_parquet('s3://poc-raw/orders/a.parquet')",
    "SELECT * FROM information_schema.columns",
    "SELECT * FROM crm.information_schema.columns",
    "SELECT * FROM duckdb_views()",
    "SELECT current_setting('secret')",
    "SELECT getenv('HOME')",
    "SELECT * FROM query('SELECT * FROM __src_crm.public.customers')",
    "SELECT * FROM 's3://poc-raw/orders/a.parquet'",
    'SELECT * FROM crm.public."/tmp/sensitive.parquet"',
    'SELECT * FROM crm.public."../../credentials/src-crm/password"',
    "SET enable_external_access=true",
    "ATTACH '/tmp/raw.duckdb' AS x",
    "SELECT 1; SELECT 2",
    "COPY (SELECT * FROM crm.public.customers) TO '/tmp/leak'",
    "WITH x AS (DELETE FROM crm.public.customers RETURNING *) SELECT * FROM x",
    "SELECT * FROM customers",
    "SELECT * FROM public.customers",
    "SELECT * FROM crm.public.not_granted",
    "INSERT INTO crm.public.customers VALUES (1)",
    "PRAGMA database_list",
    "SELECT * FROM glob('*')",
    "SELECT * FROM crm.public.customers c, LATERAL read_csv('x')",
    "CREATE TABLE t AS SELECT 1",
    "DESCRIBE crm.public.customers",
    "SHOW TABLES",
    "SELECT load_extension('x')",
    "SELECT * FROM 'data.csv'",
    "SELECT * FROM sqlite_master",
    "USE crm",
    "SELECT crm.public.f(1)",
    "SELECT * FROM (FROM read_json('x'))",
    "",
]


@pytest.mark.parametrize("sql", BYPASSES)
def test_gate_refuses_bypasses(sql: str) -> None:
    with pytest.raises(QueryRefusedError):
        validate(sql, ALLOWED)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM crm.public.customers",
        "SELECT * FROM CRM.Public.Customers",
        "WITH x AS (SELECT * FROM crm.public.customers) SELECT * FROM x",
        "SELECT c.country, count(*), sum(o.amount) FROM crm.public.customers c "
        "JOIN lake.shop.orders o ON o.customer_id = c.id GROUP BY ALL ORDER BY 2 DESC",
        "SELECT date_trunc('month', created_at), strftime(created_at, '%Y'), "
        "coalesce(a, b), id::text FROM crm.public.customers WHERE name ILIKE '%a%'",
        "SELECT row_number() OVER (PARTITION BY country ORDER BY id) FROM crm.public.customers",
        "SELECT * EXCLUDE (iban) FROM crm.public.customers",
        "SELECT * FROM crm.public.customers UNION ALL SELECT * FROM crm.public.customers",
    ],
)
def test_gate_accepts_analytics(sql: str) -> None:
    checked = validate(sql, ALLOWED)
    assert checked.tables
    assert '"crm"' in checked.sql or '"lake"' in checked.sql


def test_gate_reports_only_tables_read() -> None:
    checked = validate("SELECT * FROM lake.shop.orders", ALLOWED)
    assert checked.tables == {TableName.of("lake", "shop", "orders")}


# ── session over local files ─────────────────────────────────────────────


@pytest.fixture()
def folder(tmp_path: Path) -> Path:
    conn = duckdb.connect()
    conn.execute(
        "COPY (SELECT range AS id, ['AT','DE','FR'][range % 3 + 1] AS country "
        f"FROM range(30)) TO '{tmp_path / 'customers.parquet'}'"
    )
    conn.execute(
        "COPY (SELECT range AS oid, range % 30 AS customer_id, range * 2 AS amount "
        f"FROM range(300)) TO '{tmp_path / 'orders.csv'}' (HEADER)"
    )
    conn.close()
    return tmp_path


def _request(folder: Path, sql: str, **extra: Any) -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 100,
        "timeoutSeconds": 30,
        "sources": [
            {
                "alias": "files",
                "sourceId": "src-1",
                "recipe": {"type": "LOCAL_FOLDER", "required": {"path": str(folder)}},
            }
        ],
        "tables": [
            {
                "source": "files",
                "schema": "local",
                "table": "customers",
                "location": {"kind": "file", "format": "parquet", "objectKey": "customers.parquet"},
            },
            {
                "source": "files",
                "schema": "local",
                "table": "orders",
                "location": {"kind": "file", "format": "csv", "objectKey": "orders.csv"},
            },
        ],
        **extra,
    }


def _rows(payload: dict[str, Any], result: Any) -> list[dict[str, Any]]:
    assert payload["status"] == "success", payload
    reader = pa.ipc.open_stream(result.arrow)
    return reader.read_all().to_pylist()


def test_join_across_files(folder: Path) -> None:
    payload, result = run_query(
        _request(
            folder,
            "SELECT c.country, count(*) AS n FROM files.local.customers c "
            "JOIN files.local.orders o ON o.customer_id = c.id GROUP BY ALL ORDER BY 1",
        )
    )
    rows = _rows(payload, result)
    assert rows == [
        {"country": "AT", "n": 100},
        {"country": "DE", "n": 100},
        {"country": "FR", "n": 100},
    ]
    assert payload["tables"] == ["files.local.customers", "files.local.orders"]


def test_row_cap_truncates_exactly(folder: Path) -> None:
    payload, result = run_query(_request(folder, "SELECT * FROM files.local.orders", maxRows=7))
    assert len(_rows(payload, result)) == 7
    assert payload["truncated"] is True
    assert payload["truncatedReason"] == "rows"


def test_byte_cap_truncates(folder: Path) -> None:
    payload, _ = run_query(
        _request(folder, "SELECT * FROM files.local.orders", maxRows=1000, maxResultBytes=2048)
    )
    assert payload["status"] == "success"
    assert payload["truncatedReason"] == "bytes"
    assert payload["bytes"] <= 2048


def test_unknown_table_is_refused_before_attaching(folder: Path) -> None:
    payload, _ = run_query(_request(folder, "SELECT * FROM files.local.secrets"))
    assert payload["error"]["code"] == "table_not_available"


def test_query_cannot_read_paths_even_on_a_local_source(folder: Path) -> None:
    payload, _ = run_query(_request(folder, "SELECT * FROM read_csv('/etc/passwd')"))
    assert payload["error"]["code"] == "function_not_allowed"


def test_timeout_covers_execution(folder: Path) -> None:
    payload, _ = run_query(
        _request(
            folder,
            "SELECT count(*) FROM files.local.orders a, files.local.orders b, "
            "files.local.orders c, files.local.orders d WHERE a.amount + b.amount + c.amount "
            "+ d.amount = 7",
            timeoutSeconds=1,
        )
    )
    assert payload["error"]["code"] == "timeout"


def test_engine_errors_reach_the_person(folder: Path) -> None:
    payload, _ = run_query(_request(folder, "SELECT nope FROM files.local.orders"))
    assert payload["error"]["code"] == "execution_error"
    assert "nope" in payload["error"]["message"]


def test_command_prints_one_marker_line(
    folder: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "request.json"
    path.write_text(json.dumps(_request(folder, "SELECT count(*) AS n FROM files.local.orders")))
    assert run_query_command(str(path)) == 0
    lines = [
        line for line in capsys.readouterr().out.splitlines() if line.startswith(RESULT_MARKER)
    ]
    assert len(lines) == 1
    assert json.loads(lines[0][len(RESULT_MARKER) :])["rowCount"] == 1


# ── export ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("fmt", ["csv", "parquet", "xlsx"])
def test_export_writes_the_whole_result(folder: Path, fmt: str) -> None:
    payload, result = run_query(
        _request(
            folder,
            "SELECT c.country, o.* FROM files.local.orders o "
            "JOIN files.local.customers c ON c.id = o.customer_id",
            maxRows=1000,
            exportFormat=fmt,
        )
    )
    assert payload["status"] == "success", payload
    assert payload["format"] == fmt
    assert payload["rowCount"] == 300
    assert payload["truncated"] is False
    assert result is not None and len(result.arrow) > 0
    if fmt == "parquet":
        assert pa.parquet.read_table(pa.BufferReader(result.arrow)).num_rows == 300
    if fmt == "csv":
        assert result.arrow.decode().splitlines()[0] == "country,oid,customer_id,amount"
    if fmt == "xlsx":
        assert result.arrow[:2] == b"PK"  # a zip, as every .xlsx is


def test_export_marks_a_cut_result(folder: Path) -> None:
    payload, _ = run_query(
        _request(folder, "SELECT * FROM files.local.orders", maxRows=50, exportFormat="csv")
    )
    assert payload["rowCount"] == 50
    assert payload["truncated"] is True


def test_export_stays_inside_the_gate(folder: Path) -> None:
    payload, _ = run_query(
        _request(folder, "SELECT * FROM read_csv('/etc/passwd')", exportFormat="xlsx")
    )
    assert payload["error"]["code"] == "function_not_allowed"


def _binding(source_type: str, required: dict[str, Any], **optional: Any) -> Any:
    from src.query.bindings import SourceBinding

    recipe = {"type": source_type, "required": required, "optional": optional}
    return SourceBinding("shop_db", 0, recipe, "src-1")


def test_binding_labels_name_the_endpoint_like_the_scan() -> None:
    mysql = _binding("MYSQL", {"host": "db.example.test", "port": 3306})
    postgres = _binding("POSTGRESQL", {"host": "pg.example.test", "port": 5432})
    files = _binding("S3_COMPATIBLE_STORAGE", {"bucket": "lake"})
    assert mysql.label() == "mysql://db.example.test:3306/"
    assert postgres.label() == "postgresql://pg.example.test:5432/"
    # No host: the SQL name the person typed, never an internal alias.
    assert files.label() == "shop_db"


@pytest.mark.parametrize("mode", ["VERIFY_CA", "verify_identity"])
def test_mysql_certificate_checks_are_refused_not_dropped(mode: str) -> None:
    from src.query.bindings import BindingError, TableLocation

    binding = _binding(
        "MYSQL",
        {"host": "db.example.test", "port": 3306},
        connection={"ssl_mode": mode},
    )
    conn = duckdb.connect()
    location = TableLocation(kind="catalog", database="shop", table="orders")
    with pytest.raises(BindingError, match="verifies the server's certificate"):
        binding.relation(conn, location)
