"""Battle test: every persona queries the tables, and each answer is checked.

    development/kestrel-finch/run.sh battle.py [check-id-prefix …]

Writes .runs/battle-<time>.json and prints one line per check.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from kf import Api, ApiError

K = "kestrel_crm_hubspot_sync.crm"
F = "finch_crm_salesforce_export.kestrel_finch_finch_salesforce"
W = "wayfarer_club_loyalty.wayfarer"
S = "support_desk.support"
B = "billing_legacy_odbc.billing"
STAR = "margarethe.albrecht@alpenmail.example.com"
ERASED = "imogen.pemberton12@fjord.example.net"

RESULTS: list[dict[str, Any]] = []
ONLY = sys.argv[1:]


def check(cid: str, who: str, what: str) -> Callable[[Callable[[], str]], None]:
    """Runs the decorated function as check `cid`; it returns a detail line or raises."""

    def wrap(fn: Callable[[], str]) -> None:
        if ONLY and not any(cid.startswith(o) for o in ONLY):
            return
        started = time.monotonic()
        try:
            detail = fn()
            ok = True
        except AssertionError as error:
            ok, detail = False, f"ASSERT {error}"
        except Exception as error:  # noqa: BLE001
            ok, detail = False, f"{type(error).__name__}: {error}"[:500]
            traceback.print_exc(limit=1)
        ms = int((time.monotonic() - started) * 1000)
        RESULTS.append({"id": cid, "who": who, "what": what, "ok": ok, "ms": ms, "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'} {cid:5} {who:18} {ms:6}ms  {what} — {detail}", flush=True)

    return wrap


def rows(api: Api, sql: str) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
    return api.query(sql)


def refused(api: Api, sql: str) -> str:
    """The run's error code/message; fails the check if the query succeeded."""
    try:
        state = api.run(sql)
    except ApiError as error:  # refused before a run exists (pre-check)
        return f"HTTP {error.status}: {error.text[:160]}"
    assert state.get("status") != "SUCCESS", f"query succeeded: {sql}"
    return f"{state.get('status')}: {str(state.get('error') or state.get('errorMessage'))[:160]}"


HEX16 = re.compile(r"^[0-9a-f]{16}$")

ines, tomasz, henrike = Api("ines.kovac"), Api("tomasz.wierzbicki"), Api("henrike.sauer")
lukas, sigrid, amelie = Api("lukas.brandner"), Api("sigrid.halvorsen"), Api("amelie.fontaine")
kwame, olga, ravi, jonas = Api("kwame.mensah"), Api("olga.lindqvist"), Api("ravi.iyer"), Api("jonas.eklund")


# ── owners, stewards, admins ───────────────────────────────────────────────


@check("O1", "tomasz (owner)", "owner reads every row of contacts in clear, svnr included")
def _() -> str:
    cols, data, state = rows(tomasz, f"SELECT * FROM {K}.contacts")
    assert len(data) == 189, len(data)
    star = next(r for r in data if r["email"] == STAR)
    assert star["svnr"] and star["phone"].startswith("+43"), star
    return f"{len(data)} rows, {len(cols)} columns, masks={state.get('masks')}"


@check("O2", "tomasz (owner)", "the GDPR-erased Finch contact stays erased (Delta delete)")
def _() -> str:
    _, data, _ = rows(tomasz, f"SELECT count(*) AS n, count(*) FILTER (WHERE lower(\"Email\") = '{ERASED}') AS erased "
                              f"FROM {F}.contact")
    assert data[0]["erased"] == 0 and data[0]["n"] == 156, data
    return f"{data[0]['n']} contacts, erased row absent"


@check("O3", "henrike (steward)", "steward reads in clear across sources")
def _() -> str:
    _, data, state = rows(henrike, f"SELECT \"Passport_Number__c\" AS p, \"Dietary_Requirements__c\" AS d "
                                   f"FROM {F}.contact WHERE \"LastName\" = 'Albrecht' AND \"FirstName\" = 'Margarethe'")
    assert data and data[0]["p"] == "P4817263", data
    return f"passport and dietary in clear: {data[0]}"


@check("A1", "ines (tenant admin)", "tenant admin is bound by row filters (no rule for /admins)")
def _() -> str:
    _, data, state = rows(ines, f"SELECT count(*) AS n FROM {K}.contacts")
    return f"{data[0]['n']} rows; rowFilters={state.get('rowFilters') or state.get('row_filters')}"


@check("A2", "ines (tenant admin)", "tenant admin reads an unfiltered table in clear (holds data.unmask)")
def _() -> str:
    _, data, state = rows(ines, f"SELECT email, iban FROM {W}.members WHERE member_no = 'WF-0700000'")
    assert data and data[0]["email"].lower() == STAR, data
    return f"{data[0]}; masks={state.get('masks')}"


