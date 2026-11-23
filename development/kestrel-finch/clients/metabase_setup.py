"""Metabase over Classifyre: Ravi's SQL connection as a PostgreSQL database,
synced, with questions (query builder and native SQL) and a dashboard.

    kubectl -n classifyre-dev port-forward svc/kf-metabase 3031:3000 &
    development/kestrel-finch/run.sh ../clients/metabase_setup.py

Prints one PASS/FAIL line per check (M…), and the dashboard's URL.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

MB = "http://127.0.0.1:3031/api/"
EMAIL, PASSWORD = "ravi.iyer@kestrelfinch.example", "Kestrel-Demo-2026"
CONN = json.loads((Path(__file__).resolve().parent.parent / ".runs" / "connections.json").read_text())
GATEWAY = "classifyre-sql-gateway.classifyre-dev.svc"
http = httpx.Client(base_url=MB, timeout=300)


def call(method: str, path: str, **kwargs: Any) -> Any:
    response = http.request(method, path, **kwargs)
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {path} → {response.status_code} {response.text[:400]}")
    return response.json() if response.content else None


def report(cid: str, ok: bool, detail: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'} {cid:4} {detail}", flush=True)


def sign_in() -> None:
    props = call("GET", "session/properties")
    if props.get("setup-token") and not props.get("has-user-setup"):
        session = call("POST", "setup", json={
            "token": props["setup-token"],
            "user": {"email": EMAIL, "password": PASSWORD, "first_name": "Ravi", "last_name": "Iyer",
                     "site_name": "Kestrel & Finch BI"},
            "prefs": {"site_name": "Kestrel & Finch BI", "allow_tracking": False},
        })
    else:
        session = call("POST", "session", json={"username": EMAIL, "password": PASSWORD})
    http.headers["X-Metabase-Session"] = session["id"]
    call("PUT", "setting/report-timezone", json={"value": "Europe/Vienna"})


def database() -> int:
    name = "Kestrel & Finch (Classifyre, Ravi's connection)"
    for db in call("GET", "database").get("data", []):
        if db["name"] == name:
            return int(db["id"])
    c = CONN["ravi.iyer"]
    started = time.monotonic()
    db = call("POST", "database", json={
        "engine": "postgres", "name": name,
        "details": {"host": GATEWAY, "port": 5432, "dbname": CONN["_database"], "user": c["username"],
                    "password": c["password"], "ssl": True, "ssl-mode": "verify-full",
                    "ssl-root-cert-options": "local", "ssl-root-cert-path": "/ca/ca.crt",
                    "schema-filters-type": "all", "advanced-options": False},
        "is_full_sync": True, "is_on_demand": False,
    })
    report("M1", True, f"database added (connection tested by Metabase) in {time.monotonic() - started:.1f}s")
    return int(db["id"])


def sync(db: int) -> dict[str, dict[str, Any]]:
    call("POST", f"database/{db}/sync_schema")
    started = time.monotonic()
    tables: list[dict[str, Any]] = []
    while time.monotonic() - started < 300:
        tables = call("GET", f"database/{db}/metadata").get("tables", [])
        if len(tables) >= 3 and all(t.get("fields") for t in tables):
            break
        time.sleep(3)
    names = {f"{t['schema']}.{t['name']}": t for t in tables}
    report("M2", len(tables) == 3, f"synced in {time.monotonic() - started:.0f}s: {sorted(names)}")
    return names


def dataset(db: int, query: dict[str, Any] | None = None, sql: str | None = None) -> tuple[list, float]:
    body = ({"database": db, "type": "native", "native": {"query": sql}} if sql
            else {"database": db, "type": "query", "query": query})
    started = time.monotonic()
    result = call("POST", "dataset", json=body)
    if result.get("status") != "completed":
        raise RuntimeError(str(result.get("error"))[:400])
    return result["data"]["rows"], time.monotonic() - started


def card(name: str, db: int, display: str, query: dict[str, Any] | None = None, sql: str | None = None,
         viz: dict[str, Any] | None = None) -> int:
    for existing in call("GET", "card"):
        if existing["name"] == name:
            call("DELETE", f"card/{existing['id']}")
    body = {"name": name, "display": display, "visualization_settings": viz or {},
            "dataset_query": ({"database": db, "type": "native", "native": {"query": sql}} if sql
                              else {"database": db, "type": "query", "query": query})}
    return int(call("POST", "card", json=body)["id"])


def main() -> None:
    sign_in()
    db = database()
    tables = sync(db)
    ds = tables["shared.marketing.traveller_360"]
    field = {f["name"]: f["id"] for f in ds["fields"]}

    # Query builder (MBQL): Metabase writes the SQL itself.
    by_region = {"source-table": ds["id"], "aggregation": [["count"]],
                 "breakout": [["field", field["region"], None]], "order-by": [["desc", ["aggregation", 0]]]}
    rows, secs = dataset(db, by_region)
    report("M3", len(rows) == 4, f"query builder, travellers by region in {secs:.1f}s: {rows}")
    tiers = {"source-table": ds["id"], "aggregation": [["count"], ["avg", ["field", field["loyalty_points"], None]]],
             "breakout": [["field", field["wayfarer_tier"], None]],
             "filter": ["not-null", ["field", field["wayfarer_tier"], None]]}
    rows, secs = dataset(db, tiers)
    report("M4", len(rows) == 4, f"query builder, tiers with avg points in {secs:.1f}s: {rows}")
    raw = {"source-table": ds["id"], "fields": [["field", field["email"], None], ["field", field["first_name"], None],
                                                ["field", field["region"], None]], "limit": 3}
    rows, secs = dataset(db, raw)
    report("M5", all(r[0] == "****" for r in rows), f"raw rows show the masks: {rows}")

    revenue_sql = """
