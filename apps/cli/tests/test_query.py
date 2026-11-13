"""SQL over asset tables (src/query): the gate, the session, the runner."""

from __future__ import annotations

import json
import re
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


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ('SELECT * FROM "crm.public".customers', "crm.public.customers"),
        ('SELECT * FROM lab."crm.public"."customers"', "crm.public.customers"),
        ("SELECT * FROM customers WHERE id = 1", "crm.public.customers"),
        ("SELECT * FROM crm.public.customers", "crm.public.customers"),
        ('SELECT o.amount::numeric FROM "lake.shop".orders AS o', "lake.shop.orders"),
    ],
)
def test_gate_reads_postgres_client_names(sql: str, expected: str) -> None:
    checked = validate(
        sql, ALLOWED, "postgres", database="lab", search_path=["crm.public", "public"]
    )
    assert {str(t) for t in checked.tables} == {expected}
    assert '"crm"' in checked.sql or '"lake"' in checked.sql


@pytest.mark.parametrize(
    "sql",
    [
        'SELECT * FROM other_db."crm.public".customers',
        'SELECT * FROM "crm.public".not_granted',
        "SELECT * FROM orders",
        "SELECT * FROM lab.public.customers",
        "SELECT * FROM pg_catalog.pg_class",
        "SELECT * FROM information_schema.tables",
        "SELECT pg_read_file('/etc/passwd')",
        'DELETE FROM "crm.public".customers',
        'SELECT * FROM "crm.public".customers; SELECT 1',
    ],
)
def test_gate_refuses_postgres_bypasses(sql: str) -> None:
    with pytest.raises(QueryRefusedError):
        validate(sql, ALLOWED, "postgres", database="lab", search_path=["crm.public"])


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