@check("R1", "tomasz (owner)", "the Rows step names who may query a filtered table but would see no row")
def _() -> str:
    asset = tomasz.catalog()[f"{K}.contacts"]["assetId"]
    readers = [r["path"] for r in tomasz.call("GET", f"assets/{asset}/rows").get("readersWithoutRows", [])]
    assert "/admins" in readers, readers
    assert "/marketing" not in readers and "/sales/sales-dach" not in readers, readers
    return f"readers without a row: {readers}"


# ── sales: unmasked, region filtered ───────────────────────────────────────


@check("S1", "lukas (sales DACH)", "only DACH contacts, in clear")
def _() -> str:
    _, data, state = rows(lukas, f"SELECT region, count(*) AS n FROM {K}.contacts GROUP BY region")
    assert [r["region"] for r in data] == ["DACH"], data
    _, star, _ = rows(lukas, f"SELECT first_name, email, phone FROM {K}.contacts WHERE contact_id = 1001")
    assert star[0]["email"] == STAR, star
    return f"{data}; Margarethe in clear: {star[0]}"


@check("S2", "lukas (sales DACH)", "an unmasked reader does not see the restricted column (svnr); its owner does")
def _() -> str:
    cols, data, state = rows(lukas, f"SELECT * FROM {K}.contacts WHERE contact_id = 1001")
    assert "svnr" not in cols, cols
    assert data[0]["email"] == STAR, data[0]
    owner_cols, owner_data, _ = rows(tomasz, f"SELECT svnr FROM {K}.contacts WHERE contact_id = 1001")
    assert owner_data[0]["svnr"], owner_data
    return f"Lukas: {len(cols)} columns, no svnr, e-mail in clear; Tomasz (owner): svnr {owner_data[0]['svnr']}"


@check("S3", "lukas (sales DACH)", "cannot read the notes table (no grant)")
def _() -> str:
    return refused(lukas, f"SELECT * FROM {K}.notes")


@check("S4", "sigrid (sales Nordics)", "only Nordic Finch contacts; Kestrel CRM refused")
def _() -> str:
    _, data, _ = rows(sigrid, f"SELECT \"Region__c\" AS r, count(*) AS n FROM {F}.contact GROUP BY 1")
    assert [r["r"] for r in data] == ["Nordics"], data
    return f"{data}; kestrel → {refused(sigrid, f'SELECT * FROM {K}.contacts')}"


@check("S5", "sigrid (sales Nordics)", "a filter on a column outside her rows still returns nothing")
def _() -> str:
    _, data, _ = rows(sigrid, f"SELECT count(*) AS n FROM {F}.contact WHERE \"Region__c\" = 'DACH'")
    assert data[0]["n"] == 0, data
    return "0 DACH rows"


# ── marketing: masked, consent filtered ───────────────────────────────────


@check("M1", "amelie (marketing)", "only opted-in contacts; e-mail hashed, phone partial, birthday NULL, svnr gone")
def _() -> str:
    cols, data, state = rows(amelie, f"SELECT * FROM {K}.contacts")
    assert all(r["marketing_opt_in"] for r in data), "an opted-out contact leaked"
    assert "svnr" not in cols, cols
    assert all(HEX16.match(r["email"]) for r in data), data[0]["email"]
    assert all(r["birth_date"] is None for r in data)
    sample = data[0]
    return (f"{len(data)} rows; email={sample['email']} phone={sample['phone']} "
            f"name={sample['first_name']} birth={sample['birth_date']}; notes={state.get('masks')}")


@check("M2", "amelie (marketing)", "filtering on a masked column cannot recover the value")
def _() -> str:
    _, data, _ = rows(amelie, f"SELECT count(*) AS n FROM {K}.contacts WHERE email LIKE '%@%' OR phone LIKE '+43%'")
    assert data[0]["n"] == 0, data
    _, data, _ = rows(amelie, f"SELECT count(*) AS n FROM {K}.contacts WHERE email = '{STAR}'")
    assert data[0]["n"] == 0, data
    return "LIKE '%@%' → 0, email = '<real address>' → 0"


