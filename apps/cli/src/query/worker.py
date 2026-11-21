"""``python -m src.main query-worker``: a warm host that runs each SQL query in its own process.

A query Job pays, for every query, for a pod, an interpreter, and importing
DuckDB, pyarrow, SQLGlot and every source module before it reads a byte. The
worker pays for those once and forks a process per query from the warmed-up
state, so a query starts in milliseconds. What a query process does is exactly
what a query Job does (:func:`.runner.run_query`, then :func:`.runner._report`,
which posts the result to the API with the run's own token), so the API, the
result path and the audit are unchanged.

Processes::

    main process (HTTP, one thread per request)
      • bearer-token check, admission (one slot per running query), deadline,
        cancel when the API drops the request, drain on SIGTERM
      │ multiprocessing, "forkserver" start method (Linux)
      ▼
    fork server (single-threaded; imported src.query.warm once)
      │ fork() per query
      ▼
    query process (one per query)
      • only this request's sources and credentials, as a Job holds them
      • not dumpable: other processes of the same user cannot read its memory
      • exits when the query is done

The API talks to it over HTTP (``POST /v1/queries``). The request body is the
same JSON a query Job receives; the response is the status payload the Job
prints after :data:`.runner.RESULT_MARKER`. When every slot is taken or the
worker is draining it answers 503 before doing any work, and the API runs the
query as a Job instead.

macOS uses "spawn" (a fresh interpreter per query, no warm state): Apple's
frameworks are not fork-safe, and DuckDB's httpfs reaches them through curl.
"""

from __future__ import annotations

import hmac
import http.server
import json
import logging
import multiprocessing
import os
import signal
import socket
import sys
import threading
import time
from collections.abc import MutableMapping
from dataclasses import dataclass, field
from multiprocessing.connection import Connection, wait
from typing import Any

from ..utils.resources import get_effective_cpu_count, get_effective_memory_mb

logger = logging.getLogger(__name__)

ENV = "CLASSIFYRE_QUERY_WORKER_"
QUERY_PATH = "/v1/queries"
DEFAULT_PORT = 8090
#: Memory one running query is planned with when the slots follow the pod's
#: memory limit (``SLOTS`` unset or 0): Python and Arrow in the query process
#: plus DuckDB's share (70 % of it).
DEFAULT_MEMORY_PER_QUERY_MB = 384
#: Upper bound of automatic slots: past this the HTTP threads and forks of one
#: pod are the limit, not memory. Scale out (more replicas) instead.
MAX_AUTO_SLOTS = 256
#: Past the query's own timeout, how long a query process may live: setup and
#: result delivery are inside the session's deadline or retried by _report,
#: so this is the Job's ``activeDeadlineSeconds`` margin, a backstop.
BACKSTOP_SECONDS = 60.0
DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 3600
#: Memory the fork server, the HTTP process and Python in each query need
#: besides DuckDB's own buffer (which memory_limit bounds).
RESERVED_MEMORY_MB = 768


#: Environment a query process may see: enough to run Python, find the venv
#: and its caches, and reach the network. Everything else (the API's database
#: URL and keys in the all-in-one image, any Secret an operator mounted) is
#: removed before the fork server starts. Mirrors the API's notebook allowlist
#: (apps/api/src/cli-runner/notebook-env.ts).
ALLOWED_ENV = frozenset(
    {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "TMPDIR",
        "TEMP",
        "TMP",
        "HOSTNAME",
        "PYTHONPATH",
        "PYTHONHOME",
        "PYTHONIOENCODING",
        "PYTHONUNBUFFERED",
        "PYTHONDONTWRITEBYTECODE",
        "VIRTUAL_ENV",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "ODBCSYSINI",
        "ODBCINI",
        "LD_LIBRARY_PATH",
        "TELEMETRY_DISABLED",
    }
)
ALLOWED_ENV_PREFIXES = (
    "CLASSIFYRE_QUERY_",
    "CLASSIFYRE_DUCKDB_",
    "CLASSIFYRE_UV_SYNC_",
    "CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS",
    "UV_",
)


def scrub_environment(environ: MutableMapping[str, str]) -> list[str]:
    """Keep only what a query process may see; return the names removed.

    ``CLASSIFYRE_QUERY_WORKER_ENV_ALLOW`` (comma-separated names, a trailing
    ``*`` for a prefix) keeps more, for what an operator adds on purpose (the
    chart lists its ``extraEnv`` there).
    """
    extra = [name.strip() for name in environ.get(ENV + "ENV_ALLOW", "").split(",") if name.strip()]
    names = {n for n in extra if not n.endswith("*")}
    prefixes = ALLOWED_ENV_PREFIXES + tuple(n[:-1] for n in extra if n.endswith("*"))
    removed = [
        key
        for key in list(environ)
        if key not in ALLOWED_ENV and key not in names and not key.startswith(prefixes)
    ]
    for key in removed:
        del environ[key]
    return sorted(removed)


