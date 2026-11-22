"""SQL over a CUSTOM source: a notebook's ``tables()`` and ``scan()``
(docs/prd/QC-query-connectors.md §5.8).

The notebook runs in its real child process; DuckDB, the gate and the views
are real. What a query reads is the rows ``scan()`` returns, filtered again
by the engine, so a notebook that ignores the filters still answers right.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.query.runner import ensure_dependencies, run_query
from src.utils.uv_sync import auto_install_enabled, sync_group

if auto_install_enabled():
    for _group in ("file-processing", "lineage"):
        sync_group(_group)
try:
    ensure_dependencies()
except Exception as exc:  # auto-install off and the groups absent
    pytest.skip(f"query dependencies unavailable: {exc}", allow_module_level=True)

pa = pytest.importorskip("pyarrow")

from src.notebook.contract import QUERY_CONTRACT, validate_notebook  # noqa: E402
from src.sources import get_source  # noqa: E402

NOTEBOOK = """from classifyre import Asset, Table, ctx

COMPANIES = [
    {"fnr": "001a", "name": "Alpha GmbH", "employees": 12, "founded": "2001-02-03"},
    {"fnr": "002b", "name": "Beta AG", "employees": 3, "founded": "1999-12-31"},
    {"fnr": "003c", "name": "Gamma KG", "employees": 40, "founded": None},
]


def test_connection():
    return {"status": "SUCCESS", "message": "ok"}


def extract():
    yield Asset(id="note", name="A note", content="nothing to see")


def tables():
    return [
        Table(
            "companies",
            {"fnr": "VARCHAR", "name": "VARCHAR", "employees": "BIGINT", "founded": "DATE"},
            description="One row per company, read live.",
        )
    ]


def scan(table, request):
    ctx.log(f"scan {table} filters={[str(f) for f in request.filters]}")
    MODE = ctx.var("mode")
    if MODE == "secret":
        raise RuntimeError("the register said no to " + ctx.secret("api_key"))
    if MODE == "query_assets":
        ctx.query_assets(limit=1)
    if MODE == "wrong_type":
        yield {"fnr": "x", "name": "x", "employees": "twelve"}
        return
    wanted = None if MODE == "ignore_filters" else request.values("fnr")
    request.count_request()
    for row in COMPANIES * (1000 if MODE == "many" else 1):
        if wanted is None or row["fnr"] in wanted:
            yield row