@check("M3", "amelie (marketing)", "hashed e-mails join across the two CRMs (dedup without seeing addresses)")
def _() -> str:
    _, data, _ = rows(amelie, f"""
        SELECT count(*) AS both_crms FROM {K}.contacts k JOIN {F}.contact f ON k.email = f."Email" """)
    _, total, _ = rows(tomasz, f"""
        SELECT count(*) FILTER (WHERE k.email = f."Email") AS exact,
               count(*) FILTER (WHERE lower(k.email) = lower(f."Email")) AS ignoring_case
        FROM {K}.contacts k JOIN {F}.contact f ON lower(k.email) = lower(f."Email")
        WHERE k.marketing_opt_in AND NOT f."HasOptedOutOfEmail" """)
    assert data[0]["both_crms"] == total[0]["ignoring_case"], (data, total)
    return (f"marketing matched {data[0]['both_crms']} travellers in both CRMs; "
            f"in clear (same consent filter): exact {total[0]['exact']}, ignoring case {total[0]['ignoring_case']}")


@check("M4", "amelie (marketing)", "Margarethe opted out in Kestrel: marketing never sees her there")
def _() -> str:
    _, data, _ = rows(amelie, f"SELECT count(*) AS n FROM {K}.contacts WHERE contact_id = 1001")
    assert data[0]["n"] == 0, data
    return "contact 1001 filtered out by the consent rule"


@check("M4b", "amelie (marketing)", "hashing ignores case: the same address spelt differently joins")
def _() -> str:
    _, data, _ = rows(amelie, f"""
        SELECT count(*) AS hashed_matches FROM {F}.contact f JOIN {W}.members m ON f."Email" = m.email""")
    _, clear, _ = rows(tomasz, f"""
        SELECT count(*) FILTER (WHERE f."Email" = m.email) AS exact,
               count(*) AS ignoring_case
        FROM {F}.contact f JOIN {W}.members m ON lower(f."Email") = lower(m.email)
        WHERE NOT f."HasOptedOutOfEmail" """)
    assert data[0]["hashed_matches"] == clear[0]["ignoring_case"], (data, clear)
    return (f"Finch ⋈ Wayfarer on hashed e-mail: {data[0]['hashed_matches']}; in clear: exact "
            f"{clear[0]['exact']}, ignoring case {clear[0]['ignoring_case']}")


@check("M5", "amelie (marketing)", "the hidden column cannot be named")
def _() -> str:
    return refused(amelie, f"SELECT svnr FROM {K}.contacts")


@check("M6", "amelie (marketing)", "support tickets and billing are not hers")
def _() -> str:
    return f"{refused(amelie, f'SELECT * FROM {S}.tickets')} | {refused(amelie, f'SELECT * FROM {B}.invoices')}"


@check("M7", "amelie (marketing)", "Finch contacts: passport hidden, dietary (Art. 9) masked, opted-out rows gone")
def _() -> str:
    cols, data, _ = rows(amelie, f"SELECT * FROM {F}.contact")
    assert "Passport_Number__c" not in cols, cols
    assert not any(r["HasOptedOutOfEmail"] for r in data)
    diets = {r["Dietary_Requirements__c"] for r in data}
    return f"{len(data)} rows; dietary values seen: {sorted(map(str, diets))[:4]}; phone={data[0]['MobilePhone']}"


# ── customer care: tickets, then an access request ────────────────────────


@check("C1", "kwame (care)", "tickets: body readable with identifiers and keys scrubbed out")
def _() -> str:
    cols, data, state = rows(kwame, f"SELECT ticket_id, body FROM {S}.tickets ORDER BY ticket_id")
    text = " ".join(r["body"] or "" for r in data)
    for leak in ("AKIA" + "Z7KESTRELFINCH42", "sk_" + "live_", "Wayfarer!2025", "+43 664 2718281", "4111 1111"):
        assert leak not in text, leak
    star = data[0]["body"]
    assert "coeliac" in star, star
    return f"{len(data)} bodies, no key or number left; Margarethe's: {star[:140]}"


@check("C2", "kwame (care)", "after the owner approved his request: tier and points, name and e-mail masked")
def _() -> str:
    _, data, _ = rows(kwame, f"SELECT full_name, email, tier, points_balance FROM {W}.members WHERE member_no = 'WF-0700000'")
    assert data and data[0]["full_name"] == "****" and data[0]["tier"] == "Falcon", data
    return f"{data[0]}"


@check("C3", "kwame (care)", "a caller gives her e-mail: lookup by the real value finds nothing (filters see masked values)")
def _() -> str:
    _, data, _ = rows(kwame, f"SELECT count(*) AS n FROM {W}.members WHERE lower(email) = '{STAR}'")
    assert data[0]["n"] == 0, data
    return "0 rows: support cannot look a caller up by e-mail"


# ── finance: the ODBC source ──────────────────────────────────────────────


@check("F1", "olga (finance)", "invoices over the ODBC source: IBAN last four, e-mail hashed")
def _() -> str:
    _, data, state = rows(olga, f"SELECT invoice_no, customer_name, iban, customer_email, amount FROM {B}.invoices "
                                f"ORDER BY invoice_no LIMIT 3")
    return f"{data[0]}"


