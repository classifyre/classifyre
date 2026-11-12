"""Smoke test of the ODBC source on the local dev stack, in the `all-sources-test` workspace.

    API_TOKEN=<access token> python3 development/odbc-smoke/smoke.py

What it does, and checks:
  1. creates (or updates, matched by name) the source in source.json: the fixture
     PostgreSQL of this folder, reached through its ODBC driver as admin/admin;
  2. scans it and expects the three tables, the view, the foreign key link and
     findings in the e-mail addresses;
  3. runs SQL over the scanned tables (a join, and a self-join) through DuckDB's
     odbc_scanner and compares the numbers with what the seed inserted.

Needs `skaffold dev` (the fixture is a release of its `dev` profile), the CLI image
of build-cli-image.sh until the published one has ODBC, and a bearer token of a
signed-in user: the API always requires one. In the browser, the token is the
`access_token` the web app sends; any user who may edit sources and run SQL in the
workspace will do. Standard library only.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8811")
NS = os.environ.get("NS", "all-sources-test")
TOKEN = os.environ.get("API_TOKEN", "")
BODY = json.loads((Path(__file__).parent / "source.json").read_text())
DONE = ("COMPLETED", "ERROR", "WARNING", "STOPPED")


def call(method: str, path: str, body: object = None, raw: bool = False) -> object:
    headers = {"content-type": "application/json"} if body is not None else {}
    if TOKEN:
        headers["authorization"] = f"Bearer {TOKEN}"
    request = urllib.request.Request(
        f"{BASE}/{NS}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        sys.exit(f"{method} {path} -> {error.code}: {error.read().decode()[:600]}")
    if raw:
        return payload.decode()
    return json.loads(payload) if payload else None


failures: list[str] = []


def check(label: str, actual: object, expected: object) -> None:
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (expected {expected!r}, got {actual!r})"))
    if not ok:
        failures.append(label)


def upsert_source() -> str:
    existing = {s["name"]: s["id"] for s in call("GET", "/sources")}
    if BODY["name"] in existing:
        source_id = existing[BODY["name"]]
        call("PUT", f"/sources/{source_id}", BODY)
        return source_id
    return call("POST", "/sources", BODY)["id"]


def scan(source_id: str) -> dict:
    run = call("POST", f"/sources/{source_id}/run", {"forceFullRescan": True})
    while (status := call("GET", f"/runners/{run['id']}"))["status"] not in DONE:
        time.sleep(5)
    return status


def query(sql: str) -> list[dict]:
    run = call("POST", "/query-runs", {"sql": sql, "format": "csv"})
    while (state := call("GET", f"/query-runs/{run['id']}"))["status"] in ("PENDING", "RUNNING"):
        time.sleep(2)
    if state["status"] != "SUCCESS":
        sys.exit(f"query {state['status']}: {state.get('error')}")
    return list(csv.DictReader(io.StringIO(call("GET", f"/query-runs/{run['id']}/result", raw=True))))


def main() -> None:
    source_id = upsert_source()
    print(f"source {BODY['name']}: {source_id}")
    test = call("POST", f"/sources/{source_id}/test")
    check("test connection", test.get("status"), "SUCCESS")

    status = scan(source_id)
    check("scan finished", status["status"], "COMPLETED")
    listing = call("GET", f"/sources/{source_id}/assets?limit=200")
    items = listing.get("items") or listing.get("assets") or [] if isinstance(listing, dict) else listing
    names = sorted(a["name"] for a in items)
    check(
        "tables and view found",
        names,
        [
            "warehouse.sales.customers",
            "warehouse.sales.large_orders",
            "warehouse.sales.orders",
            "warehouse.sales.support_notes",
        ],
    )
    orders = next(a for a in items if a["name"].endswith(".orders"))
    check("orders is linked to customers (foreign key)", bool(orders.get("links")), True)
    check("e-mail addresses found", (status.get("totalFindings") or 0) > 0, True)

    sql_name = "odbc_smoke_warehouse"  # the source's name as SQL spells it
    rows = query(f"SELECT count(*) AS n, sum(total) AS s FROM {sql_name}.sales.orders")
    check("SQL: orders count", rows[0]["n"], "120")
    check("SQL: orders sum", float(rows[0]["s"]), sum(g * 12.5 for g in range(1, 121)))
    rows = query(
        f"SELECT count(*) AS n FROM {sql_name}.sales.orders o "
        f"JOIN {sql_name}.sales.customers c ON c.id = o.customer_id"
    )
    check("SQL: join of two ODBC tables", rows[0]["n"], "120")
    rows = query(
        f"SELECT count(*) AS n FROM {sql_name}.sales.customers a "
        f"JOIN {sql_name}.sales.customers b ON a.id = b.id"
    )
    check("SQL: self-join (one connection per scan)", rows[0]["n"], "40")
    rows = query(f"SELECT count(*) AS n FROM {sql_name}.sales.large_orders")
    check("SQL: a view", rows[0]["n"], str(sum(1 for g in range(1, 121) if g * 12.5 > 500)))

    if failures:
        sys.exit(f"\n{len(failures)} check(s) failed: {', '.join(failures)}")
    print("\nall checks passed")


if __name__ == "__main__":
    main()
