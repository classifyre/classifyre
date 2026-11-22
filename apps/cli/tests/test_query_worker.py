"""The warm query worker (src/query/worker.py): real processes, real HTTP.

Each test starts a worker on a free port and sends it what the API sends: the
query Job's request JSON. The result comes back the way a Job delivers it, to
a callback server standing in for the API.
"""

from __future__ import annotations

import http.client
import http.server
import json
import os
import signal
import socket
import sys
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from src.query.runner import ensure_dependencies
from src.utils.uv_sync import auto_install_enabled, sync_group

if auto_install_enabled():
    for _group in ("file-processing", "lineage"):
        sync_group(_group)
try:
    ensure_dependencies()
except Exception as exc:  # auto-install off and the groups absent
    pytest.skip(f"query dependencies unavailable: {exc}", allow_module_level=True)

from src.query.runner import TOKEN_HEADER
from src.query.worker import (
    QUERY_PATH,
    QueryWorker,
    Token,
    WorkerConfig,
    WorkerConfigError,
    _Handler,
    _Server,
    auto_slots,
    default_start_method,
    engine_budget,
    scrub_environment,
)

duckdb = pytest.importorskip("duckdb")
pa = pytest.importorskip("pyarrow")

TOKEN = "test-token-0123456789abcdef"
#: Five copies of a 300-row table, cross-joined: runs far longer than any test.
SLOW_SQL = (
    "SELECT count(*) FROM files.local.orders a, files.local.orders b, "
    "files.local.orders c, files.local.orders d, files.local.orders e"
)


# ── configuration ────────────────────────────────────────────────────────


def test_engine_budget_shares_the_container() -> None:
    assert engine_budget(4, 4096, 2) == ("582MB", 1)
    assert engine_budget(1, 2048, 4) == ("896MB", 4)
    # Never below a floor, whatever the container says.
    assert engine_budget(64, 512, 1) == ("128MB", 1)


def test_slots_follow_the_pod_memory() -> None:
    assert auto_slots(4096, 384) == 8
    assert auto_slots(32 * 1024, 256) == 125  # one big pod: 100+ at once
    assert auto_slots(512, 384) == 1
    assert auto_slots(1024 * 1024, 64) == 256  # capped: scale out past this


def test_unset_slots_come_from_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.query.worker.get_effective_memory_mb", lambda: 8192)
    env = {
        "CLASSIFYRE_QUERY_WORKER_TOKEN": TOKEN,
        "CLASSIFYRE_QUERY_WORKER_MEMORY_PER_QUERY_MB": "256",
    }
    assert WorkerConfig.from_env(env).slots == 29


def test_config_takes_the_token_out_of_the_environment() -> None:
    env = {"CLASSIFYRE_QUERY_WORKER_TOKEN": TOKEN, "CLASSIFYRE_QUERY_WORKER_SLOTS": "3"}
    config = WorkerConfig.from_env(env)
    assert config.token.matches(f"Bearer {TOKEN}")
    assert not config.token.matches("Bearer nope-0123456789abcdef")
    assert config.slots == 3
    assert "CLASSIFYRE_QUERY_WORKER_TOKEN" not in env
    assert TOKEN not in repr(config)


def test_config_reads_a_token_file(tmp_path: Path) -> None:
    path = tmp_path / "token"
    path.write_text(TOKEN + "\n", encoding="utf-8")
    env = {"CLASSIFYRE_QUERY_WORKER_TOKEN_FILE": str(path)}
    assert WorkerConfig.from_env(env).token.matches(f"Bearer {TOKEN}")


def test_a_new_token_file_takes_effect_without_a_restart(tmp_path: Path) -> None:
    """The kubelet swaps a Secret's file when the Secret changes."""
    path = tmp_path / "token"
    path.write_text(TOKEN, encoding="utf-8")
    token = Token(path=str(path))
    assert token.matches(f"Bearer {TOKEN}")
    following = "next-token-0123456789abcdef"
    (tmp_path / "token.new").write_text(following, encoding="utf-8")
    (tmp_path / "token.new").replace(path)
    assert token.matches(f"Bearer {following}")
    assert not token.matches(f"Bearer {TOKEN}")
    # Mid-swap (no file) or a short one: the last good token stays.
    path.unlink()
    assert token.matches(f"Bearer {following}")