class WorkerConfigError(ValueError):
    """The worker's environment does not describe a usable configuration."""


def _int(environ: MutableMapping[str, str], name: str, default: int, minimum: int = 0) -> int:
    raw = environ.get(ENV + name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise WorkerConfigError(f"{ENV + name} must be a whole number, not {raw!r}") from None
    if value < minimum:
        raise WorkerConfigError(f"{ENV + name} must be at least {minimum}")
    return value


@dataclass(frozen=True)
class WorkerConfig:
    token: str = field(repr=False)
    host: str = "0.0.0.0"
    port: int = DEFAULT_PORT
    slots: int = 4
    drain_seconds: int = 60
    start_method: str = "forkserver"
    max_body_bytes: int = 16 * 1024 * 1024
    #: Address-space limit of one query process (Linux), 0 for none.
    query_memory_mb: int = 0
    node: str = ""

    @classmethod
    def from_env(cls, environ: MutableMapping[str, str] | None = None) -> WorkerConfig:
        """Read the configuration; the token leaves the environment here, so
        neither the fork server nor any query process inherits it."""
        env = os.environ if environ is None else environ
        token = env.pop(ENV + "TOKEN", "").strip()
        token_file = env.pop(ENV + "TOKEN_FILE", "").strip()
        if not token and token_file:
            with open(token_file, encoding="utf-8") as handle:
                token = handle.read().strip()
        if not token:
            raise WorkerConfigError(
                f"Set {ENV}TOKEN (or {ENV}TOKEN_FILE): the API signs its requests with it."
            )
        if len(token) < 16:
            raise WorkerConfigError(f"{ENV}TOKEN is too short (fewer than 16 characters)")
        method = env.get(ENV + "START_METHOD", "").strip() or default_start_method()
        if method not in {"forkserver", "spawn", "fork"}:
            raise WorkerConfigError(f"{ENV}START_METHOD must be forkserver, spawn or fork")
        return cls(
            token=token,
            host=env.get(ENV + "HOST", "").strip() or "0.0.0.0",
            port=_int(env, "PORT", DEFAULT_PORT, 1),
            slots=_int(env, "SLOTS", 0)
            or auto_slots(
                get_effective_memory_mb(),
                _int(env, "MEMORY_PER_QUERY_MB", DEFAULT_MEMORY_PER_QUERY_MB, 64),
            ),
            drain_seconds=_int(env, "DRAIN_SECONDS", 60),
            start_method=method,
            max_body_bytes=_int(env, "MAX_BODY_BYTES", 16 * 1024 * 1024, 1024),
            query_memory_mb=_int(env, "QUERY_MEMORY_MB", 0),
            node=env.get(ENV + "NODE_NAME", "").strip() or socket.gethostname(),
        )


def default_start_method() -> str:
    return "spawn" if sys.platform == "darwin" else "forkserver"


def auto_slots(memory_mb: int, per_query_mb: int) -> int:
    """Queries a container of ``memory_mb`` runs at once at ``per_query_mb`` each:
    a bigger pod (vertical scaling) runs more without being told."""
    usable = max(0, memory_mb - RESERVED_MEMORY_MB)
    return max(1, min(MAX_AUTO_SLOTS, usable // per_query_mb))


def engine_budget(slots: int, memory_mb: int, cpus: int) -> tuple[str, int]:
    """DuckDB's memory limit and threads for one query when ``slots`` run at once.

    A Job sizes DuckDB from its own pod (70 % of the limit, whole cores); here
    the container is shared, so each slot gets its share after what the
    processes themselves need.
    """
    usable = max(256, memory_mb - RESERVED_MEMORY_MB)
    per_query = max(128, int(usable * 0.7 / slots))
    threads = max(1, cpus // slots)
    return f"{per_query}MB", threads


# ── the query process ──────────────────────────────────────────────────


def _harden(query_memory_mb: int) -> None:
    """First thing a query process does: default signals, not dumpable, limits."""
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    if sys.platform.startswith("linux"):
        try:
            import ctypes

            pr_set_dumpable = 4
            ctypes.CDLL(None, use_errno=True).prctl(pr_set_dumpable, 0, 0, 0, 0)
        except Exception as exc:  # pragma: no cover - libc without prctl
            logger.debug("prctl(PR_SET_DUMPABLE) failed: %s", exc)
        if query_memory_mb > 0:
            import resource

            limit = query_memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _query_process(request_data: dict[str, Any], out: Connection, query_memory_mb: int) -> None:
    """Runs in the forked query process: one query, as a query Job runs it."""
    _harden(query_memory_mb)
    from .runner import _error, _report, run_query
    from .session import QueryRequest

    payload: dict[str, Any] = _error("execution_error", "The query process stopped early.")
    try:
        payload, result = run_query(request_data)
        _report(
            QueryRequest.from_dict(request_data),
            payload,
            result.arrow if result is not None else None,
            echo=False,
        )
    except Exception as exc:  # run_query catches query errors; this is the rest
        payload = _error("execution_error", type(exc).__name__)
    finally:
        try:
            out.send(payload)
        finally:
            out.close()


def _ping(out: Connection) -> None:
    """Started once at boot: brings the fork server up (and so warms it)."""
    from . import warm

    out.send(dict(warm.timings))
    out.close()


# ── the host ───────────────────────────────────────────────────────────


@dataclass
class Outcome:
    #: done | timeout | cancelled | crashed | stopped
    kind: str
    payload: dict[str, Any] | None = None
    exit_code: int | None = None


class Stats:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active = 0
        self.queries: dict[str, int] = {}
        self.refused: dict[str, int] = {}
        self.seconds_sum = 0.0

    def started(self) -> None:
        with self._lock:
            self.active += 1

    def finished(self, label: str, seconds: float) -> None:
        with self._lock:
            self.active -= 1
            self.queries[label] = self.queries.get(label, 0) + 1
            self.seconds_sum += seconds

    def refuse(self, reason: str) -> None:
        with self._lock:
            self.refused[reason] = self.refused.get(reason, 0) + 1

    def prometheus(self, slots: int, ready: bool) -> str:
        with self._lock:
            lines = [
                "# HELP classifyre_query_worker_slots Queries one worker runs at once.",
                "# TYPE classifyre_query_worker_slots gauge",
                f"classifyre_query_worker_slots {slots}",
                "# HELP classifyre_query_worker_active Queries running now.",
                "# TYPE classifyre_query_worker_active gauge",
                f"classifyre_query_worker_active {self.active}",
                "# HELP classifyre_query_worker_ready 1 when the worker takes queries.",
                "# TYPE classifyre_query_worker_ready gauge",
                f"classifyre_query_worker_ready {1 if ready else 0}",
                "# HELP classifyre_query_worker_queries_total Queries run, by outcome.",
                "# TYPE classifyre_query_worker_queries_total counter",
            ]
            for label, count in sorted(self.queries.items()):
                lines.append(f'classifyre_query_worker_queries_total{{outcome="{label}"}} {count}')
            lines += [
                "# HELP classifyre_query_worker_refused_total Requests refused before running.",
                "# TYPE classifyre_query_worker_refused_total counter",
            ]
            for reason, count in sorted(self.refused.items()):
                lines.append(f'classifyre_query_worker_refused_total{{reason="{reason}"}} {count}')
            total = sum(self.queries.values())
            lines += [
                "# HELP classifyre_query_worker_query_seconds Time from accept to answer.",
                "# TYPE classifyre_query_worker_query_seconds summary",
                f"classifyre_query_worker_query_seconds_sum {self.seconds_sum:.3f}",
                f"classifyre_query_worker_query_seconds_count {total}",
            ]
        return "\n".join(lines) + "\n"


def _client_gone(sock: socket.socket) -> bool:
    """True when the API closed its end: the person cancelled, or the API stopped."""
    try:
        return sock.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b""
    except BlockingIOError:
        return False
    except OSError:
        return True


class QueryWorker:
    def __init__(self, config: WorkerConfig) -> None:
        self.config = config
        self.stats = Stats()
        self._slots = threading.BoundedSemaphore(config.slots)
        self._draining = threading.Event()
        self._stopping = threading.Event()
        self._ready = threading.Event()
        # Any: the typeshed BaseContext has no Process/Pipe; each concrete one does.
        self._ctx: Any = multiprocessing.get_context(config.start_method)
        self.warm_timings: dict[str, float] = {}

    @property
    def ready(self) -> bool:
        return self._ready.is_set() and not self._draining.is_set()

    def start(self) -> None:
        """Bring the fork server up and wait until it has warmed up."""
        if self.config.start_method == "forkserver":
            os.environ["CLASSIFYRE_QUERY_WORKER_FORKSERVER"] = "1"
            self._ctx.set_forkserver_preload(["src.query.warm"])
        reader, writer = self._ctx.Pipe(duplex=False)
        process = self._ctx.Process(target=_ping, args=(writer,), daemon=True)
        process.start()
        writer.close()
        try:
            if reader.poll(300):
                self.warm_timings = reader.recv()
        except EOFError:
            pass
        process.join(10)
        reader.close()
        if process.exitcode != 0:
            raise RuntimeError(f"The query fork server did not start (exit {process.exitcode}).")
        self._ready.set()

    def run(
        self, request_data: dict[str, Any], client: socket.socket | None
    ) -> tuple[int, dict[str, Any]]:
        """Run one query; the HTTP status and body to answer with."""
        if self._draining.is_set():
            self.stats.refuse("draining")
            return 503, {"code": "draining", "message": "The query worker is shutting down."}
        if not self._ready.is_set():
            self.stats.refuse("starting")
            return 503, {"code": "starting", "message": "The query worker is starting."}
        if not self._slots.acquire(blocking=False):
            self.stats.refuse("busy")
            return 503, {"code": "busy", "message": "Every query slot is taken."}
        started = time.monotonic()
        self.stats.started()
        outcome = Outcome("crashed")
        try:
            outcome = self._run(request_data, client, started)
        finally:
            self._slots.release()
            seconds = time.monotonic() - started
            label = outcome.kind
            if outcome.kind == "done" and outcome.payload is not None:
                label = "success" if outcome.payload.get("status") == "success" else "error"
            self.stats.finished(label, seconds)
            logger.info(
                "query %s: %s in %d ms",
                str(request_data.get("runId") or "-")[:64],
                label,
                int(seconds * 1000),
            )
        body: dict[str, Any] = {
            "outcome": outcome.kind,
            "exitCode": outcome.exit_code,
            "payload": outcome.payload,
            "worker": self.config.node,
            "ms": int((time.monotonic() - started) * 1000),
        }
        return 200, body

    def _run(
        self, request_data: dict[str, Any], client: socket.socket | None, started: float
    ) -> Outcome:
        timeout = request_data.get("timeoutSeconds")
        seconds = (
            min(float(timeout), MAX_TIMEOUT_SECONDS)
            if isinstance(timeout, (int, float)) and timeout > 0
            else DEFAULT_TIMEOUT_SECONDS
        )
        deadline = started + seconds + BACKSTOP_SECONDS
        reader, writer = self._ctx.Pipe(duplex=False)
        process = self._ctx.Process(
            target=_query_process,
            args=(request_data, writer, self.config.query_memory_mb),
            daemon=False,
        )
        process.start()
        writer.close()
        try:
            return self._await(process, reader, client, deadline)
        finally:
            reader.close()
            if process.is_alive():
                process.kill()
            process.join(5)

    def _await(
        self,
        process: multiprocessing.process.BaseProcess,
        reader: Connection,
        client: socket.socket | None,
        deadline: float,
    ) -> Outcome:
        payload: dict[str, Any] | None = None
        watch: list[Any] = [reader, process.sentinel]
        if client is not None:
            watch.append(client)
        while True:
            if self._stopping.is_set():
                process.kill()
                return Outcome("stopped")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                return Outcome("timeout")
            for item in wait(watch, timeout=min(remaining, 1.0)):
                if item is reader:
                    try:
                        payload = reader.recv()
                    except (EOFError, OSError):
                        pass
                    watch.remove(reader)
                elif item is client:
                    if _client_gone(client):
                        process.kill()
                        return Outcome("cancelled")
                    watch.remove(client)  # unexpected bytes: stop watching, keep running
                else:
                    process.join(5)
                    if payload is None:
                        try:
                            if reader.poll(0):
                                payload = reader.recv()
                        except (EOFError, OSError):
                            pass
                    if payload is None:
                        return Outcome("crashed", exit_code=process.exitcode)
                    code = 0 if payload.get("status") == "success" else 1
                    return Outcome("done", payload, code)

    def drain(self) -> None:
        """Stop taking queries, let running ones finish, then stop the rest."""
        self._draining.set()
        deadline = time.monotonic() + self.config.drain_seconds
        while self.stats.active > 0 and time.monotonic() < deadline:
            time.sleep(0.2)
        if self.stats.active > 0:
            logger.warning("Drain deadline passed; stopping %d queries", self.stats.active)
            self._stopping.set()
            stop_by = time.monotonic() + 10
            while self.stats.active > 0 and time.monotonic() < stop_by:
                time.sleep(0.1)


# ── HTTP ───────────────────────────────────────────────────────────────


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 512
    worker: QueryWorker


class _Handler(http.server.BaseHTTPRequestHandler):
    server: _Server
    protocol_version = "HTTP/1.1"
    server_version = "classifyre-query-worker"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        logger.debug("%s %s", self.address_string(), format % args)

    def _send(
        self, status: int, body: dict[str, Any] | str, content_type: str = "application/json"
    ) -> None:
        data = (json.dumps(body) if isinstance(body, dict) else body).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except OSError:
            pass  # the API went away (a cancel); nothing left to tell it

    def do_GET(self) -> None:
        worker = self.server.worker
        if self.path == "/healthz":
            self._send(200, {"status": "ok"})
        elif self.path == "/readyz":
            ready = worker.ready
            self._send(200 if ready else 503, {"ready": ready, "active": worker.stats.active})
        elif self.path == "/metrics":
            text = worker.stats.prometheus(worker.config.slots, worker.ready)
            self._send(200, text, "text/plain; version=0.0.4")
        else:
            self._send(404, {"code": "not_found"})

    def do_POST(self) -> None:
        worker = self.server.worker
        if self.path != QUERY_PATH:
            self._send(404, {"code": "not_found"})
            return
        header = self.headers.get("Authorization", "")
        expected = f"Bearer {worker.config.token}"
        if not hmac.compare_digest(header.encode("utf-8"), expected.encode("utf-8")):
            self._send(401, {"code": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send(411, {"code": "length_required"})
            return
        if length <= 0 or length > worker.config.max_body_bytes:
            self._send(413, {"code": "too_large"})
            return
        try:
            request_data = json.loads(self.rfile.read(length))
        except (ValueError, OSError):
            self._send(400, {"code": "invalid_request"})
            return
        if not isinstance(request_data, dict):
            self._send(400, {"code": "invalid_request"})
            return
        status, body = worker.run(request_data, self.connection)
        self._send(status, body)


def apply_engine_budget(
    config: WorkerConfig, environ: MutableMapping[str, str] | None = None
) -> None:
    """Size DuckDB per query from the container, unless set explicitly."""
    env = os.environ if environ is None else environ
    memory, threads = engine_budget(
        config.slots, get_effective_memory_mb(), get_effective_cpu_count()
    )
    env.setdefault("CLASSIFYRE_QUERY_MEMORY_LIMIT", memory)
    env.setdefault("CLASSIFYRE_QUERY_THREADS", str(threads))


def serve(config: WorkerConfig) -> int:
    removed = scrub_environment(os.environ)
    if removed:
        logger.info("Query worker: %d environment variables withheld from queries", len(removed))
    apply_engine_budget(config)
    worker = QueryWorker(config)
    server = _Server((config.host, config.port), _Handler)
    server.worker = worker

    def on_signal(signum: int, _frame: object) -> None:
        if worker._draining.is_set():
            return
        logger.info("Signal %d: draining (up to %d s)", signum, config.drain_seconds)

        def stop() -> None:
            worker.drain()
            server.shutdown()

        threading.Thread(target=stop, name="drain", daemon=True).start()

    # PID 1 in a container ignores signals it has no handler for.
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    started = time.monotonic()
    # Listen first, so /healthz answers while the fork server warms up.
    serving = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    serving.start()
    try:
        worker.start()
    except Exception as exc:
        logger.error("Query worker could not start: %s", exc)
        server.shutdown()
        return 1
    logger.info(
        "Query worker ready on %s:%d: %d slots, %s, DuckDB %s / %s threads per query, "
        "warm-up %s, %.1f s",
        config.host,
        config.port,
        config.slots,
        config.start_method,
        os.environ.get("CLASSIFYRE_QUERY_MEMORY_LIMIT"),
        os.environ.get("CLASSIFYRE_QUERY_THREADS"),
        json.dumps(worker.warm_timings),
        time.monotonic() - started,
    )
    while serving.is_alive():
        serving.join(1.0)  # wake for signals
    server.server_close()
    logger.info("Query worker stopped")
    return 0


def run_worker_command() -> int:
    try:
        config = WorkerConfig.from_env()
    except (WorkerConfigError, OSError) as exc:
        logger.error("%s", exc)
        return 2
    return serve(config)