def test_postgres_client_sql_runs_on_duckdb(folder: Path) -> None:
    payload, result = run_query(
        _request(
            folder,
            'SELECT c.country, count(*)::int8 AS n FROM "files.local".customers c '
            "JOIN orders o ON o.customer_id = c.id WHERE c.country = ANY(ARRAY['AT','DE']) "
            "GROUP BY c.country ORDER BY 1;",
            dialect="postgres",
            database="lab",
            searchPath=["files.local"],
        )
    )
    assert _rows(payload, result) == [
        {"country": "AT", "n": 100},
        {"country": "DE", "n": 100},
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


class _RecordingConn:
    """Stands in for a DuckDB connection: remembers the SQL, runs nothing."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, sql: str) -> None:
        self.statements.append(sql)


def _attach_mysql(
    monkeypatch: pytest.MonkeyPatch,
    *,
    ssl_mode: str | None,
    ca: str | None = None,
    password: str = "s3cret",
) -> tuple[Any, list[str]]:
    from src.query import bindings
    from src.query.bindings import SourceBinding, TableLocation

    monkeypatch.setattr(bindings, "load_extension", lambda *_args: None)
    recipe: dict[str, Any] = {
        "type": "MYSQL",
        "required": {"host": "db.example.test", "port": 3306},
        "masked": {"username": "reader", "password": password, **({"ssl_ca": ca} if ca else {})},
        "optional": {"connection": {"ssl_mode": ssl_mode} if ssl_mode else {}},
    }
    binding = SourceBinding("shop_db", 0, recipe, "src-1")
    conn = _RecordingConn()
    binding.relation(conn, TableLocation(kind="catalog", database="shop", table="orders"))
    return binding, conn.statements


_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"


@pytest.mark.parametrize("mode", ["VERIFY_CA", "VERIFY_IDENTITY"])
def test_mysql_verify_modes_hand_duckdb_the_sources_ca_as_a_file(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    binding, statements = _attach_mysql(monkeypatch, ssl_mode=mode, ca=_PEM)
    secret = next(s for s in statements if s.startswith("CREATE OR REPLACE SECRET"))
    assert f"SSL_MODE '{mode.lower()}'" in secret
    match = re.search(r"SSL_CA '([^']+)'", secret)
    assert match is not None
    ca_file = Path(match.group(1))
    # The escaped newlines of a pasted PEM are real ones in the file.
    assert ca_file.read_text() == "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
    assert ca_file.stat().st_mode & 0o077 == 0  # private to this process's user
    assert statements[-1].startswith("ATTACH '' AS ") and "TYPE mysql, SECRET" in statements[-1]
    binding.close()
    assert not ca_file.exists()


def test_mysql_verify_without_a_ca_checks_against_the_system_roots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, statements = _attach_mysql(monkeypatch, ssl_mode="VERIFY_CA")
    secret = statements[0]
    assert "SSL_MODE 'verify_ca'" in secret and "SSL_CA" not in secret


@pytest.mark.parametrize(
    ("mode", "ca", "expected", "absent"),
    [
        (None, None, [], ["SSL_MODE", "SSL_CA"]),
        ("PREFERRED", _PEM, [], ["SSL_MODE", "SSL_CA"]),  # the scan does not verify either
        ("REQUIRED", None, [], ["SSL_MODE", "SSL_CA"]),  # DuckDB's own 'required' is stricter
        ("REQUIRED", _PEM, ["SSL_MODE 'required'", "SSL_CA"], []),
        ("DISABLED", _PEM, ["SSL_MODE 'disabled'"], ["SSL_CA"]),
    ],
)
def test_mysql_other_ssl_modes_never_claim_a_check_the_scan_does_not_make(
    monkeypatch: pytest.MonkeyPatch,
    mode: str | None,
    ca: str | None,
    expected: list[str],
    absent: list[str],
) -> None:
    binding, statements = _attach_mysql(monkeypatch, ssl_mode=mode, ca=ca)
    secret = statements[0]
    assert all(part in secret for part in expected)
    assert not any(part in secret for part in absent)
    binding.close()


def test_mysql_credentials_are_escaped_literals_not_connection_string_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, statements = _attach_mysql(monkeypatch, ssl_mode=None, password="it's a 'pass' \\ word")
    secret = statements[0]
    assert "PASSWORD 'it''s a ''pass'' \\ word'" in secret
    assert "HOST 'db.example.test', PORT 3306, DATABASE 'shop'" in secret
    # The password never travels in the ATTACH string.
    assert "pass" not in statements[-1]


# ── more file formats, Databricks ────────────────────────────────────────


def _run_file_table(folder: Path, fmt: str, key: str, sql: str) -> dict[str, Any]:
    request = _request(folder, sql)
    request["tables"] = [
        {
            "source": "files",
            "schema": "local",
            "table": "t",
            "location": {"kind": "file", "format": fmt, "objectKey": key},
        }
    ]
    payload, _ = run_query(request)
    return payload


def test_json_array_files_are_tables(folder: Path) -> None:
    (folder / "rows.json").write_text(json.dumps([{"id": 1, "n": "a"}, {"id": 2, "n": "b"}]))
    payload = _run_file_table(
        folder, "json", "rows.json", "SELECT n FROM files.local.t ORDER BY id"
    )
    assert payload["status"] == "success" and payload["rowCount"] == 2


def test_geojson_geometry_reads_as_text(folder: Path) -> None:
    feature = {
        "type": "Feature",
        "properties": {"name": "hq"},
        "geometry": {"type": "Point", "coordinates": [1, 2]},
    }
    (folder / "sites.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [feature]})
    )
    payload = _run_file_table(
        folder, "geojson", "sites.geojson", "SELECT name, geom FROM files.local.t"
    )
    if payload["status"] != "success":
        pytest.skip(f"spatial extension unavailable here: {payload.get('error')}")
    types = {c["name"]: c["type"] for c in payload["columns"]}
    assert types["geom"] == "string"  # WKT, not a binary geometry


def _attach_databricks(
    monkeypatch: pytest.MonkeyPatch, workspace_url: str
) -> tuple[Any, list[str], list[str]]:
    from src.query import bindings
    from src.query.bindings import SourceBinding, TableLocation

    loaded: list[str] = []
    monkeypatch.setattr(bindings, "load_extension", lambda _conn, name: loaded.append(name))
    recipe = {
        "type": "DATABRICKS",
        "required": {"workspace_url": workspace_url, "warehouse_id": "w"},
    }
    binding = SourceBinding("lake", 0, recipe, "src-1")

    class _Source:
        @staticmethod
        def _access_token_value() -> str:
            return "dapi-it's-a-token"

    binding._source = _Source()
    conn = _RecordingConn()
    relation = binding.relation(
        conn, TableLocation(kind="catalog", database="sales", schema="raw", table="orders")
    )
    return relation, conn.statements, loaded


def test_databricks_attaches_unity_catalog_with_the_scans_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    relation, statements, loaded = _attach_databricks(
        monkeypatch, "https://dbc-1.cloud.databricks.com/"
    )
    assert relation == '"__src_0_0"."raw"."orders"'
    assert loaded == ["unity_catalog", "delta", "httpfs"]
    secret, attach = statements
    assert "TYPE unity_catalog" in secret
    assert "TOKEN 'dapi-it''s-a-token'" in secret
    assert "ENDPOINT 'https://dbc-1.cloud.databricks.com'" in secret
    assert attach.startswith("ATTACH 'sales' AS ") and "READ_ONLY" in attach
    assert "dapi" not in attach


def test_databricks_on_azure_loads_the_azure_filesystem(monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, loaded = _attach_databricks(monkeypatch, "https://adb-1.2.azuredatabricks.net")
    assert loaded == ["unity_catalog", "delta", "azure"]


def test_databricks_credential_refusal_is_explained() -> None:
    from src.query.bindings import SourceBinding

    binding = SourceBinding("lake", 0, {"type": "DATABRICKS"}, "src-1")
    reason = binding.explain(
        RuntimeError("Request to '.../api/2.1/unity-catalog/temporary-table-credentials' failed")
    )
    assert reason is not None and "External data access" in reason
    assert binding.explain(RuntimeError("something else")) is None


def test_databricks_endpoint_is_named_like_the_scan_does() -> None:
    from src.query.bindings import SourceBinding

    binding = SourceBinding(
        "lake",
        0,
        {"type": "DATABRICKS", "required": {"workspace_url": "https://dbc-1.cloud.databricks.com"}},
        "src-1",
    )
    assert binding.label() == "databricks://dbc-1.cloud.databricks.com/"


def _attach_odbc(monkeypatch: pytest.MonkeyPatch, qualified: str = '"sales"."orders"') -> Any:
    from src.query import bindings
    from src.query.bindings import SourceBinding, TableLocation

    loaded: list[str] = []
    monkeypatch.setattr(bindings, "load_extension", lambda _conn, name: loaded.append(name))
    recipe = {
        "type": "ODBC",
        "required": {"connection_string": "Driver={PostgreSQL Unicode};Server=db.test;Port=5432"},
        "masked": {"username": "admin", "password": "p'w;d"},
    }
    binding = SourceBinding("warehouse", 0, recipe, "src-1")
    conn = _RecordingConn()
    location = TableLocation(
        kind="catalog", schema="sales", table="orders", qualified_name=qualified
    )
    relation = binding.relation(conn, location)
    again = binding.relation(conn, location)
    return binding, relation, again, conn.statements, loaded


def test_odbc_reads_through_the_scanner_with_the_credentials_in_a_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    binding, relation, again, statements, loaded = _attach_odbc(monkeypatch)
    assert loaded == ["odbc_scanner"]
    # The connection string is stored once, as a variable, escaped as a literal.
    assert len(statements) == 1
    assert statements[0].startswith('SET VARIABLE "__src_0_odbc" = ')
    assert "PWD={p'w;d}" not in statements[0]  # the quote is doubled for SQL
    assert "PWD={p''w;d};" in statements[0]
    # The relation names the variable and the remote table, never the password.
    assert relation == again
    assert relation == (
        "odbc_query(odbc_connect(getvariable('__src_0_odbc')), 'SELECT * FROM \"sales\".\"orders\"')"
    )
    assert "admin" not in relation and "p'w" not in relation
    assert binding.label() == "odbc://db.test:5432/"


def test_odbc_without_a_recorded_name_asks_for_a_rescan(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.query import bindings
    from src.query.bindings import BindingError, SourceBinding, TableLocation

    monkeypatch.setattr(bindings, "load_extension", lambda *_a: None)
    binding = SourceBinding("warehouse", 0, {"type": "ODBC"}, "src-1")
    with pytest.raises(BindingError, match="run a scan of the source again"):
        binding.relation(_RecordingConn(), TableLocation(kind="catalog", table="orders"))


def test_odbc_missing_driver_is_explained() -> None:
    from src.query.bindings import SourceBinding

    binding = SourceBinding("warehouse", 0, {"type": "ODBC"}, "src-1")
    reason = binding.explain(
        RuntimeError("[unixODBC][Driver Manager]Can't open lib 'X' : not found")
    )
    assert reason is not None and "driver" in reason