def test_query_processes_see_only_what_they_need() -> None:
    env = {
        "PATH": "/usr/bin",
        "HOME": "/tmp",
        "UV_CACHE_DIR": "/tmp/uv",
        "CLASSIFYRE_DUCKDB_BAKED_EXTENSION_DIR": "/opt/duckdb-extensions",
        "CLASSIFYRE_QUERY_MAX_SPILL": "1GiB",
        "DATABASE_URL": "postgresql://api:secret@db/classifyre",
        "CLASSIFYRE_INTERNAL_KEY": "k",
        "CLASSIFYRE_MASKED_CONFIG_KEY": "k",
        "QUERY_WORKER_TOKEN": TOKEN,
        "KUBERNETES_SERVICE_HOST": "10.0.0.1",
        "AWS_SECRET_ACCESS_KEY": "s",
        "MY_PROXY_CA": "/etc/ca.pem",
        "ACME_REGION": "eu",
        "CLASSIFYRE_QUERY_WORKER_ENV_ALLOW": "MY_PROXY_CA, ACME_*",
    }
    removed = scrub_environment(env)
    assert removed == [
        "AWS_SECRET_ACCESS_KEY",
        "CLASSIFYRE_INTERNAL_KEY",
        "CLASSIFYRE_MASKED_CONFIG_KEY",
        "DATABASE_URL",
        "KUBERNETES_SERVICE_HOST",
        "QUERY_WORKER_TOKEN",
    ]
    assert env["MY_PROXY_CA"] == "/etc/ca.pem"
    assert env["ACME_REGION"] == "eu"
    assert env["CLASSIFYRE_QUERY_MAX_SPILL"] == "1GiB"


@pytest.mark.parametrize(
    "env",
    [
        {},
        {"CLASSIFYRE_QUERY_WORKER_TOKEN": "short"},
        {"CLASSIFYRE_QUERY_WORKER_TOKEN": TOKEN, "CLASSIFYRE_QUERY_WORKER_SLOTS": "-1"},
        {"CLASSIFYRE_QUERY_WORKER_TOKEN": TOKEN, "CLASSIFYRE_QUERY_WORKER_START_METHOD": "x"},
        # A forked query process would start as a copy of the main process.
        {"CLASSIFYRE_QUERY_WORKER_TOKEN": TOKEN, "CLASSIFYRE_QUERY_WORKER_START_METHOD": "fork"},
    ],
)
def test_config_refuses_what_cannot_work(env: dict[str, str]) -> None:
    with pytest.raises(WorkerConfigError):
        WorkerConfig.from_env(env)


# ── a running worker ─────────────────────────────────────────────────────


class _Callbacks(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _CallbackHandler)
        self.received: list[dict[str, Any]] = []


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    server: _Callbacks

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.received.append(
            {"path": self.path, "headers": dict(self.headers), "body": body}
        )
        self.send_response(204)
        self.end_headers()


@pytest.fixture()
def callbacks() -> Iterator[_Callbacks]:
    server = _Callbacks()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture()
def folder(tmp_path: Path) -> Path:
    conn = duckdb.connect()
    conn.execute(
        "COPY (SELECT range AS id, ['AT','DE','FR'][range % 3 + 1] AS country "
        f"FROM range(30)) TO '{tmp_path / 'customers.parquet'}'"
    )
    conn.execute(
        "COPY (SELECT range AS oid, range % 30 AS customer_id, range * 2 AS amount "
        f"FROM range(300)) TO '{tmp_path / 'orders.csv'}' (HEADER)"
    )
    conn.close()
    return tmp_path