SELECT region, sum(amount) AS revenue, count(*) AS bookings FROM (
  SELECT region, amount_eur AS amount FROM "kestrel_crm_hubspot_sync.crm".deals
   WHERE stage IN ('booked', 'travelled')
  UNION ALL
  SELECT "Region__c", "Amount" FROM "finch_crm_salesforce_export.kestrel_finch_finch_salesforce".opportunity
   WHERE "StageName" = 'Closed Won'
) bookings GROUP BY region ORDER BY revenue DESC"""
    rows, secs = dataset(db, sql=revenue_sql)
    report("M6", len(rows) == 4, f"native SQL across both CRMs in {secs:.1f}s: {rows}")
    trend_sql = """
SELECT date_trunc('month', departure_date)::date AS month, count(*) AS departures, sum(travellers) AS travellers
FROM "kestrel_crm_hubspot_sync.crm".deals WHERE stage IN ('booked', 'travelled')
GROUP BY 1 ORDER BY 1"""
    rows, secs = dataset(db, sql=trend_sql)
    report("M7", len(rows) > 6, f"native SQL, monthly trend ({len(rows)} months) in {secs:.1f}s: {rows[:3]}…")
    try:
        dataset(db, sql='SELECT * FROM "kestrel_crm_hubspot_sync.crm".contacts LIMIT 1')
        report("M8", False, "contacts readable outside the connection's scope")
    except RuntimeError as error:
        report("M8", True, f"outside the scope: {str(error)[:160]}")

    cards = [
        card("Travellers by region (consented, all systems)", db, "bar", by_region),
        card("Wayfarer tiers", db, "pie", {**tiers, "aggregation": [["count"]]}),
        card("Bookings revenue by region — both CRMs", db, "bar", sql=revenue_sql,
             viz={"graph.dimensions": ["region"], "graph.metrics": ["revenue"]}),
        card("Departures per month (Kestrel)", db, "line", sql=trend_sql,
             viz={"graph.dimensions": ["month"], "graph.metrics": ["departures"]}),
        card("Traveller 360 — what the BI team sees", db, "table", raw),
    ]
    dash_name = "Kestrel & Finch — bookings and loyalty"
    for existing in call("GET", "dashboard"):
        if existing["name"] == dash_name:
            call("DELETE", f"dashboard/{existing['id']}")
    dash = call("POST", "dashboard", json={"name": dash_name, "description":
                "Built on governed tables through a Classifyre SQL connection: masks and row filters apply."})
    layout = [(0, 0, 12, 6), (12, 0, 12, 6), (0, 6, 12, 6), (12, 6, 12, 6), (0, 12, 24, 6)]
    call("PUT", f"dashboard/{dash['id']}", json={"dashcards": [
        {"id": -(i + 1), "card_id": cid, "col": col, "row": row, "size_x": w, "size_y": h}
        for i, (cid, (col, row, w, h)) in enumerate(zip(cards, layout, strict=True))]})
    started = time.monotonic()
    for cid in cards:
        result = call("POST", f"card/{cid}/query")
        assert result.get("status") == "completed", result.get("error")
    report("M9", True, f"dashboard {dash['id']}: {len(cards)} cards refreshed in {time.monotonic() - started:.1f}s")
    print(f"open http://localhost:3031/dashboard/{dash['id']}")


if __name__ == "__main__":
    main()