"""

COLUMNS = [
    {"name": "fnr", "type": "VARCHAR"},
    {"name": "name", "type": "VARCHAR"},
    {"name": "employees", "type": "BIGINT"},
    {"name": "founded", "type": "DATE"},
]


def _recipe(mode: str = "") -> dict[str, Any]:
    return {
        "type": "CUSTOM",
        "required": {
            "notebook": {"revision": 1, "cells": [{"id": "nb", "type": "code", "source": NOTEBOOK}]}
        },
        "masked": {"secrets": {"api_key": "sk-live-0123456789abcdef"}},
        "optional": {"variables": {"mode": mode}},
        "sampling": {"strategy": "ALL"},
    }


def _request(sql: str, mode: str = "") -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 5000,
        "timeoutSeconds": 60,
        "sources": [{"alias": "register", "sourceId": "src-1", "recipe": _recipe(mode)}],
        "tables": [
            {
                "source": "register",
                "schema": "main",
                "table": "companies",
                "location": {
                    "kind": "connector",
                    "schema": "main",
                    "table": "companies",
                    "columns": COLUMNS,
                },
            }
        ],
    }


def _rows(payload: dict[str, Any], result: Any) -> list[dict[str, Any]]:
    assert payload["status"] == "success", payload
    return pa.ipc.open_stream(result.arrow).read_all().to_pylist()


def test_a_declared_table_reads_as_sql_and_its_filter_reaches_scan() -> None:
    payload, result = run_query(
        _request("SELECT name, employees, founded FROM register.main.companies WHERE fnr = '001a'")
    )
    (row,) = _rows(payload, result)
    assert row["name"] == "Alpha GmbH"
    assert row["employees"] == 12
    assert str(row["founded"]) == "2001-02-03"
    (scan,) = payload["scans"]
    assert scan["pushed"] == ["fnr = '001a'"]
    assert scan["requests"] == 1
    assert scan["rows"] == 1


def test_in_lists_reach_scan_as_values() -> None:
    payload, result = run_query(
        _request("SELECT fnr FROM register.main.companies WHERE fnr IN ('001a', '003c') ORDER BY 1")
    )
    assert [r["fnr"] for r in _rows(payload, result)] == ["001a", "003c"]
    assert payload["scans"][0]["rows"] == 2


def test_a_notebook_that_ignores_the_filters_still_answers_right() -> None:
    payload, result = run_query(
        _request(
            "SELECT fnr FROM register.main.companies WHERE employees > 10 ORDER BY 1",
            mode="ignore_filters",
        )
    )
    assert [r["fnr"] for r in _rows(payload, result)] == ["001a", "003c"]
    # Nothing was said to be sent: the engine filtered.
    assert payload["scans"][0]["pushed"] == []
    assert payload["scans"][0]["rows"] == 3


def test_a_value_of_another_type_names_the_column_not_the_value() -> None:
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode="wrong_type"))
    assert payload["status"] == "error"
    message = payload["error"]["message"]
    assert "companies.employees" in message
    assert "an integer" in message
    assert "twelve" not in message


def test_a_failing_scan_says_why_without_its_secrets_or_traceback() -> None:
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode="secret"))
    assert payload["status"] == "error"
    message = payload["error"]["message"]
    assert "the register said no" in message
    assert "sk-live-0123456789abcdef" not in message
    assert "Traceback" not in message


def test_the_namespace_is_closed_while_a_query_reads_the_notebook() -> None:
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode="query_assets"))
    assert payload["status"] == "error"
    assert "not available while a query reads" in payload["error"]["message"]


def test_a_self_join_reads_the_table_twice_without_mixing_rows() -> None:
    payload, result = run_query(
        _request(
            "SELECT a.fnr, b.fnr AS other FROM register.main.companies a "
            "JOIN register.main.companies b ON a.employees < b.employees ORDER BY 1, 2"
        )
    )
    assert [(r["fnr"], r["other"]) for r in _rows(payload, result)] == [
        ("001a", "003c"),
        ("002b", "001a"),
        ("002b", "003c"),
    ]


def test_a_limit_stops_reading_and_the_next_query_starts_clean() -> None:
    payload, result = run_query(
        _request("SELECT fnr FROM register.main.companies LIMIT 2", mode="many")
    )
    assert len(_rows(payload, result)) == 2
    assert payload["scans"][0]["rows"] < 3000


def test_more_rows_than_the_cap_is_a_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLASSIFYRE_QUERY_CONNECTOR_MAX_ROWS", "100")
    payload, _ = run_query(_request("SELECT count(*) FROM register.main.companies", mode="many"))
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "connector_limit"


def test_a_scan_records_the_declared_tables_with_their_columns() -> None:
    source = get_source(_recipe(), source_id="src-1", runner_id="run-1")
    try:

        async def collect() -> list[Any]:
            out: list[Any] = []
            async for batch in source.extract_raw():
                out.extend(batch)
            return out

        assets = asyncio.run(collect())
    finally:
        source.cleanup()
    tables = [a for a in assets if a.asset_kind == "table"]
    (table,) = tables
    assert table.name == "companies"
    assert table.metadata["query"] == "scan"
    assert table.metadata["table_name"] == "companies"
    assert table.metadata["schema"] == "main"
    assert table.metadata["columns"] == COLUMNS
    # The rows are read by queries, never scanned.
    assert "content_reference" in table.metadata
    # The notebook's own assets are still there.
    assert any(a.name == "A note" for a in assets)


def _cells(source: str) -> list[dict[str, Any]]:
    return [{"id": "nb", "type": "code", "source": source}]


BASE = "def test_connection():\n    return {}\n\n\ndef extract():\n    return []\n"


def test_tables_without_scan_breaks_the_contract() -> None:
    report = validate_notebook(_cells(BASE + "\n\ndef tables():\n    return []\n"))
    assert [v.kind for v in report.violations] == [QUERY_CONTRACT]
    assert "scan" in report.violations[0].message


def test_scan_takes_the_table_and_the_request() -> None:
    report = validate_notebook(
        _cells(BASE + "\n\ndef tables():\n    return []\n\n\ndef scan(table):\n    return []\n")
    )
    assert [v.kind for v in report.violations] == [QUERY_CONTRACT]
    ok = validate_notebook(
        _cells(
            BASE
            + "\n\ndef tables():\n    return []\n\n\ndef scan(table, request):\n    return []\n"
        )
    )
    assert ok.ok