class _Running:
    def __init__(self, worker: QueryWorker, server: _Server) -> None:
        self.worker = worker
        self.server = server
        self.port = server.server_address[1]

    def post(
        self, body: dict[str, Any], token: str = TOKEN, timeout: float = 60
    ) -> tuple[int, dict[str, Any]]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        data = json.dumps(body).encode()
        conn.request(
            "POST",
            QUERY_PATH,
            body=data,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        response = conn.getresponse()
        payload = json.loads(response.read() or b"{}")
        conn.close()
        return response.status, payload

    def get(self, path: str) -> tuple[int, str]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", path)
        response = conn.getresponse()
        text = response.read().decode()
        conn.close()
        return response.status, text


def _start(slots: int = 2, drain_seconds: int = 1, **options: Any) -> _Running:
    config = WorkerConfig(
        token=Token(value=TOKEN),
        host="127.0.0.1",
        port=0,
        slots=slots,
        drain_seconds=drain_seconds,
        start_method=default_start_method(),
        memory_mb=4096,
        **options,
    )
    worker = QueryWorker(config)
    server = _Server(("127.0.0.1", 0), _Handler)
    server.worker = worker
    threading.Thread(target=server.serve_forever, daemon=True).start()
    worker.start()
    return _Running(worker, server)


@pytest.fixture()
def running(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Running]:
    # No extension downloads in tests; the fork server's own flag is restored after.
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_EXTENSIONS", "")
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_FORKSERVER", "1")
    running = _start()
    yield running
    running.server.shutdown()
    running.server.server_close()


def _request(
    folder: Path, sql: str, callbacks: _Callbacks | None = None, **extra: Any
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "runId": "run-1",
        "sql": sql,
        "maxRows": 100,
        "timeoutSeconds": 30,
        "sources": [
            {
                "alias": "files",
                "sourceId": "src-1",
                "recipe": {"type": "LOCAL_FOLDER", "required": {"path": str(folder)}},
            }
        ],
        "tables": [
            {
                "source": "files",
                "schema": "local",
                "table": "customers",
                "location": {"kind": "file", "format": "parquet", "objectKey": "customers.parquet"},
            },
            {
                "source": "files",
                "schema": "local",
                "table": "orders",
                "location": {"kind": "file", "format": "csv", "objectKey": "orders.csv"},
            },
        ],
        **extra,
    }
    if callbacks is not None:
        port = callbacks.server_address[1]
        request["callbackUrl"] = f"http://127.0.0.1:{port}/query-runs/run-1/result"
        request["callbackToken"] = "run-token"
    return request


def _wait(predicate: Any, seconds: float = 15) -> bool:
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        if predicate():
            return True
        time.sleep(0.05)
    return bool(predicate())


def test_runs_a_query_and_delivers_it_like_a_job(
    running: _Running, folder: Path, callbacks: _Callbacks
) -> None:
    status, body = running.post(
        _request(
            folder,
            "SELECT c.country, count(*) AS n FROM files.local.customers c "
            "JOIN files.local.orders o ON o.customer_id = c.id GROUP BY ALL ORDER BY 1",
            callbacks,
        )
    )
    assert status == 200, body
    assert body["outcome"] == "done"
    assert body["exitCode"] == 0
    assert body["payload"]["status"] == "success"
    assert body["payload"]["rowCount"] == 3
    # The result went to the API the way a Job sends it: Arrow, the run's token.
    assert len(callbacks.received) == 1
    posted = callbacks.received[0]
    assert posted["path"] == "/query-runs/run-1/result"
    assert posted["headers"][TOKEN_HEADER] == "run-token"
    rows = pa.ipc.open_stream(posted["body"]).read_all().to_pylist()
    assert rows == [
        {"country": "AT", "n": 100},
        {"country": "DE", "n": 100},
        {"country": "FR", "n": 100},
    ]


def test_each_query_runs_in_its_own_process(running: _Running, folder: Path) -> None:
    sql = "SELECT count(*) AS n FROM files.local.orders"
    results = [running.post(_request(folder, sql)) for _ in range(3)]
    assert all(status == 200 and body["exitCode"] == 0 for status, body in results)
    assert running.worker.stats.queries.get("success") == 3


def test_a_refused_query_is_an_error_payload(running: _Running, folder: Path) -> None:
    status, body = running.post(_request(folder, "SELECT * FROM files.local.secret"))
    assert status == 200
    assert body["exitCode"] == 1
    assert body["payload"]["status"] == "error"


def test_refuses_without_the_token(running: _Running, folder: Path) -> None:
    status, _ = running.post(_request(folder, "SELECT 1"), token="wrong-token-0123456789")
    assert status == 401
    assert running.worker.stats.queries == {}


def test_refuses_when_every_slot_is_taken(running: _Running, folder: Path) -> None:
    for _ in range(running.worker.config.slots):
        assert running.worker._slots.acquire(blocking=False)
    try:
        status, body = running.post(_request(folder, "SELECT count(*) FROM files.local.orders"))
    finally:
        for _ in range(running.worker.config.slots):
            running.worker._slots.release()
    assert status == 503
    assert body["code"] == "busy"
    assert running.worker.stats.refused == {"busy": 1}


def test_the_query_deadline_still_holds(running: _Running, folder: Path) -> None:
    status, body = running.post(_request(folder, SLOW_SQL, timeoutSeconds=1))
    assert status == 200
    assert body["payload"]["status"] == "error"
    assert body["payload"]["error"]["code"] == "timeout"


def test_a_dropped_request_stops_its_query(running: _Running, folder: Path) -> None:
    data = json.dumps(_request(folder, SLOW_SQL, timeoutSeconds=60)).encode()
    sock = socket.create_connection(("127.0.0.1", running.port))
    sock.sendall(
        (
            f"POST {QUERY_PATH} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {TOKEN}\r\n"
            f"Content-Type: application/json\r\nContent-Length: {len(data)}\r\n\r\n"
        ).encode()
        + data
    )
    assert _wait(lambda: running.worker.stats.active == 1)
    time.sleep(0.5)
    sock.close()  # what the API does when the person cancels
    assert _wait(lambda: running.worker.stats.active == 0)
    assert running.worker.stats.queries == {"cancelled": 1}
    # Killed mid-query, it could not clean up: the worker did.
    assert list(running.worker._query_dirs.iterdir()) == []


def test_draining_finishes_then_refuses(running: _Running, folder: Path) -> None:
    results: list[tuple[int, dict[str, Any]]] = []
    slow = threading.Thread(
        target=lambda: results.append(running.post(_request(folder, SLOW_SQL, timeoutSeconds=60)))
    )
    slow.start()
    assert _wait(lambda: running.worker.stats.active == 1)
    status, _ = running.get("/readyz")
    assert status == 200
    drained = threading.Thread(target=running.worker.drain)
    drained.start()
    assert _wait(lambda: not running.worker.ready)
    status, body = running.post(_request(folder, "SELECT count(*) FROM files.local.orders"))
    assert status == 503
    assert body["code"] == "draining"
    status, _ = running.get("/readyz")
    assert status == 503
    # Past the drain deadline (1 s here), the slow query is stopped.
    drained.join(30)
    slow.join(30)
    assert results and results[0][1]["outcome"] == "stopped"
    assert running.worker.stats.active == 0


def test_metrics_count_outcomes(running: _Running, folder: Path) -> None:
    running.post(_request(folder, "SELECT count(*) FROM files.local.orders"))
    status, text = running.get("/metrics")
    assert status == 200
    assert 'classifyre_query_worker_queries_total{outcome="success"} 1' in text
    assert "classifyre_query_worker_slots 2" in text
    assert "classifyre_query_worker_ready 1" in text


# ── isolation ────────────────────────────────────────────────────────────


def test_a_query_writes_only_into_its_own_directory_which_goes_with_it(
    running: _Running, folder: Path
) -> None:
    seen: list[list[Path]] = []
    done = threading.Event()

    def watch() -> None:
        while not done.is_set():
            entries = list(running.worker._query_dirs.iterdir())
            if entries:
                seen.append(entries)
            time.sleep(0.01)

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    status, body = running.post(_request(folder, "SELECT count(*) FROM files.local.orders"))
    done.set()
    watcher.join(5)
    assert status == 200 and body["exitCode"] == 0, body
    assert seen and all(len(entries) == 1 for entries in seen)
    assert list(running.worker._query_dirs.iterdir()) == []


def test_a_query_that_dies_takes_no_other_query_with_it(running: _Running, folder: Path) -> None:
    results: list[tuple[int, dict[str, Any]]] = []
    slow = threading.Thread(
        target=lambda: results.append(running.post(_request(folder, SLOW_SQL, timeoutSeconds=60)))
    )
    slow.start()
    assert _wait(lambda: len(running.worker._running) == 1)
    (pid,) = list(running.worker._running)
    os.kill(pid, signal.SIGKILL)
    slow.join(30)
    assert results and results[0][1]["outcome"] == "crashed"
    assert results[0][1]["exitCode"] == -signal.SIGKILL
    status, body = running.post(_request(folder, "SELECT count(*) FROM files.local.orders"))
    assert status == 200 and body["payload"]["status"] == "success"


@pytest.mark.parametrize("source_type", ["ODBC", "CUSTOM"])
def test_sources_that_load_their_own_code_run_as_jobs(
    running: _Running, folder: Path, source_type: str
) -> None:
    # ODBC loads the driver the source names; CUSTOM runs its notebook's scan().
    request = _request(folder, "SELECT 1")
    request["sources"].append(
        {"alias": "erp", "sourceId": "src-2", "recipe": {"type": source_type, "required": {}}}
    )
    status, body = running.post(request)
    assert status == 503
    assert body["code"] == "job_only"
    assert running.worker.stats.refused == {"job_only": 1}


linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux /proc")


@linux_only
def test_set_not_dumpable_closes_the_process_to_others() -> None:
    import subprocess

    probe = (
        "import ctypes; from src.query.worker import set_not_dumpable; "
        "set_not_dumpable(); print(ctypes.CDLL(None).prctl(3, 0, 0, 0, 0))"  # PR_GET_DUMPABLE
    )
    out = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=True, timeout=60
    )
    assert out.stdout.strip() == "0"


