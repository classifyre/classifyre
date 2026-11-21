"""psqlODBC 18 checks D1–D8 (BIC §5.2), through unixODBC and pyodbc.

psqlODBC is the driver Excel and Power BI load for PostgreSQL ODBC sources;
pyodbc calls the same ODBC entry points (SQLTables, SQLColumns,
SQLPrimaryKeys, SQLExecDirect with parameters) an application does.
"""

from __future__ import annotations

from typing import Any

import pyodbc
from checks import rows_of, run_all, spec

S = spec()
DRIVER = "PostgreSQL Unicode"


def connect(**options: str) -> pyodbc.Connection:
    base = {
        "Driver": DRIVER,
        "Server": S["host"],
        "Port": str(S["port"]),
        "Database": S["database"],
        "Uid": S["user"],
        "Pwd": options.pop("Pwd", S["password"]),
        "SSLMode": "verify-full",
        "pqopt": f"{{sslrootcert={S['ca']}}}",
        **options,
    }
    text = ";".join(f"{k}={v}" for k, v in base.items())
    return pyodbc.connect(text, autocommit=True, timeout=30)


def expected_tables() -> list[tuple[str, str]]:
    return [(t["schema"], t["table"]) for t in S["tables"]]


def d1(out: dict[str, Any]) -> None:
    with connect() as conn:
        found = {(r.table_schem, r.table_name) for r in conn.cursor().tables(tableType="TABLE")}
    missing = [f"{s}.{t}" for s, t in expected_tables() if (s, t) not in found]
    out["rows"] = sorted([list(x) for x in found])
    out["ok"] = not missing
    out["detail"] = f"{len(found)} tables; missing: {missing}" if missing else f"{len(found)} tables"


def d2(out: dict[str, Any]) -> None:
    result: dict[str, list[list[Any]]] = {}
    with connect() as conn:
        for schema, table in expected_tables():
            cols = conn.cursor().columns(table=table, schema=schema).fetchall()
            result[f"{schema}.{table}"] = [
                [c.column_name, c.data_type, c.type_name, c.remarks] for c in cols
            ]
    empty = [name for name, cols in result.items() if not cols]
    out["columns"] = result
    out["ok"] = not empty
    out["detail"] = f"no columns for {empty}" if empty else f"{len(result)} tables described"


def d3(out: dict[str, Any]) -> None:
    detail = []
    with connect() as conn:
        for schema, table in expected_tables()[:2]:
            pks = conn.cursor().primaryKeys(table=table, schema=schema).fetchall()
            stats = conn.cursor().statistics(table=table, schema=schema).fetchall()
            detail.append(f"{schema}.{table}: {len(pks)} pk, {len(stats)} stats")
    out["detail"] = "; ".join(detail)


def query(out: dict[str, Any], check_id: str, **options: str) -> None:
    q = S["queries"][check_id]
    with connect(**options) as conn:
        cursor = conn.cursor()
        cursor.execute(q["sql"], *q.get("params", []))
        out["columns"], out["types"], out["rows"] = rows_of(cursor, 0)
        out["description"] = [[d[0], getattr(d[1], "__name__", str(d[1]))] for d in cursor.description]


def d4(out: dict[str, Any]) -> None:
    results = {}
    for ssp in ("0", "1"):
        sub: dict[str, Any] = {}
        query(sub, "D4", UseServerSidePrepare=ssp)
        results[ssp] = sub
    out.update(results["0"])
    same = results["0"]["rows"] == results["1"]["rows"]
    out["ok"] = same
    out["detail"] = "UseServerSidePrepare=0 and =1 agree" if same else "prepare modes disagree"


def d5(out: dict[str, Any]) -> None:
    query(out, "D5", UseDeclareFetch="1", Fetch="100")
    out["detail"] = f"{len(out['rows'])} rows via DECLARE/FETCH"


def d6(out: dict[str, Any]) -> None:
    # BoolsAsChar=1 (psqlODBC's default) sends booleans as text on purpose;
    # this check is about numbers, so booleans come as SQL_BIT here.
    query(out, "D6", BoolsAsChar="0")
    numeric = {"int", "float", "Decimal"}
    textual = [d for d in out["description"] if d[1] == "str" and d[0] != "label"]
    out["ok"] = not textual
    out["detail"] = (
        f"numeric columns came back as text: {textual}" if textual else f"types {out['types']}"
    )
    del numeric


def d7(out: dict[str, Any]) -> None:
    results = {}
    for bools in ("0", "1"):
        sub: dict[str, Any] = {}
        query(sub, "D7", BoolsAsChar=bools)
        results[bools] = sub["rows"]
    out["rows"] = results["0"]
    want = S["queries"]["D7"]["expectText"]
    got = results["0"][0][0] if results["0"] else None
    out["ok"] = got == want
    out["detail"] = f"text {got!r} (want {want!r}); BoolsAsChar=1 row {results['1']}"


def d8(out: dict[str, Any]) -> None:
    try:
        connect(Pwd="not-the-password").close()
    except pyodbc.Error as error:
        message = str(error)
        out["ok"] = "28P01" in message or "password" in message.lower()
        out["detail"] = message[:300]
        return
    out["ok"] = False
    out["detail"] = "a wrong password was accepted"


run_all(
    [("D1", d1), ("D2", d2), ("D3", d3), ("D4", d4), ("D5", d5), ("D6", d6), ("D7", d7), ("D8", d8)]
)
