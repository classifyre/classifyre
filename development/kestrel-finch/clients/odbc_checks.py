"""ODBC client checks, run inside classifyre/bi-smoke-drivers:dev (psqlODBC 18,
unixODBC, pyodbc), the driver Excel and Power BI use for PostgreSQL.

    docker run --rm -v "$PWD/development/kestrel-finch:/kf:ro" --entrypoint python3 \
      classifyre/bi-smoke-drivers:dev /kf/clients/odbc_checks.py

Reads /kf/.runs/connections.json; talks to the gateway on host.docker.internal:25432.
"""

from __future__ import annotations

import json
import time

import pyodbc

CONN = json.load(open("/kf/.runs/connections.json"))
CA = "/tmp/kf-ca.crt"
open(CA, "w").write(CONN["_ca"])
HOST = "host.docker.internal"


def connect(user: str) -> pyodbc.Connection:
    c = CONN[user]
    dsn = (
        "Driver={PostgreSQL Unicode};"
        f"Server={HOST};Port=25432;Database={CONN['_database']};"
        f"Uid={c['username']};Pwd={c['password']};"
        f"SSLmode=verify-ca;pqopt={{sslrootcert={CA}}};"
    )
    return pyodbc.connect(dsn, autocommit=True, timeout=30)


def timed(cursor: pyodbc.Cursor, sql: str, *params: object) -> tuple[list, float]:
    started = time.monotonic()
    cursor.execute(sql, *params)
    rows = cursor.fetchall()
    return rows, time.monotonic() - started


def report(cid: str, ok: bool, detail: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'} {cid:4} {detail}", flush=True)


# ── Amélie: Excel over ODBC ────────────────────────────────────────────────
amelie = connect("amelie.fontaine").cursor()
tables = sorted({(t.table_schem, t.table_name) for t in amelie.tables(tableType="TABLE")})
report("D1", len(tables) == 3, f"SQLTables (Excel's Navigator): {tables}")
cols = [(c.column_name, c.type_name, (c.remarks or "")[:40]) for c in amelie.columns(
    table="contacts", schema="kestrel_crm_hubspot_sync.crm")]
report("D2", not any(c[0] == "svnr" for c in cols), f"SQLColumns contacts: {cols}")
rows, secs = timed(amelie, 'SELECT email, phone, first_name, birth_date FROM "kestrel_crm_hubspot_sync.crm".contacts LIMIT 3')
report("D3", all(len(r.email) == 16 and r.birth_date is None for r in rows),
       f"masked rows in {secs:.2f}s: {[tuple(r) for r in rows]}")
rows, secs = timed(amelie, 'SELECT count(*) FROM "kestrel_crm_hubspot_sync.crm".contacts k '
                           'JOIN "finch_crm_salesforce_export.kestrel_finch_finch_salesforce".contact f '
                           'ON k.email = f."Email"')
report("D4", rows[0][0] > 0, f"hashed cross-CRM join over ODBC: {rows[0][0]} in {secs:.2f}s")
rows, secs = timed(amelie, 'SELECT count(*) FROM "kestrel_crm_hubspot_sync.crm".contacts WHERE region = ?', "DACH")
report("D5", rows[0][0] >= 0, f"parameter bound by the driver: {rows[0][0]} DACH contacts (consent filter on) in {secs:.2f}s")
for cid, sql in [("D6", 'SELECT svnr FROM "kestrel_crm_hubspot_sync.crm".contacts'),
                 ("D7", 'DELETE FROM "kestrel_crm_hubspot_sync.crm".contacts'),
                 ("D8", 'SELECT * FROM "billing_legacy_odbc.billing".invoices')]:
    try:
        amelie.execute(sql)
        amelie.fetchall()
        report(cid, False, f"allowed: {sql}")
    except pyodbc.Error as error:
        report(cid, True, f"refused: {sql[:60]} → {str(error.args[-1])[:140]}")

# ── Olga: Power BI's driver path, billing that itself comes over ODBC ──────
olga = connect("olga.lindqvist").cursor()
rows, secs = timed(olga, 'SELECT c.card_pan, count(*) AS invoices, sum(i.amount) AS total '
                         'FROM "billing_legacy_odbc.billing".payment_cards c '
                         'JOIN "billing_legacy_odbc.billing".invoices i ON i.customer_email = c.customer_email '
                         'GROUP BY 1 ORDER BY 3 DESC LIMIT 3')
report("D9", all(str(r.card_pan).startswith("••••") for r in rows),
       f"ODBC → gateway → ODBC source (a Job) in {secs:.2f}s: {[tuple(r) for r in rows]}")
rows, secs = timed(olga, 'SELECT currency, round(sum(amount), 2), count(*) FILTER (WHERE NOT paid) '
                         'FROM "billing_legacy_odbc.billing".invoices GROUP BY 1 ORDER BY 1')
report("D10", len(rows) >= 2, f"receivables by currency in {secs:.2f}s: {[tuple(r) for r in rows]}")

# ── Ravi: the shared dataset ──────────────────────────────────────────────
ravi = connect("ravi.iyer").cursor()
rows, secs = timed(ravi, 'SELECT wayfarer_tier, count(*), round(avg(loyalty_points)) FROM '
                         '"shared.marketing".traveller_360 WHERE wayfarer_tier IS NOT NULL GROUP BY 1 ORDER BY 2 DESC')
report("D11", len(rows) == 4, f"dataset over ODBC in {secs:.2f}s: {[tuple(r) for r in rows]}")