@linux_only
def test_the_memory_guard_stops_a_query_past_its_cap(
    monkeypatch: pytest.MonkeyPatch, folder: Path
) -> None:
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_EXTENSIONS", "")
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_FORKSERVER", "1")
    guarded = _start(max_query_memory_mb=1)  # any query is past 1 MB of its own
    try:
        status, body = guarded.post(_request(folder, SLOW_SQL, timeoutSeconds=60))
        assert status == 200
        assert body["outcome"] == "memory"
    finally:
        guarded.server.shutdown()
        guarded.server.server_close()


@linux_only
def test_the_fork_server_has_no_other_thread_when_it_forks(running: _Running) -> None:
    """A thread holding a lock at fork() leaves it held in every query process."""
    assert running.worker.warm_timings.get("other_threads") == 0.0


def test_the_memory_guard_counts_the_working_set_not_the_page_cache(tmp_path: Path) -> None:
    """Spilling to the disk-backed /tmp fills the page cache, which the
    kernel reclaims before it kills anything: counting it would stop
    healthy queries (review of 383fd5c4, P5)."""
    from src.query.worker import container_memory_mb

    mib = 1024 * 1024
    v2 = tmp_path / "v2"
    v2.mkdir()
    (v2 / "memory.current").write_text(str(3000 * mib))
    (v2 / "memory.stat").write_text(
        f"anon {1000 * mib}\nfile {2000 * mib}\ninactive_file {1800 * mib}\n"
    )
    assert container_memory_mb(v2) == 1200
    v1 = tmp_path / "v1"
    (v1 / "memory").mkdir(parents=True)
    (v1 / "memory" / "memory.usage_in_bytes").write_text(str(3000 * mib))
    (v1 / "memory" / "memory.stat").write_text(f"total_inactive_file {500 * mib}\n")
    assert container_memory_mb(v1) == 2500
    assert container_memory_mb(tmp_path / "none") is None


