"""psql 18 checks P1–P3 (BIC §5.4): TLS negotiation, catalog commands, data."""

from __future__ import annotations

import os
import subprocess
from typing import Any

from checks import run_all, spec

S = spec()


def conninfo(**extra: str) -> str:
    parts = {
        "host": S["host"],
        "port": str(S["port"]),
        "dbname": S["database"],
        "user": S["user"],
        "sslmode": "verify-full",
        "sslrootcert": S["ca"],
        "application_name": "bi-smoke-psql",
        **extra,
    }
    return " ".join(f"{k}={v}" for k, v in parts.items())


def psql(*args: str, **extra: str) -> str:
    env = {**os.environ, "PGPASSWORD": S["password"], "PGCONNECT_TIMEOUT": "20"}
    done = subprocess.run(
        ["psql", conninfo(**extra), "-X", "-v", "ON_ERROR_STOP=1", *args],
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
        check=False,
    )
    if done.returncode != 0:
        raise RuntimeError((done.stderr or done.stdout).strip()[:600])
    return done.stdout


def p1(out: dict[str, Any]) -> None:
    postgres = psql("-At", "-c", "SELECT version()")
    direct = psql("-At", "-c", "SELECT 1", sslnegotiation="direct")
    tls = psql("-At", "-c", "SHOW ssl", sslnegotiation="postgres")
    out["detail"] = f"version {postgres.strip()[:60]}; direct TLS -> {direct.strip()}; ssl {tls.strip()}"


def p2(out: dict[str, Any]) -> None:
    schemas = psql("-c", r"\dn")
    tables = psql("-c", r"\dt *.*")
    first = S["tables"][0]
    describe = psql("-c", rf'\d+ "{first["schema"]}".{first["table"]}')
    missing = [
        f"{t['schema']}.{t['table']}" for t in S["tables"] if t["table"] not in tables
    ]
    masked = S.get("maskedColumn")
    masked_note = ""
    if masked and masked["schema"] == first["schema"] and masked["table"] == first["table"]:
        masked_note = " (masked note present)" if "Masked" in describe else " (NO masked note)"
        if "Masked" not in describe:
            out["ok"] = False
    out["ok"] = out.get("ok", True) and not missing
    out["detail"] = (
        f"{schemas.count(chr(10))} schema lines, missing tables {missing}{masked_note}"
    )
    out["describe"] = describe[-1500:]


def p3(out: dict[str, Any]) -> None:
    q = S["queries"]["P3"]["sql"]
    data = psql("-A", "-F", "\t", "-c", q)
    lines = data.strip().splitlines()
    out["columns"] = lines[0].split("\t") if lines else []
    out["rows"] = [line.split("\t") for line in lines[1:-1]]
    try:
        copied = psql("-c", rf"\copy ({q}) to stdout")
        out["copy"] = f"COPY works: {len(copied.splitlines())} lines"
    except RuntimeError as error:
        out["copy"] = f"COPY refused: {error}"
    out["detail"] = f"{len(out['rows'])} rows; {out['copy']}"


run_all([("P1", p1), ("P2", p2), ("P3", p3)])