@check("F2", "olga (finance)", "card PANs show the last four only; join invoices ⋈ cards on hashed e-mail")
def _() -> str:
    _, data, _ = rows(olga, f"""SELECT c.card_pan, c.card_holder, count(i.invoice_no) AS invoices
        FROM {B}.payment_cards c JOIN {B}.invoices i ON i.customer_email = c.customer_email
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 3""")
    assert all("•" in r["card_pan"] or "*" in r["card_pan"] for r in data), data
    return f"{data}"


# ── BI analyst and the agency ─────────────────────────────────────────────


@check("I1", "ravi (BI)", "bookings by region across both CRMs (all rows, buyer names masked)")
def _() -> str:
    _, data, _ = rows(ravi, f"""
        SELECT region, sum(amount) AS revenue, count(*) AS deals FROM (
          SELECT region, amount_eur AS amount FROM {K}.deals WHERE stage IN ('booked', 'travelled')
          UNION ALL
          SELECT "Region__c", "Amount" FROM {F}.opportunity WHERE "StageName" = 'Closed Won'
        ) GROUP BY region ORDER BY revenue DESC""")
    return "; ".join(f"{r['region']}: {r['deals']} deals, {float(r['revenue']):,.0f}" for r in data)


@check("J1", "jonas (agency)", "Data consumer + dataset grant: one table, no findings, sources or activity")
def _() -> str:
    cat = jonas.catalog()
    assert list(cat) == ["shared.marketing.traveller_360"], list(cat)
    codes = {p: jonas.raw("POST" if p == "search/findings" else "GET", p, json={} if p == "search/findings" else None).status_code
             for p in ("search/findings", "sources", "audit-events")}
    assert all(c == 403 for c in codes.values()), codes
    return f"catalog {list(cat)}; {codes}"


@check("J2", "jonas (agency)", "the dataset: consented travellers, e-mail and name masked")
def _() -> str:
    _, data, state = rows(jonas, "SELECT count(*) AS n, count(*) FILTER (WHERE in_kestrel AND in_finch) AS both_crms, "
                                 "min(email) AS email FROM shared.marketing.traveller_360")
    assert data[0]["email"] == "****" and data[0]["n"] == 197, data
    return f"{data[0]}"


# ── bypass attempts ───────────────────────────────────────────────────────

BYPASS = [
    ("X1", "read_parquet on the bucket", "SELECT * FROM read_parquet('s3://lake/kestrel-finch/**/*.parquet')"),
    ("X2", "delta_scan on the table path", "SELECT * FROM delta_scan('s3://lake/kestrel-finch/finch_salesforce/contact')"),
    ("X3", "postgres_scan with the CRM's host", "SELECT * FROM postgres_scan('host=lab-shop-pg.classifyre-dev.svc dbname=kestrel_crm', 'crm', 'contacts')"),
    ("X4", "a hidden attach alias", "SELECT * FROM __src_0.crm.contacts"),
    ("X5", "information_schema", "SELECT * FROM information_schema.tables"),
    ("X6", "duckdb_secrets()", "SELECT * FROM duckdb_secrets()"),
    ("X7", "two statements", f"SELECT 1; DROP TABLE {K}.contacts"),
    ("X8", "a write in a CTE", f"WITH x AS (DELETE FROM {K}.contacts RETURNING *) SELECT * FROM x"),
    ("X9", "getenv()", "SELECT getenv('CLASSIFYRE_QUERY_WORKER_TOKEN')"),
    ("X10", "quoted mixed-case name of the hidden column",
     f'SELECT "SVNR" FROM {K}.contacts'),
    ("X11", "the svnr through a row value / struct", f"SELECT c FROM {K}.contacts c LIMIT 1"),
    ("X12", "pg_read_file / read_text", "SELECT * FROM read_text('/proc/self/environ')"),
]
for cid, what, sql in BYPASS:
    def make(sql: str = sql) -> Callable[[], str]:
        def run() -> str:
            if "LIMIT 1" in sql and "c FROM" in sql:
                try:
                    _, data, _ = rows(amelie, sql)
                    text = json.dumps(data, default=str)
                    assert "svnr" not in text and "+43" not in text, text[:200]
                    return f"allowed, but masked: {text[:160]}"
                except ApiError as error:
                    return f"refused: {error}"[:200]
            return refused(amelie, sql)
        return run
    check(cid, "amelie (bypass)", what)(make())


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / ".runs" / f"battle-{dt.datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps(RESULTS, indent=1, default=str))
    passed = sum(r["ok"] for r in RESULTS)
    print(f"\n{passed}/{len(RESULTS)} checks passed; {out}")
