#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.27", "pyarrow>=17"]
# ///
"""BI smoke against the skaffold dev stack (docs/prd/BIC-bi-client-compatibility.md §4.3).

Metabase (pgJDBC inside) and the real drivers (psqlODBC 18, pgJDBC, psql 18)
read the `lakehouse-lab` workspace through the SQL gateway; every answer is
compared with the same query run through Classifyre's REST API as the same
person. Writes evidence to development/bi-smoke/.evidence/ and prints a table
in the shape of BIC §5. Exits 1 when a check fails.

    scripts/dev/bi-smoke.sh            # builds, installs, runs this
    uv run development/bi-smoke/bi_smoke.py [--only M1,M4] [--keep] [--skip-drivers]

Everything it creates (a persona, grants, exposures, SQL connections) is
removed again unless --keep.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import datetime as dt
import decimal
import json
import math
import os
import re
import secrets
import subprocess
import sys
import time
import traceback
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pyarrow as pa
import pyarrow.ipc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NS = os.environ.get("NS", "classifyre-dev")
RELEASE = os.environ.get("RELEASE", "classifyre")
API = os.environ.get("API_URL", "http://localhost:8811")
KC = os.environ.get("KC_URL", "http://localhost:8280/iam")
WS = os.environ.get("WORKSPACE", "lakehouse-lab")
METABASE_PORT = int(os.environ.get("METABASE_PORT", "3030"))
GATEWAY_HOST = f"{RELEASE}-sql-gateway.{NS}.svc"
PERSONA = "bi-smoke-viewer"
PERSONA_GROUP = "bi-smoke-viewers"
MB_EMAIL = "bi-smoke@example.test"
MB_PASSWORD = "bi-smoke-" + "metabase-1"  # throwaway Metabase in the dev cluster

#: The tables every client must see, by their REST name.
FIXTURES = [
    "lab_s3_tables.tables.delta_orders",
    "lab_s3_tables.tables.iceberg_contacts",
    "lab_polaris_iceberg_rest.crm.orders",
    "lab_azure_tables.tables.delta_orders",
    "lab_ducklake.crm.people",
]
#: What the persona may read (a Data reader grant on each); iceberg_contacts.contact is masked for it.
ORDERS = "lab_s3_tables.tables.delta_orders"  # id, email (masked for others)
CONTACTS = "lab_s3_tables.tables.iceberg_contacts"  # id, contact (masked for others)
PERSONA_TABLES = [ORDERS, CONTACTS]
MASKED = (CONTACTS, "contact")


def log(message: str) -> None:
    print(f"[bi-smoke {dt.datetime.now():%H:%M:%S}] {message}", flush=True)


# ── names: REST `src.schema.table`, gateway `"src.schema".table` ───────────


def pg_name(rest: str) -> str:
    source, schema, table = rest.split(".")
    return f'"{source}.{schema}".{table}'


def pg_parts(rest: str) -> tuple[str, str]:
    source, schema, table = rest.split(".")
    return f"{source}.{schema}", table


def sql_for(template: str, dialect: str) -> str:
    """`{lab_s3_tables.tables.delta_orders}` → the table's name in that dialect."""
    return re.sub(
        r"\{([a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+)\}",
        lambda m: pg_name(m.group(1)) if dialect == "pg" else m.group(1),
        template,
    )


# ── Classifyre API ─────────────────────────────────────────────────────────


def token(username: str, password: str) -> str:
    response = httpx.post(
        f"{KC}/realms/classifyre/protocol/openid-connect/token",
        data={
            "client_id": "lab-cli",
            "username": username,
            "password": password,
            "grant_type": "password",
            "scope": "openid organization:default",
        },
        timeout=30,
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


class Classifyre:
    def __init__(self, bearer: str) -> None:
        self.http = httpx.Client(
            base_url=f"{API}/{WS}/", headers={"Authorization": f"Bearer {bearer}"}, timeout=60
        )

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.http.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"{method} {path} → {response.status_code} {response.text[:300]}")
        return response.json() if response.content else None

    def catalog(self) -> dict[str, dict[str, Any]]:
        data = self.call("GET", "data-query/catalog")
        return {t["sqlName"]: t for s in data["sources"] for t in s["tables"]}

    def query(self, sql: str, timeout: float = 180) -> tuple[list[str], list[list[Any]]]:
        """Run SQL as this person through REST; the reference every client is compared with."""
        run = self.call("POST", "query-runs", json={"sql": sql})
        deadline = time.monotonic() + timeout
        while True:
            state = self.call("GET", f"query-runs/{run['id']}")
            status = state.get("status")
            if status == "SUCCESS":
                break
            if status in ("ERROR", "TIMEOUT", "CANCELLED"):
                raise RuntimeError(f"reference query {status}: {state.get('error') or state}")
            if time.monotonic() > deadline:
                raise RuntimeError("reference query did not finish")
            time.sleep(0.4)
        raw = self.http.get(f"query-runs/{run['id']}/result")
        raw.raise_for_status()
        table = pa.ipc.open_stream(raw.content).read_all()
        return table.column_names, [list(r.values()) for r in table.to_pylist()]


