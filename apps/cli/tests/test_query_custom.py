"""SQL over a CUSTOM source: a notebook's ``tables()`` and ``scan()``
(docs/prd/QC-query-connectors.md §5.8).

The notebook runs in its real child process; DuckDB, the gate and the views
are real. What a query reads is the rows ``scan()`` returns, filtered again
by the engine, so a notebook that ignores the filters still answers right.
"""

from __future__ import annotations

import asyncio
import json
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

NOTEBOOK = """import time

from classifyre import Asset, ScanRefusedError, Table, ctx

if ctx.var("mode") == "load_fails":
    # A top-level cell that fails on data (setup, a fetch at import).
    raise KeyError("officer Maria Huber born 1971-04-02")

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
            classify={"name": "personal"},
        )
    ]


def scan(table, request):
    ctx.log(f"scan {table} filters={[str(f) for f in request.filters]}")
    MODE = ctx.var("mode")
    if MODE == "exits":
        raise SystemExit("officer Maria Huber born 1971-04-02")
    if MODE == "secret":
        raise RuntimeError("the register said no to " + ctx.secret("api_key") + " for Alpha GmbH")
    if MODE == "refused":
        raise ScanRefusedError("companies needs WHERE fnr = '...'")
    if MODE == "slow":
        time.sleep(120)
    if MODE == "masked" and any(f.column == "name" for f in request.filters):
        raise ScanRefusedError("a condition on the masked column reached the notebook")
    if MODE == "query_assets":
        ctx.query_assets(limit=1)
    if MODE == "wrong_type":
        yield {"fnr": "x", "name": "x", "employees": "twelve"}
        return
    if MODE == "dates":
        (low,) = [f for f in request.filters if f.column == "founded"]
        assert type(low.value).__name__ == "date", low
        request.use(low)
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


def _request(
    sql: str, mode: str = "", *, table: dict[str, Any] | None = None, **extra: Any
) -> dict[str, Any]:
    return {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 5000,
        "timeoutSeconds": 60,
        **extra,
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
                **(table or {}),
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


def test_date_filters_reach_scan_as_dates_and_show_as_sql() -> None:
    payload, result = run_query(
        _request(
            "SELECT fnr FROM register.main.companies WHERE founded >= DATE '2000-01-01' ORDER BY 1",
            mode="dates",
        )
    )
    assert [r["fnr"] for r in _rows(payload, result)] == ["001a"]
    assert payload["scans"][0]["pushed"] == ["founded >= DATE '2000-01-01'"]


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


def test_a_failing_scan_says_where_but_never_what_it_held() -> None:
    # An exception's text may carry the values it was raised over (here a
    # secret and a company): the query is told its type and line only.
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode="secret"))
    assert payload["status"] == "error"
    message = payload["error"]["message"]
    assert "scan() raised RuntimeError at cell nb, line" in message
    assert "ScanRefusedError" in message
    for leaked in ("the register said no", "sk-live-0123456789abcdef", "Alpha", "Traceback"):
        assert leaked not in message


@pytest.mark.parametrize(
    ("mode", "kind", "where"),
    [("load_fails", "KeyError", "loading"), ("exits", "SystemExit", "scan()")],
)
def test_no_other_error_shows_what_it_held(mode: str, kind: str, where: str) -> None:
    # A cell that fails while the notebook loads, and a BaseException out of
    # scan(), are cut like any other: type and line, never their text.
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode=mode))
    assert payload["status"] == "error"
    message = payload["error"]["message"]
    assert kind in message and where in message and "at cell nb, line" in message
    for leaked in ("Maria", "Huber", "1971", "Traceback"):
        assert leaked not in message


def test_a_scan_can_refuse_with_a_message_of_its_own() -> None:
    payload, _ = run_query(_request("SELECT * FROM register.main.companies", mode="refused"))
    assert payload["status"] == "error"
    assert payload["error"]["message"].endswith("companies needs WHERE fnr = '...'")


def test_the_deadline_stops_a_scan_that_does_not_end() -> None:
    import time

    started = time.monotonic()
    payload, _ = run_query(
        _request("SELECT * FROM register.main.companies", mode="slow", timeoutSeconds=5)
    )
    assert payload["status"] == "error"
    assert payload["error"]["code"] == "timeout"
    assert time.monotonic() - started < 60


def test_a_condition_on_a_masked_column_never_reaches_the_notebook() -> None:
    payload, result = run_query(
        _request(
            "SELECT count(*) AS n FROM register.main.companies WHERE name = 'Alpha GmbH'",
            mode="masked",
            table={
                "columns": [{"column": "name", "action": "mask", "mask": "hash"}],
                "knownColumns": [c["name"] for c in COLUMNS],
            },
            maskSalt="salt",
        )
    )
    # The masked values match nothing; the notebook saw no condition on name.
    assert _rows(payload, result) == [{"n": 0}]
    assert payload["scans"][0]["pushed"] == []


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
    assert table.metadata["columns"] == [
        {**c, "classification": "personal"} if c["name"] == "name" else c for c in COLUMNS
    ]
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


# ── the pieces, without a notebook process ─────────────────────────────


def test_dates_and_timestamps_show_as_sql_literals() -> None:
    import datetime as dt

    from src.query.predicate import Predicate

    assert str(Predicate("day", ">=", dt.date(2026, 11, 16))) == "day >= DATE '2026-11-16'"
    assert (
        str(Predicate("at", "<", dt.datetime(2026, 11, 16, 8, 30)))
        == "at < TIMESTAMP '2026-11-16 08:30:00'"
    )
    assert (
        str(Predicate("at", "=", dt.datetime(2026, 11, 16, 8, 30, tzinfo=dt.UTC)))
        == "at = TIMESTAMPTZ '2026-11-16 08:30:00+00:00'"
    )


def test_filter_values_cross_to_the_notebook_with_their_types() -> None:
    import datetime as dt
    from decimal import Decimal

    from src.notebook.query import Filter, ScanCall

    filters = (
        Filter("at", ">=", dt.datetime(2026, 1, 2, 3, 4, 5, tzinfo=dt.UTC)),
        Filter("day", "in", (dt.date(2026, 1, 2), dt.date(2026, 1, 3))),
        Filter("amount", "<", Decimal("10.25")),
        Filter("name", "=", "O'Brien"),
    )
    call = ScanCall("t", (("at", "TIMESTAMPTZ"),), ("at",), filters, 10, 5.0)
    back = ScanCall.from_wire(json.loads(json.dumps(call.to_wire())))
    assert back == call
    assert [type(f.value) for f in back.filters] == [dt.datetime, tuple, Decimal, str]


def test_rows_are_coerced_to_the_declared_types_or_refused_by_column() -> None:
    import datetime as dt
    from decimal import Decimal

    from src.notebook.query import QueryContractError, rows_to_batch
    from src.query.connectors.arrow import declared_schema

    schema = declared_schema(
        (("n", "BIGINT"), ("x", "DOUBLE"), ("d", "DATE"), ("t", "TIMESTAMP"), ("z", "TIMESTAMPTZ"))
    )
    row = {
        "n": Decimal("7"),
        "x": Decimal("1.5"),
        "d": "2026-11-20T10:00:00",
        "t": "2026-11-20T10:00:00+01:00",
        "z": dt.datetime(2026, 11, 20, 10, 0),
    }
    (out,) = rows_to_batch([row], schema, "t").to_pylist()
    assert out["n"] == 7 and out["x"] == 1.5
    assert out["d"] == dt.date(2026, 11, 20)
    assert out["t"] == dt.datetime(2026, 11, 20, 9, 0)  # UTC, no zone
    assert out["z"] == dt.datetime(2026, 11, 20, 10, 0, tzinfo=dt.UTC)
    with pytest.raises(QueryContractError, match=r"t\.d .* not a date"):
        rows_to_batch([{"d": "yesterday"}], schema, "t")
    with pytest.raises(QueryContractError, match=r"t\.n .* not an integer"):
        rows_to_batch([{"n": Decimal("7.5")}], schema, "t")


def test_a_table_classifies_only_columns_it_declares() -> None:
    from src.notebook.query import QueryContractError, Table

    with pytest.raises(QueryContractError, match="does not declare"):
        Table("t", {"a": "VARCHAR"}, classify={"b": "personal"}).check()
    with pytest.raises(QueryContractError, match="use one of"):
        Table("t", {"a": "VARCHAR"}, classify={"a": "pii"}).check()


def test_the_starter_notebooks_sql_example_works_once_uncommented() -> None:
    from src.notebook.scaffold import scaffold_cells

    cells = scaffold_cells()
    (example,) = [c for c in cells if c["id"] == "sql-tables"]
    lines = example["source"].splitlines()
    body = [line[2:] if line.startswith("# ") else line.lstrip("#") for line in lines]
    start = next(i for i, line in enumerate(body) if line.startswith("from classifyre"))
    cells = [c for c in cells if c["id"] != "sql-tables"]
    cells.append({"id": "sql-tables", "type": "code", "source": "\n".join(body[start:]) + "\n"})
    recipe = {**_recipe(), "required": {"notebook": {"revision": 1, "cells": cells}}}
    request = _request("SELECT id, title FROM register.main.records WHERE id IN ('a', 'b')")
    request["sources"][0]["recipe"] = recipe
    request["tables"][0].update(
        table="records",
        location={
            "kind": "connector",
            "schema": "main",
            "table": "records",
            "columns": [
                {"name": "id", "type": "VARCHAR"},
                {"name": "title", "type": "VARCHAR"},
                {"name": "updated", "type": "DATE"},
            ],
        },
    )
    payload, result = run_query(request)
    assert [r["id"] for r in _rows(payload, result)] == ["a", "b"]
    assert payload["scans"][0]["pushed"] == ["id IN ('a', 'b')"]


def test_classify_takes_exactly_the_labels_the_api_masks_by() -> None:
    # The API reads a declared classification only when it knows the label
    # (governance-rules.ts CLASSIFICATIONS): a label the notebook accepts and
    # the API does not would be dropped without a word.
    import re
    from pathlib import Path

    from src.notebook.query import COLUMN_CLASSIFICATIONS

    rules = Path(__file__).resolve().parents[2] / "api/src/governance/governance-rules.ts"
    block = re.search(r"export const CLASSIFICATIONS = \[(.*?)\] as const", rules.read_text(), re.S)
    assert block, "CLASSIFICATIONS not found in governance-rules.ts"
    assert tuple(re.findall(r"'([a-z]+)'", block.group(1))) == COLUMN_CLASSIFICATIONS
