#!/usr/bin/env python3
"""Query latency and throughput against the lakehouse-lab workspace.

Runs a fixed mix of SELECTs over the lab's sources through the REST API
(``POST /<ws>/query-runs``, then polling) and, with ``--pg``, through the SQL
gateway (psycopg, a SQL connection created for the run). It measures what a
person waits for: submit to result.

    export BENCH_USER=admin BENCH_PASSWORD=admin   # or API_TOKEN, see workspace.py
    python3 bench_query.py --label jobs --out .bench/jobs.json
    uv run --with 'psycopg[binary]' python bench_query.py --pg --label jobs

``--mix connectors`` runs the joins over live sources instead
(``queries/connectors/*.sql``: Meilisearch, Neo4j, PostgreSQL and Parquet,
docs/prd/QC-query-connectors.md §6); ``--verify`` checks each answer against
``queries/connectors/expected.json`` (``seed/connectors.py``), and
``--no-source-filters`` runs with Meilisearch's filterable attributes cleared,
so nothing is filtered at the source (same answers, more documents read):

    uv run --with pyarrow python bench_query.py --mix connectors --verify --repeat 10

Phases: ``sequential`` (each query alone, --repeat times) and ``concurrent``
(--clients workers looping over the mix for --seconds; one person may have 3
queries running, so 3 is the most one user can measure). Results go to stdout
and, with --out, to a JSON file that ``--compare a.json b.json`` tabulates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8811")
NS = os.environ.get("NS", "lakehouse-lab")
TOKEN = os.environ.get("API_TOKEN", "")
# Or sign in (and refresh) as a user: the token lives five minutes, a run longer.
IAM_TOKEN_URL = os.environ.get(
    "IAM_TOKEN_URL",
    "http://localhost:8280/iam/realms/classifyre/protocol/openid-connect/token",
)
BENCH_USER = os.environ.get("BENCH_USER", "")
BENCH_PASSWORD = os.environ.get("BENCH_PASSWORD", "")
_token_lock = threading.Lock()
_token: dict[str, Any] = {"value": TOKEN, "expires": float("inf") if TOKEN else 0.0}


def token() -> str:
    with _token_lock:
        if time.monotonic() < _token["expires"]:
            return str(_token["value"])
        form = urllib.parse.urlencode(
            {
                "client_id": "lab-cli",
                "username": BENCH_USER,
                "password": BENCH_PASSWORD,
                "grant_type": "password",
                "scope": "openid organization:default",
            }
        ).encode()
        with urllib.request.urlopen(IAM_TOKEN_URL, data=form, timeout=30) as response:
            body = json.loads(response.read())
        _token["value"] = body["access_token"]
        _token["expires"] = time.monotonic() + int(body.get("expires_in", 300)) - 60
        return str(_token["value"])


PG_HOST = os.environ.get("PG_HOST", "localhost")
PG_PORT = int(os.environ.get("PG_PORT", "25432"))

#: Tables a SQL connection sees in the lab too (some lab tables are closed to
#: SQL connections), so both transports run the same mix.
MIX: dict[str, str] = {
    "s3_delta_count": "SELECT count(*) FROM lab_s3_tables.tables.delta_orders",
    "s3_iceberg_rows": "SELECT * FROM lab_s3_tables.tables.iceberg_contacts",
    "s3_trino_delta_rows": "SELECT * FROM lab_s3_tables.tables_trino_delta.customers",
    "azure_delta_rows": "SELECT * FROM lab_azure_tables.tables.delta_orders",
    "cross_source_join": (
        "SELECT count(*) AS n FROM lab_s3_tables.tables.delta_orders s "
        "JOIN lab_azure_tables.tables.delta_orders a ON s.id = a.id"
    ),
}
#: Catalog-backed sources, measured sequentially over REST only.
REST_EXTRA: dict[str, str] = {
    "polaris_iceberg_count": "SELECT count(*) FROM lab_polaris_iceberg_rest.crm.orders",
    "ducklake_rows": "SELECT * FROM lab_ducklake.crm.people",
    "polaris_x_s3_join": (
        "SELECT count(*) AS n FROM lab_s3_tables.tables.delta_orders o "
        "JOIN lab_polaris_iceberg_rest.crm.contacts c ON o.id = c.id"
    ),
}

#: Joins over live sources (QC §6), one per file; seed/connectors.py writes
#: their answers to expected.json.
CONNECTOR_QUERIES = Path(__file__).parent / "queries" / "connectors"
MEILI_ADMIN = os.environ.get("MEILI_ADMIN", "http://localhost:17700")
MEILI_KEY = os.environ.get("MEILI_KEY", "lab-meili-master-key-0123456789")
MEILI_FILTERABLE = ["genre", "year", "id"]


def connector_mix() -> dict[str, str]:
    return {
        path.stem: path.read_text(encoding="utf-8")
        for path in sorted(CONNECTOR_QUERIES.glob("*.sql"))
    }


TERMINAL = {"SUCCESS", "ERROR", "TIMEOUT", "CANCELLED"}
_TABLE = re.compile(r"\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b")


def pg_sql(sql: str) -> str:
    """The gateway names a table `"source.schema".table`."""
    return _TABLE.sub(lambda m: f'"{m.group(1)}.{m.group(2)}".{m.group(3)}', sql)


def call(method: str, path: str, body: object = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"authorization": f"Bearer {token()}"}
    if data:
        headers["content-type"] = "application/json"
    request = urllib.request.Request(
        f"{BASE}/{NS}{path}", data=data, method=method, headers=headers
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        payload = response.read()
    return json.loads(payload) if payload else None


def rest_query(sql: str, timeout: float = 180.0) -> dict[str, Any]:
    start = time.monotonic()
    try:
        return _rest_query(sql, start, timeout)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:200]
        return {
            "ok": False,
            "seconds": time.monotonic() - start,
            "error": f"HTTP {exc.code} {body}",
        }
    except Exception as exc:
        return {"ok": False, "seconds": time.monotonic() - start, "error": str(exc)[:200]}


def _rest_query(sql: str, start: float, timeout: float) -> dict[str, Any]:
    run = call("POST", "/query-runs", {"sql": sql})
    delay = 0.05
    while run["status"] not in TERMINAL:
        if time.monotonic() - start > timeout:
            return {"ok": False, "seconds": time.monotonic() - start, "error": "bench timeout"}
        time.sleep(delay)
        delay = min(delay * 1.5, 0.5)
        run = call("GET", f"/query-runs/{run['id']}")
    seconds = time.monotonic() - start
    timings = run.get("timings") or {}
    return {
        "ok": run["status"] == "SUCCESS",
        "seconds": seconds,
        "rows": run.get("rowCount"),
        "setup_ms": timings.get("setupMs"),
        "execute_ms": timings.get("executeMs"),
        "error": (run.get("error") or {}).get("message"),
        "run_id": run["id"],
        # Connector tables: requests, rows and filters sent per table.
        "scans": run.get("scans") or [],
    }


def result_rows(run_id: str) -> list[dict[str, Any]]:
    """A finished run's rows (needs pyarrow: ``uv run --with pyarrow``)."""
    import pyarrow as pa

    request = urllib.request.Request(
        f"{BASE}/{NS}/query-runs/{run_id}/result",
        headers={"authorization": f"Bearer {token()}"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return pa.ipc.open_stream(response.read()).read_all().to_pylist()


def _plain(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "as_tuple"):  # Decimal
        return round(float(value), 6)
    return value


def verify(mix: dict[str, str]) -> dict[str, Any]:
    """Each query's answer against the one worked out from the seed."""
    expected = json.loads((CONNECTOR_QUERIES / "expected.json").read_text(encoding="utf-8"))
    report: dict[str, Any] = {}
    for name, sql in mix.items():
        sample = rest_query(sql)
        if not sample["ok"]:
            report[name] = {"ok": False, "error": sample["error"]}
            print(f"  {name:28} FAILED {sample['error']}", flush=True)
            continue
        rows = [{k: _plain(v) for k, v in row.items()} for row in result_rows(sample["run_id"])]
        want = expected["queries"].get(name)
        same = rows == want
        report[name] = {"ok": same, "rows": len(rows), "scans": sample["scans"]}
        reads = ", ".join(
            f"{s['table']} {s['rows']} rows/{s['requests']} req" for s in sample["scans"]
        )
        print(
            f"  {name:28} {'same' if same else 'DIFFERENT'} ({len(rows)} rows) {reads}", flush=True
        )
        if not same:
            report[name]["got"] = rows[:5]
            report[name]["want"] = (want or [])[:5]
    return report


def meili_filterable(attributes: list[str]) -> None:
    """Set the lab index's filterable attributes and wait until applied."""
    headers = {"authorization": f"Bearer {MEILI_KEY}", "content-type": "application/json"}
    request = urllib.request.Request(
        f"{MEILI_ADMIN}/indexes/movies/settings/filterable-attributes",
        data=json.dumps(attributes).encode(),
        method="PUT",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        task = json.loads(response.read())["taskUid"]
    while True:
        status = urllib.request.Request(f"{MEILI_ADMIN}/tasks/{task}", headers=headers)
        with urllib.request.urlopen(status, timeout=60) as response:
            if json.loads(response.read())["status"] in ("succeeded", "failed", "canceled"):
                return
        time.sleep(0.2)


class PgClient:
    """One long-lived gateway session, as a BI pool keeps."""

    #: The gateway takes one sign-in per client address at a time.
    _connect_lock = threading.Lock()

    def __init__(self, user: str, password: str, ca: str) -> None:
        import psycopg

        with PgClient._connect_lock:
            self.conn = self._connect(psycopg, user, password, ca)

    @staticmethod
    def _connect(psycopg: Any, user: str, password: str, ca: str) -> Any:
        for attempt in range(10):
            try:
                return PgClient._open(psycopg, user, password, ca)
            except psycopg.OperationalError as exc:
                if "under way" not in str(exc) or attempt == 9:
                    raise
                time.sleep(0.5)
        raise RuntimeError("unreachable")

    @staticmethod
    def _open(psycopg: Any, user: str, password: str, ca: str) -> Any:
        return psycopg.connect(
            host=PG_HOST,
            port=PG_PORT,
            dbname=NS,
            user=user,
            password=password,
            sslmode="verify-full",
            sslrootcert=ca,
            autocommit=True,
            connect_timeout=30,
        )

    def query(self, sql: str) -> dict[str, Any]:
        start = time.monotonic()
        try:
            with self.conn.cursor() as cur:
                cur.execute(pg_sql(sql))
                rows = cur.fetchall()
            return {"ok": True, "seconds": time.monotonic() - start, "rows": len(rows)}
        except Exception as exc:
            return {"ok": False, "seconds": time.monotonic() - start, "error": str(exc)[:200]}

    def close(self) -> None:
        self.conn.close()


def pg_credentials(out_dir: Path) -> tuple[str, str, str]:
    secret = call(
        "POST", "/data-connections", {"name": f"bench {int(time.time())}", "expiresInDays": 1}
    )
    endpoint = call("GET", "/data-connections/endpoint")
    ca = out_dir / "bench-ca.crt"
    ca.write_text(endpoint["caCertificate"], encoding="utf-8")
    return secret["connection"]["username"], secret["password"], str(ca)


def summarize(samples: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [s["seconds"] for s in samples if s["ok"]]
    out: dict[str, Any] = {"n": len(samples), "ok": len(ok), "failed": len(samples) - len(ok)}
    if ok:
        ok.sort()
        out["p50"] = round(statistics.median(ok), 3)
        out["p95"] = round(ok[min(len(ok) - 1, round(0.95 * (len(ok) - 1)))], 3)
        out["min"] = round(ok[0], 3)
        out["max"] = round(ok[-1], 3)
    setups = [s["setup_ms"] for s in samples if s.get("setup_ms") is not None]
    if setups:
        out["setup_ms_p50"] = round(statistics.median(setups))
    errors = sorted({s["error"] for s in samples if not s["ok"] and s.get("error")})
    if errors:
        out["errors"] = errors[:5]
    # Live tables: what the last successful run read from each source.
    last = next((s for s in reversed(samples) if s["ok"] and s.get("scans")), None)
    if last:
        out["reads"] = {
            scan["table"]: {"requests": scan["requests"], "rows": scan["rows"]}
            for scan in last["scans"]
        }
    return out


def sequential(run_one: Any, repeat: int, mix: dict[str, str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, sql in mix.items():
        samples = [run_one(sql) for _ in range(repeat)]
        result[name] = summarize(samples)
        print(f"  {name:24s} {json.dumps(result[name])}", flush=True)
    return result


def concurrent(
    make_runner: Any, clients: int, seconds: float, mix: dict[str, str] | None = None
) -> dict[str, Any]:
    samples: list[dict[str, Any]] = []
    lock = threading.Lock()
    stop_at = time.monotonic() + seconds
    sqls = list((mix or MIX).values())

    def worker(index: int) -> None:
        try:
            run_one, close = make_runner()
        except Exception as exc:
            with lock:
                samples.append({"ok": False, "seconds": 0.0, "error": f"connect: {exc}"[:200]})
            return
        i = index
        try:
            while time.monotonic() < stop_at:
                sample = run_one(sqls[i % len(sqls)])
                with lock:
                    samples.append(sample)
                if not sample["ok"]:
                    time.sleep(0.5)
                i += 1
        finally:
            close()

    started = time.monotonic()
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(clients)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.monotonic() - started
    out = summarize(samples)
    out["clients"] = clients
    out["wall_s"] = round(wall, 1)
    out["qps"] = round(out["ok"] / wall, 2)
    print(f"  {clients:2d} clients {json.dumps(out)}", flush=True)
    return out


def compare(paths: list[str]) -> None:
    runs = [json.loads(Path(p).read_text()) for p in paths]
    labels = [r["label"] for r in runs]
    for transport in ("rest", "pg"):
        if not any(transport in r for r in runs):
            continue
        print(f"\n### {transport}: sequential p50 / p95 (s)\n")
        print("| query | " + " | ".join(labels) + " |")
        print("|---|" + "---|" * len(labels))
        for name in {**MIX, **REST_EXTRA}:
            cells = []
            for r in runs:
                s = r.get(transport, {}).get("sequential", {}).get(name)
                cells.append(f"{s['p50']} / {s['p95']}" if s and "p50" in s else "—")
            print(f"| {name} | " + " | ".join(cells) + " |")
        print(f"\n### {transport}: concurrent\n")
        print(
            "| clients | "
            + " | ".join(f"{label} q/s · p50 · p95 · failed" for label in labels)
            + " |"
        )
        print("|---|" + "---|" * len(labels))
        counts = sorted(
            {c["clients"] for r in runs for c in r.get(transport, {}).get("concurrent", [])}
        )
        for n in counts:
            cells = []
            for r in runs:
                c = next(
                    (c for c in r.get(transport, {}).get("concurrent", []) if c["clients"] == n),
                    None,
                )
                cells.append(
                    f"{c['qps']} · {c.get('p50', '—')} · {c.get('p95', '—')} · {c['failed']}"
                    if c
                    else "—"
                )
            print(f"| {n} | " + " | ".join(cells) + " |")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--label", default="run")
    parser.add_argument("--out")
    parser.add_argument("--repeat", type=int, default=5)
    # One person runs at most 3 queries at once (MAX_ACTIVE_PER_ACTOR).
    parser.add_argument("--clients", default="1,2,3", help="comma-separated client counts")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--pg", action="store_true", help="also run through the SQL gateway")
    parser.add_argument("--no-rest", action="store_true")
    parser.add_argument("--compare", nargs="+", metavar="JSON")
    parser.add_argument("--mix", choices=("lab", "connectors"), default="lab")
    parser.add_argument("--verify", action="store_true", help="check answers (connectors mix)")
    parser.add_argument(
        "--no-source-filters",
        action="store_true",
        help="clear Meilisearch's filterable attributes for the run (connectors mix)",
    )
    args = parser.parse_args()
    if args.compare:
        compare(args.compare)
        return
    if not TOKEN and not (BENCH_USER and BENCH_PASSWORD):
        sys.exit("export API_TOKEN, or BENCH_USER and BENCH_PASSWORD")
    out_dir = Path(args.out).parent if args.out else Path()
    out_dir.mkdir(parents=True, exist_ok=True)
    clients = [int(c) for c in args.clients.split(",") if c]
    report: dict[str, Any] = {"label": args.label, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}

    if args.mix == "connectors":
        mix = connector_mix()
        rest_mix = mix
        report["mix"] = "connectors"
        report["source_filters"] = not args.no_source_filters
        if args.no_source_filters:
            meili_filterable([])
    else:
        mix = MIX
        rest_mix = {**MIX, **REST_EXTRA}
    try:
        _run(args, report, mix=mix, rest_mix=rest_mix, clients=clients, out_dir=out_dir)
    finally:
        if args.mix == "connectors" and args.no_source_filters:
            meili_filterable(MEILI_FILTERABLE)
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")


def _run(
    args: Any,
    report: dict[str, Any],
    *,
    mix: dict[str, str],
    rest_mix: dict[str, str],
    clients: list[int],
    out_dir: Path,
) -> None:
    print("warm-up", rest_query(next(iter(mix.values()))), flush=True)
    if args.verify:
        print("verify", flush=True)
        report["verify"] = verify(mix)
    if not args.no_rest:
        print("REST sequential", flush=True)
        report["rest"] = {
            "sequential": sequential(rest_query, args.repeat, rest_mix),
            "concurrent": [],
        }
        print("REST concurrent", flush=True)
        for n in clients:
            report["rest"]["concurrent"].append(
                concurrent(lambda: (rest_query, lambda: None), n, args.seconds, mix)
            )
    if args.pg:
        user, password, ca = pg_credentials(out_dir)

        def pg_runner() -> tuple[Any, Any]:
            client = PgClient(user, password, ca)
            return client.query, client.close

        print("PG sequential", flush=True)
        run_one, close = pg_runner()
        report["pg"] = {"sequential": sequential(run_one, args.repeat, mix), "concurrent": []}
        close()
        print("PG concurrent", flush=True)
        for n in clients:
            report["pg"]["concurrent"].append(concurrent(pg_runner, n, args.seconds, mix))


if __name__ == "__main__":
    main()