def test_one_workspace_keeps_room_for_the_others(
    monkeypatch: pytest.MonkeyPatch, folder: Path
) -> None:
    """Workspaces share the pool: one cannot take every slot (review of
    383fd5c4, P6). Over its share a query is answered busy, which the API
    takes to another pod or to a Job."""
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_EXTENSIONS", "")
    monkeypatch.setenv("CLASSIFYRE_QUERY_WORKER_FORKSERVER", "1")
    running = _start(slots=2, workspace_share_percent=50)
    try:
        slow = threading.Thread(
            target=lambda: running.post(
                _request(folder, SLOW_SQL, timeoutSeconds=60, workspaceId="ws-a")
            )
        )
        slow.start()
        assert _wait(lambda: running.worker.stats.active == 1)
        status, body = running.post(_request(folder, "SELECT 1 AS x", workspaceId="ws-a"))
        assert status == 503
        assert body["code"] == "busy"
        assert "share" in body["message"]
        status, body = running.post(_request(folder, "SELECT 1 AS x", workspaceId="ws-b"))
        assert status == 200, body
        running.worker.drain()
        slow.join(timeout=30)
    finally:
        running.server.shutdown()
        running.server.server_close()


def test_the_workspace_share_is_at_least_one_slot() -> None:
    from src.query.worker import workspace_slots

    assert workspace_slots(8, 75) == 6
    assert workspace_slots(1, 50) == 1
    assert workspace_slots(3, 100) == 3