# ── Keycloak persona (as scripts/smoke/seed.sh does it) ────────────────────


def kcadm(script: str, **env: str) -> str:
    admin_pw = subprocess.run(
        ["kubectl", "-n", NS, "get", "secret", f"{RELEASE}-iam", "-o", "jsonpath={.data.admin-password}"],
        capture_output=True, text=True, check=True,
    ).stdout
    env_args = [f"{k}={v}" for k, v in {"ADMIN_PW": base64.b64decode(admin_pw).decode(), **env}.items()]
    done = subprocess.run(
        ["kubectl", "-n", NS, "exec", "-i", f"deploy/{RELEASE}-iam", "-c", "iam", "--",
         "env", "HOME=/tmp", *env_args, "bash", "-s"],
        input="set -euo pipefail\nK=/opt/keycloak/bin/kcadm.sh\nR=classifyre\n"
        "$K config credentials --server http://localhost:8080/iam --realm master --user admin "
        '--password "$ADMIN_PW" >/dev/null\n'
        "ORG=$($K get organizations -r $R --fields id,alias --format csv --noquotes | grep ',default$' | cut -d, -f1)\n"
        + script,
        capture_output=True, text=True, check=False,
    )
    if done.returncode != 0:
        raise RuntimeError(f"kcadm failed: {done.stderr.strip()[:500]}")
    return done.stdout.strip()


def make_persona(password: str) -> str:
    """The persona user in its own group; returns the group id."""
    return kcadm(
        f"""
G=$($K get "organizations/$ORG/groups" -r $R --fields id,name --format csv --noquotes | {{ grep ",{PERSONA_GROUP}$" || true; }} | cut -d, -f1 | head -1)
[ -n "$G" ] || G=$($K create "organizations/$ORG/groups" -r $R -s name={PERSONA_GROUP} -i)
OLD=$($K get users -r $R -q username={PERSONA} -q exact=true --fields id --format csv --noquotes | head -1)
[ -z "$OLD" ] || $K delete "users/$OLD" -r $R
ID=$($K create users -r $R -s username={PERSONA} -s email={PERSONA}@example.test -s firstName=BI -s lastName=Smoke -s enabled=true -s emailVerified=true -i)
$K set-password -r $R --userid "$ID" --new-password "$PW"
$K create "organizations/$ORG/members" -r $R -b "\\"$ID\\"" >/dev/null
$K update "organizations/$ORG/groups/$G/members/$ID" -r $R -b '{{}}' >/dev/null
echo "$G"
""",
        PW=password,
    ).splitlines()[-1]


def drop_persona() -> None:
    kcadm(
        f"""OLD=$($K get users -r $R -q username={PERSONA} -q exact=true --fields id --format csv --noquotes | head -1)
[ -z "$OLD" ] || $K delete "users/$OLD" -r $R"""
    )


# ── Metabase ───────────────────────────────────────────────────────────────


def _metabase_error(body: str) -> str:
    """Metabase's exception chain, innermost cause first (its 500s wrap the real one)."""
    try:
        data = json.loads(body)
    except ValueError:
        return body[:1500]
    messages = [
        str(v.get("error") or v.get("message"))
        for v in data.get("via", [])
        if isinstance(v, dict) and (v.get("error") or v.get("message"))
    ]
    top = data.get("error") or data.get("message")
    return (" ← ".join(reversed(messages)) or str(top or body))[:1500]


class Metabase:
    def __init__(self, port: int) -> None:
        self.http = httpx.Client(base_url=f"http://127.0.0.1:{port}/api/", timeout=300)

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.http.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"Metabase {method} {path} → {response.status_code} {_metabase_error(response.text)}")
        try:
            return response.json()
        except ValueError:
            return response.text

    def sign_in(self) -> None:
        properties = self.call("GET", "session/properties")
        setup_token = properties.get("setup-token")
        if setup_token and not properties.get("has-user-setup"):
            session = self.call(
                "POST",
                "setup",
                json={
                    "token": setup_token,
                    "user": {"email": MB_EMAIL, "password": MB_PASSWORD, "first_name": "BI",
                             "last_name": "Smoke", "site_name": "bi-smoke"},
                    "prefs": {"site_name": "bi-smoke", "allow_tracking": False},
                },
            )
        else:
            session = self.call("POST", "session", json={"username": MB_EMAIL, "password": MB_PASSWORD})
        self.http.headers["X-Metabase-Session"] = session["id"]

    def add_database(self, name: str, user: str, password: str) -> int:
        for existing in self.call("GET", "database").get("data", []):
            if existing["name"] == name:
                self.call("DELETE", f"database/{existing['id']}")
        database = self.call(
            "POST",
            "database",
            json={
                "engine": "postgres",
                "name": name,
                "details": {
                    "host": GATEWAY_HOST, "port": 5432, "dbname": WS, "user": user,
                    "password": password, "ssl": True, "ssl-mode": "verify-full",
                    "ssl-root-cert-options": "local", "ssl-root-cert-path": "/ca/ca.crt",
                    "schema-filters-type": "all", "advanced-options": False,
                },
                "is_full_sync": True,
                "is_on_demand": False,
            },
        )
        return int(database["id"])

    def sync(self, database_id: int, expect: int, timeout: float = 300) -> list[dict[str, Any]]:
        self.call("POST", f"database/{database_id}/sync_schema")
        deadline = time.monotonic() + timeout
        tables: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            tables = self.call("GET", f"database/{database_id}/metadata").get("tables", [])
            if len(tables) >= expect and all(t.get("fields") for t in tables):
                break
            time.sleep(3)
        return tables

    def dataset(self, database_id: int, query: dict[str, Any], native: bool = False) -> dict[str, Any]:
        body = (
            {"database": database_id, "type": "native", "native": {"query": query["sql"]}}
            if native
            else {"database": database_id, "type": "query", "query": query}
        )
        result = self.call("POST", "dataset", json=body)
        if result.get("status") != "completed":
            raise RuntimeError(f"Metabase query failed: {str(result.get('error'))[:500]}")
        return result


# ── checks ─────────────────────────────────────────────────────────────────


@dataclass
class Result:
    id: str
    ok: bool | None  # None = not run
    ms: int = 0
    detail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


RESULTS: list[Result] = []


@contextlib.contextmanager
def check(check_id: str, only: set[str] | None) -> Iterator[dict[str, Any] | None]:
    if only and check_id not in only:
        yield None
        return
    out: dict[str, Any] = {"ok": True, "detail": ""}
    started = time.monotonic()
    try:
        yield out
    except Exception as error:  # noqa: BLE001 - every failure is a finding
        out["ok"] = False
        out["detail"] = f"{type(error).__name__}: {error}"
        out["trace"] = traceback.format_exc(limit=4)
    ms = int((time.monotonic() - started) * 1000)
    extra = {k: v for k, v in out.items() if k not in ("ok", "detail")}
    RESULTS.append(Result(check_id, bool(out["ok"]), ms, str(out["detail"]), extra))
    log(f"{check_id}: {'PASS' if out['ok'] else 'FAIL'} ({ms} ms) {str(out['detail'])[:200]}")


def not_run(check_id: str, why: str) -> None:
    RESULTS.append(Result(check_id, None, 0, why))


def norm(value: Any) -> str:
    """One text form per value, so a driver's, Metabase's and Arrow's answers compare."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, decimal.Decimal):
        value = float(value)
    if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", value)):
        number = float(value)
        if math.isfinite(number) and number == int(number) and abs(number) < 2**53:
            return str(int(number))
        return f"{number:.9g}"
    if isinstance(value, dt.datetime):
        return _instant(value)
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?", text):
        with contextlib.suppress(ValueError):
            return _instant(dt.datetime.fromisoformat(text.replace("Z", "+00:00")))
    return text


def _instant(value: dt.datetime) -> str:
    """A timestamp as one text: UTC for an instant, as written for a local one."""
    if value.tzinfo is not None:
        return value.astimezone(dt.UTC).strftime("%Y-%m-%d %H:%M:%S.%f+00")
    return value.strftime("%Y-%m-%d %H:%M:%S.%f")


def metabase_rows(result: dict[str, Any]) -> list[list[Any]]:
    """Metabase's rows in the forms the REST reference uses.

    Metabase shows dates and local timestamps as midnight / wall-clock time in
    its report time zone (`2026-01-02T00:00:00+01:00`): those are compared by
    their wall clock; timestamps with a time zone stay instants.
    """
    kinds = [str(c.get("base_type") or "") for c in result["data"]["cols"]]
    out = []
    for row in result["data"]["rows"]:
        values = []
        for kind, value in zip(kinds, row, strict=False):
            if isinstance(value, str) and kind == "type/Date":
                value = value[:10]
            elif isinstance(value, str) and kind == "type/DateTime":
                value = re.sub(r"(Z|[+-]\d{2}:?\d{2})$", "", value)
            values.append(value)
        out.append(values)
    return out


def same_rows(got: list[list[Any]], want: list[list[Any]], ordered: bool) -> tuple[bool, str]:
    g = [[norm(v) for v in row] for row in got]
    w = [[norm(v) for v in row] for row in want]
    if not ordered:
        g, w = sorted(g), sorted(w)
    if g == w:
        return True, f"{len(g)} rows equal the REST reference"
    first = next((i for i, (a, b) in enumerate(zip(g, w, strict=False)) if a != b), min(len(g), len(w)))
    return False, (
        f"differs from REST: {len(g)} vs {len(w)} rows; first difference at {first}: "
        f"{g[first] if first < len(g) else '—'} vs {w[first] if first < len(w) else '—'}"
    )


# ── the run ────────────────────────────────────────────────────────────────

#: Queries per check, with table names as {rest.name}; the same text runs over REST.
QUERIES: dict[str, str] = {
    "join": (
        "SELECT d.id, p.order_id FROM {lab_s3_tables.tables.delta_orders} d "
        "JOIN {lab_polaris_iceberg_rest.crm.orders} p ON p.order_id = d.id ORDER BY d.id"
    ),
    # The lab tables hold ids and text only, so the types come from expressions:
    # what PostgreSQL (PGlite describes) and DuckDB (computes) must agree on (POC F2).
    "types": (
        "SELECT 'x' AS label, avg(id) AS avg_int, sum(id) AS sum_int, count(*) AS n, "
        "round(CAST(avg(id) AS numeric), 2) AS round_num, max(CAST(id AS double precision)) AS max_double, "
        "CAST(max(id) AS numeric(12, 3)) AS dec_value, (max(id) > 0) AS all_positive, "
        "min(DATE '2026-01-01' + CAST(id AS integer)) AS first_day FROM {lab_s3_tables.tables.delta_orders}"
    ),
    "rows": "SELECT id, email FROM {lab_s3_tables.tables.delta_orders} ORDER BY id",
    "by_customer": "SELECT id, email FROM {lab_s3_tables.tables.delta_orders} WHERE id = {cid} ORDER BY id",
    "count": "SELECT count(*) AS n FROM {lab_s3_tables.tables.delta_orders}",
    "one": "SELECT 1 AS one FROM {lab_s3_tables.tables.delta_orders} LIMIT 1",
    "tz": (
        "SELECT CAST(DATE '2026-01-01' + CAST(id AS integer) AS timestamptz) AS ts, CAST(DATE '2026-01-01' + CAST(id AS integer) AS timestamp) AS ts_local "
        "FROM {lab_s3_tables.tables.delta_orders} ORDER BY id LIMIT 3"
    ),
    "unicode": "SELECT 'Grüße 👋' AS t, id > 0 AS b FROM {lab_s3_tables.tables.delta_orders} ORDER BY id LIMIT 1",
    "big": (
        "SELECT a.id AS a, b.id AS b, c.id AS c, d.id AS d FROM {lab_s3_tables.tables.delta_orders} a "
        "CROSS JOIN {lab_s3_tables.tables.delta_orders} b CROSS JOIN {lab_s3_tables.tables.delta_orders} c CROSS JOIN {lab_s3_tables.tables.delta_orders} d"
    ),
    "slow": (
        "SELECT sum(a.id * b.id + c.id - d.id + e.id * f.id + g.id - h.id + i.id) "
        "FROM {lab_s3_tables.tables.delta_orders} a, {lab_s3_tables.tables.delta_orders} b, {lab_s3_tables.tables.delta_orders} c, {lab_s3_tables.tables.delta_orders} d, {lab_s3_tables.tables.delta_orders} e, {lab_s3_tables.tables.delta_orders} f, {lab_s3_tables.tables.delta_orders} g, {lab_s3_tables.tables.delta_orders} h, {lab_s3_tables.tables.delta_orders} i"
    ),
}


def q(name: str, dialect: str, **values: Any) -> str:
    return sql_for(QUERIES[name], dialect).replace("{cid}", str(values.get("cid", 0)))


@contextlib.contextmanager
def port_forward() -> Iterator[None]:
    process = subprocess.Popen(
        ["kubectl", "-n", NS, "port-forward", "svc/bi-smoke-metabase", f"{METABASE_PORT}:3000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(f"http://127.0.0.1:{METABASE_PORT}/api/health", timeout=2).status_code == 200:
                    break
            time.sleep(1)
        yield
    finally:
        process.terminate()


def run_drivers(spec: dict[str, Any], ca: str) -> list[dict[str, Any]]:
    run_id = secrets.token_hex(3)
    secret = subprocess.run(
        ["kubectl", "-n", NS, "create", "secret", "generic", "bi-smoke-drivers-spec",
         f"--from-literal=spec.json={json.dumps(spec)}", f"--from-literal=ca.crt={ca}",
         "--dry-run=client", "-o", "yaml"],
        capture_output=True, text=True, check=True,
    ).stdout
    subprocess.run(["kubectl", "-n", NS, "apply", "-f", "-"], input=secret, text=True, check=True, capture_output=True)
    job = subprocess.run(
        ["helm", "template", "bi-smoke", str(HERE), "-n", NS, "--set", "drivers.enabled=true",
         "--set", f"drivers.runId={run_id}", "--show-only", "templates/drivers-job.yaml"],
        capture_output=True, text=True, check=True,
    ).stdout
    subprocess.run(["kubectl", "-n", NS, "apply", "-f", "-"], input=job, text=True, check=True, capture_output=True)
    name = f"job/bi-smoke-drivers-{run_id}"
    log(f"drivers {name} started")
    subprocess.run(
        ["kubectl", "-n", NS, "wait", name, "--for=jsonpath={.status.conditions[0].status}=True", "--timeout=900s"],
        capture_output=True, text=True, check=False,
    )
    output = subprocess.run(["kubectl", "-n", NS, "logs", name], capture_output=True, text=True, check=False).stdout
    lines = [json.loads(line.split(" ", 1)[1]) for line in output.splitlines() if line.startswith("__BI_SMOKE__ ")]
    versions = [line for line in output.splitlines() if line.startswith("== ")]
    log("drivers: " + "; ".join(versions))
    if not lines:
        log("drivers printed no results:\n" + output[-3000:])
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated check ids, e.g. M1,M4,D2")
    parser.add_argument("--keep", action="store_true", help="keep the persona, grants, exposures and connections")
    parser.add_argument("--skip-drivers", action="store_true")
    parser.add_argument("--skip-metabase", action="store_true")
    args = parser.parse_args()
    only = set(args.only.split(",")) if args.only else None
    started = dt.datetime.now(dt.UTC)
    cleanup: list[tuple[str, Callable[[], Any]]] = []

    admin = Classifyre(token("admin", "admin"))
    catalog = admin.catalog()
    missing = [name for name in FIXTURES if name not in catalog or not catalog[name].get("canQuery")]
    if missing:
        log(f"fixture tables missing or not queryable: {missing} (run development/lakehouse-lab steps)")
        return 2
    endpoint = admin.call("GET", "data-connections/endpoint")
    ca = endpoint.get("caCertificate") or ""
    configmap = subprocess.run(
        ["kubectl", "-n", NS, "create", "configmap", "bi-smoke-ca", f"--from-literal=ca.crt={ca}", "--dry-run=client", "-o", "yaml"],
        capture_output=True, text=True, check=True,
    ).stdout
    subprocess.run(["kubectl", "-n", NS, "apply", "-f", "-"], input=configmap, text=True, check=True, capture_output=True)

    try:
        # ── arrange: exposures, persona, grants, connections ──────────────
        exposed = {(e["type"], e["id"]) for e in admin.call("GET", "data-connections/exposures")}
        exposed_sources = {i for t, i in exposed if t == "source"}
        for name in FIXTURES:
            table = catalog[name]
            if ("asset", table["assetId"]) in exposed or table["sourceId"] in exposed_sources:
                continue
            admin.call("PUT", f"assets/{table['assetId']}/data-connections/exposure", json={"open": True})
            cleanup.append((f"close {name}", lambda a=table["assetId"]: admin.call(
                "PUT", f"assets/{a}/data-connections/exposure", json={"open": False})))
            log(f"opened {name} to SQL connections")

        tag = started.strftime("%m%d%H%M")
        created = admin.call(
            "POST", "data-connections",
            json={"name": f"bi-smoke admin {tag}", "expiresInDays": 1,
                  "scope": [f"asset:{catalog[n]['assetId']}" for n in FIXTURES]},
        )
        admin_conn = (created["connection"]["username"], created["password"])
        cleanup.append(("revoke admin connection", lambda i=created["connection"]["id"]: admin.call(
            "POST", f"data-connections/{i}/revoke", json={})))
        log(f"admin connection {admin_conn[0]}")

        persona_pw = secrets.token_hex(16)
        group_id = make_persona(persona_pw)
        cleanup.append(("drop persona", drop_persona))
        grants = [admin.call("POST", "access/grants", json={"subjectType": "group", "subjectId": group_id, "roleKey": "viewer"})]
        for name in PERSONA_TABLES:
            grants.append(admin.call("POST", "access/grants", json={
                "subjectType": "group", "subjectId": group_id, "roleKey": "data-reader",
                "scopeType": "asset", "resourceId": catalog[name]["assetId"]}))
        for grant in grants:
            cleanup.append((f"remove grant {grant['id']}", lambda g=grant["id"]: admin.call("DELETE", f"access/grants/{g}")))
        viewer = Classifyre(token(PERSONA, persona_pw))
        made = viewer.call("POST", "data-connections", json={
            "name": f"bi-smoke viewer {tag}", "expiresInDays": 1,
            "scope": [f"asset:{catalog[n]['assetId']}" for n in PERSONA_TABLES]})
        viewer_conn = (made["connection"]["username"], made["password"])
        cleanup.append(("revoke viewer connection", lambda i=made["connection"]["id"]: viewer.call(
            "POST", f"data-connections/{i}/revoke", json={})))
        log(f"persona {PERSONA} (group {group_id}), connection {viewer_conn[0]}")

        # ── references ────────────────────────────────────────────────────
        _, rows = admin.query(q("rows", "rest"))
        cid = rows[0][0] if rows else 0
        _, clear = admin.query(f"SELECT {MASKED[1]} FROM {MASKED[0]}")
        raw_values = {str(r[0]) for r in clear if r[0] and "*" not in str(r[0])}
        log(f"{len(rows)} rows in {ORDERS}; {len(raw_values)} raw values of {MASKED[0]}.{MASKED[1]} to look for")

        # ── drivers ───────────────────────────────────────────────────────
        if args.skip_drivers:
            for cid_ in [*(f"D{i}" for i in range(1, 9)), *(f"J{i}" for i in range(1, 9)), "P1", "P2", "P3"]:
                not_run(cid_, "--skip-drivers")
        else:
            driver_queries = {
                "D4": {"sql": sql_for(QUERIES["by_customer"], "pg").replace("{cid}", "?"), "params": [cid]},
                "D5": {"sql": q("rows", "pg")},
                "D6": {"sql": q("types", "pg")},
                "D7": {"sql": q("unicode", "pg"), "expectText": "Grüße 👋"},
                "P3": {"sql": q("rows", "pg")},
                "J2": {"sql": sql_for(QUERIES["by_customer"], "pg").replace("{cid}", "?"), "params": [cid]},
                "J3": {"sql": q("rows", "pg")},
                "J4": {"sql": q("rows", "pg")},
                "J5": {"sql": q("count", "pg")},
                "J6": {"sql": q("one", "pg")},
                "J7": {"sql": q("tz", "pg")},
                "J8": {"sql": q("slow", "pg")},
            }
            spec = {
                "host": GATEWAY_HOST, "port": 5432, "database": WS, "ca": "/spec/ca.crt",
                "user": admin_conn[0], "password": admin_conn[1],
                "tables": [dict(zip(("schema", "table"), pg_parts(n), strict=True)) for n in FIXTURES],
                "queries": driver_queries,
                "maskedColumn": None,
            }
            references = {
                "D4": admin.query(q("by_customer", "rest", cid=cid))[1],
                "J2": admin.query(q("by_customer", "rest", cid=cid))[1],
                "D5": rows, "J3": rows, "J4": rows, "P3": rows,
                "D6": admin.query(q("types", "rest"))[1],
                "J5": admin.query(q("count", "rest"))[1],
                "J7": admin.query(q("tz", "rest"))[1],
            }
            for line in run_drivers(spec, ca):
                check_id = line.pop("id")
                ok, detail = bool(line.pop("ok")), str(line.pop("detail", ""))
                want = references.get(check_id)
                if ok and want is not None and "rows" in line:
                    equal, why = same_rows(line["rows"], want, ordered=True)
                    ok, detail = equal, f"{detail}; {why}".strip("; ")
                if only is None or check_id in only:
                    RESULTS.append(Result(check_id, ok, int(line.pop("ms", 0)), detail, line))
                    log(f"{check_id}: {'PASS' if ok else 'FAIL'} {detail[:200]}")

        # ── Metabase ──────────────────────────────────────────────────────
        if args.skip_metabase:
            for i in range(1, 14):
                not_run(f"M{i}", "--skip-metabase")
        else:
            try:
                run_metabase(admin, viewer, admin_conn, viewer_conn, rows, raw_values, catalog, only)
            except Exception as error:  # noqa: BLE001 - Metabase could not be set up: every M check is lost
                RESULTS.append(Result("M0", False, 0, f"Metabase setup failed: {error}"))
                log(f"M0: FAIL Metabase setup failed: {error}")
    finally:
        if args.keep:
            log("--keep: leaving " + ", ".join(name for name, _ in cleanup))
        else:
            for name, undo in reversed(cleanup):
                try:
                    undo()
                except Exception as error:  # noqa: BLE001
                    log(f"clean-up '{name}' failed: {error}")
            log(f"cleaned up {len(cleanup)} things")

    return report(started)


def run_metabase(
    admin: Classifyre,
    viewer: Classifyre,
    admin_conn: tuple[str, str],
    viewer_conn: tuple[str, str],
    rows: list[list[Any]],
    raw_values: set[str],
    catalog: dict[str, dict[str, Any]],
    only: set[str] | None,
) -> None:
    with port_forward():
        mb = Metabase(METABASE_PORT)
        mb.sign_in()
        mb.call("PUT", "setting/report-timezone", json={"value": "Europe/Vienna"})
        db = mb.add_database("Classifyre (admin)", *admin_conn)
        log(f"Metabase database {db}: syncing")
        sync_started = dt.datetime.now(dt.UTC)
        tables = mb.sync(db, expect=len(FIXTURES))
        by_name = {(t["schema"], t["name"]): t for t in tables}

        def table(rest: str) -> dict[str, Any]:
            return by_name[pg_parts(rest)]

        def fid(rest: str, column: str) -> int:
            return next(f["id"] for f in table(rest)["fields"] if f["name"] == column)

        with check("M1", only) as out:
            if out is not None:
                missing = [n for n in FIXTURES if pg_parts(n) not in by_name]
                types = {f"{t['schema']}.{t['name']}": {f["name"]: f["base_type"] for f in t["fields"]} for t in tables}
                errors = metabase_errors(sync_started)
                out["types"], out["metabaseErrors"] = types, errors[:20]
                orders = types.get(".".join(pg_parts(ORDERS)), {})
                wrong = {k: v for k, v in orders.items() if (k, v) not in (("id", "type/BigInteger"), ("email", "type/Text"))}
                out["ok"] = not missing and not errors and not wrong
                out["detail"] = (f"{len(tables)} tables synced; missing {missing}; "
                                 f"{len(errors)} Metabase errors; orders types {orders}")

        with check("M2", only) as out:
            if out is not None:
                previews = {}
                for name in FIXTURES:
                    result = mb.dataset(db, {"source-table": table(name)["id"], "limit": 2000})
                    previews[name] = len(result["data"]["rows"])
                result = mb.dataset(db, {"source-table": table(ORDERS)["id"],
                                         "fields": [["field", fid(ORDERS, c), None]
                                                    for c in ("id", "email")],
                                         "order-by": [["asc", ["field", fid(ORDERS, "id"), None]]]})
                equal, why = same_rows(metabase_rows(result), rows, ordered=True)
                out["ok"], out["detail"] = equal, f"previews {previews}; orders: {why}"

        with check("M3", only) as out:
            if out is not None:
                orders = table(ORDERS)["id"]
                notes = []
                grouped = mb.dataset(db, {"source-table": orders, "aggregation": [["count"]],
                                          "breakout": [["field", fid(ORDERS, "email"), None]]})
                want = admin.query(f"SELECT email, count(*) FROM {ORDERS} GROUP BY email")[1]
                ok1, why1 = same_rows(metabase_rows(grouped), want, ordered=False)
                notes.append(f"group-by: {why1}")
                filtered = mb.dataset(db, {"source-table": orders,
                                           "aggregation": [["sum", ["field", fid(ORDERS, "id"), None]]],
                                           "filter": [">", ["field", fid(ORDERS, "id"), None], 2]})
                want = admin.query(f"SELECT sum(id) FROM {ORDERS} WHERE id > 2")[1]
                ok2, why2 = same_rows(metabase_rows(filtered), want, ordered=False)
                notes.append(f"filter+sum: {why2}")
                cust = table(CONTACTS)["id"]
                joined = mb.dataset(db, {
                    "source-table": orders, "aggregation": [["count"]],
                    "joins": [{"source-table": cust, "alias": "C", "strategy": "inner-join",
                               "condition": ["=", ["field", fid(ORDERS, "id"), None],
                                             ["field", fid(CONTACTS, "id"), {"join-alias": "C"}]]}],
                    "breakout": [["field", fid(CONTACTS, "contact"), {"join-alias": "C"}]]})
                want = admin.query(f"SELECT c.contact, count(*) FROM {ORDERS} o JOIN {CONTACTS} c "
                                   "ON c.id = o.id GROUP BY c.contact")[1]
                ok3, why3 = same_rows(metabase_rows(joined), want, ordered=False)
                notes.append(f"join: {why3}")
                out["ok"], out["detail"] = ok1 and ok2 and ok3, "; ".join(notes)

        with check("M4", only) as out:
            if out is not None:
                t0 = time.monotonic()
                result = mb.dataset(db, {"sql": q("join", "pg")}, native=True)
                out["seconds"] = round(time.monotonic() - t0, 2)
                equal, why = same_rows(metabase_rows(result), admin.query(q("join", "rest"))[1], ordered=True)
                out["ok"], out["detail"] = equal, f"S3 Delta ⋈ Polaris Iceberg in {out['seconds']} s: {why}"

        not_run("M6", "row filter persona not set up in this run yet")

        with check("M7", only) as out:
            if out is not None:
                result = mb.dataset(db, {"sql": q("types", "pg")}, native=True)
                cols = {c["name"]: c["base_type"] for c in result["data"]["cols"]}
                textual = {k: v for k, v in cols.items() if k != "label" and v == "type/Text"}
                equal, why = same_rows(metabase_rows(result), admin.query(q("types", "rest"))[1], ordered=True)
                tz = mb.dataset(db, {"sql": q("tz", "pg")}, native=True)
                tz_ref = admin.query(q("tz", "rest"))[1]
                tz_equal, tz_why = same_rows(metabase_rows(tz), tz_ref, ordered=True)
                out["ok"] = not textual and equal and tz_equal
                out["detail"] = (f"types {cols}; numbers as text: {textual}; values: {why}; "
                                 f"timestamptz under Europe/Vienna: {tz_why} "
                                 f"(got {tz['data']['rows'][:1]}, REST {tz_ref[:1]})")

        with check("M8", only) as out:
            if out is not None:
                result = mb.dataset(db, {"source-table": table(ORDERS)["id"],
                                         "aggregation": [["median", ["field", fid(ORDERS, "id"), None]]]})
                out["detail"] = f"median {result['data']['rows']}"

        with check("M9", only) as out:
            if out is not None:
                # Metabase never fingerprints or bins a column it takes for a
                # primary key (`id`), so a non-key number: Polaris' order_id.
                polaris = "lab_polaris_iceberg_rest.crm.orders"
                field_id = fid(polaris, "order_id")
                fingerprint = mb.call("GET", f"field/{field_id}").get("fingerprint")
                binned = mb.dataset(db, {"source-table": table(polaris)["id"], "aggregation": [["count"]],
                                         "breakout": [["field", field_id, {"binning": {"strategy": "default"}}]]})
                out["ok"] = bool(fingerprint) and bool(binned["data"]["rows"])
                out["detail"] = (f"fingerprint {'present' if fingerprint else 'MISSING'}; "
                                 f"{len(binned['data']['rows'])} bins: {binned['data']['rows'][:4]}")

        not_run("M10", "closing a table mid-session and revocation: not scripted yet")

        not_run("M11", "cancel from Metabase: covered by J8 for now")

        with check("M12", only) as out:
            if out is not None:
                sqls = [q(name, "pg") for name in ("rows", "types", "count", "join", "tz", "one")]
                t0 = time.monotonic()

                def card(sql: str) -> tuple[bool, float, str]:
                    started = time.monotonic()
                    try:
                        mb.dataset(db, {"sql": sql}, native=True)
                        return True, time.monotonic() - started, ""
                    except Exception as error:  # noqa: BLE001
                        return False, time.monotonic() - started, str(error)[:200]

                with concurrent.futures.ThreadPoolExecutor(6) as pool:
                    cards = list(pool.map(card, sqls))
                total = time.monotonic() - t0
                failures = [c[2] for c in cards if not c[0]]
                latencies = sorted(c[1] for c in cards)
                p95 = latencies[min(len(latencies) - 1, math.ceil(0.95 * len(latencies)) - 1)]
                out["ok"] = not failures and p95 < 3
                out["detail"] = (f"6 cards in {total:.1f} s, p95 {p95:.1f} s; failures: {failures}")

        with check("M13", only) as out:
            if out is not None:
                # Metabase starts streaming the file before the gateway refuses
                # the row over the cap (DQ R7: refused, never cut): what does a
                # person downloading get?
                lines, status, tail, broken = 0, 0, "", ""
                form = {"query": json.dumps({"database": db, "type": "native", "native": {"query": q("big", "pg")}})}
                try:
                    with mb.http.stream("POST", "dataset/csv", data=form) as response:
                        status = response.status_code
                        for chunk in response.iter_text():
                            lines += chunk.count("\n")
                            tail = (tail + chunk)[-400:]
                except httpx.HTTPError as error:
                    broken = f"{type(error).__name__}: {error}"
                refused = "more than 10000 rows" in tail
                # Metabase has already sent its header when the gateway refuses
                # row 10,001, so it can only abort the file: a broken download is
                # the refusal; a complete file with fewer rows would be a silent cut.
                out["ok"] = refused or bool(broken)
                out["detail"] = (f"HTTP {status}, {lines} lines received; refusal in the file: {refused}; "
                                 f"download {'broken: ' + broken if broken else 'complete'}; tail {tail[-160:]!r}")


        with check("M5", only) as out:
            if out is not None:
                # Its own pool, as one Metabase database per audience would be:
                # the admin database goes first, so the gateway has the memory.
                mb.call("DELETE", f"database/{db}")
                vdb = mb.add_database("Classifyre (viewer)", *viewer_conn)
                vtables = {(t["schema"], t["name"]): t for t in mb.sync(vdb, expect=len(PERSONA_TABLES))}
                customers = vtables[pg_parts(MASKED[0])]
                preview = mb.dataset(vdb, {"source-table": customers["id"], "limit": 2000})
                cols = [c["name"] for c in preview["data"]["cols"]]
                seen = {str(v) for row in preview["data"]["rows"] for v in row}
                leaked = sorted(raw_values & seen)
                field_id = next(f["id"] for f in customers["fields"] if f["name"] == MASKED[1])
                values = mb.call("GET", f"field/{field_id}/values").get("values", [])
                stored = {str(v[0] if isinstance(v, list) else v) for v in values}
                leaked_stored = sorted(raw_values & stored)
                like = mb.dataset(vdb, {"sql": f"SELECT count(*) FROM {pg_name(MASKED[0])} WHERE {MASKED[1]} LIKE '%@%'"}, native=True)
                like_count = like["data"]["rows"][0][0]
                others = [n for n in FIXTURES if n not in PERSONA_TABLES and pg_parts(n) in vtables]
                out["ok"] = not leaked and not leaked_stored and like_count == 0 and not others
                out["detail"] = (f"viewer sees {len(vtables)} tables (extra: {others}); columns {cols}; "
                                 f"leaked in preview {leaked[:3]}, in stored field values {leaked_stored[:3]}; "
                                 f"LIKE '%@%' counted {like_count}")

def metabase_errors(since: dt.datetime) -> list[str]:
    output = subprocess.run(
        ["kubectl", "-n", NS, "logs", "deploy/bi-smoke-metabase", f"--since-time={since.isoformat()}"],
        capture_output=True, text=True, check=False,
    ).stdout
    return [line for line in output.splitlines() if " ERROR " in line or "WARN sync" in line]


def report(started: dt.datetime) -> int:
    evidence = HERE / ".evidence"
    evidence.mkdir(exist_ok=True)
    sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    path = evidence / f"{started:%Y%m%d-%H%M}-{sha}.json"
    path.write_text(json.dumps([r.__dict__ for r in RESULTS], indent=2, default=str))
    print("\n| Check | Result | ms | Detail |\n| --- | --- | --- | --- |")
    for r in sorted(RESULTS, key=lambda r: (r.id[0], int(r.id[1:]))):
        mark = "not run" if r.ok is None else ("pass" if r.ok else "**FAIL**")
        print(f"| {r.id} | {mark} | {r.ms} | {r.detail.replace('|', '/').replace(chr(10), ' ')[:300]} |")
    print(f"\nEvidence: {path}")
    return 1 if any(r.ok is False for r in RESULTS) else 0


if __name__ == "__main__":
    sys.exit(main())
