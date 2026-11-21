"""What the query worker's fork server holds before it forks a query.

Imported once, by the fork server of ``python -m src.main query-worker``
(:mod:`.worker`, ``multiprocessing.set_forkserver_preload``). Every query
process is a ``fork()`` of that server, so it starts with all of this already
in memory instead of paying for it per query the way a query Job does:

* DuckDB, pyarrow and SQLGlot, and this package;
* every source module (``get_source`` imports the whole connector catalog on
  first use, which is most of a cold query's setup);
* the DuckDB extensions queries load, read once so their files are in the page
  cache. Each query still loads them into its own database (DuckDB verifies
  each file per database: about 0.5 s for delta and iceberg together).

The fork server must stay single-threaded: a thread holding a lock at
``fork()`` leaves that lock held forever in the child. DuckDB starts a thread
pool per database, so the warm-up database is closed, and so is the module's
default connection.

Nothing here may raise: the fork server imports this module with only
``ImportError`` caught, and any other error would stop it. A failed step is
logged and the query that needs it pays for it as a Job would.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger("classifyre.query.warm")

#: Extensions loaded during warm-up; ``CLASSIFYRE_QUERY_WORKER_EXTENSIONS``
#: (comma-separated, empty for none) overrides the list.
DEFAULT_EXTENSIONS = (
    "httpfs",
    "azure",
    "delta",
    "iceberg",
    "ducklake",
    "postgres",
    "mysql",
)
EXTENSIONS_ENV = "CLASSIFYRE_QUERY_WORKER_EXTENSIONS"

#: Seconds each step took, for the worker's ready line and metrics.
timings: dict[str, float] = {}


def _step(name: str) -> _Timer:
    return _Timer(name)


class _Timer:
    def __init__(self, name: str) -> None:
        self.name = name
        self.started = 0.0

    def __enter__(self) -> _Timer:
        self.started = time.monotonic()
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        timings[self.name] = round(time.monotonic() - self.started, 3)
        if exc is not None:
            logger.warning("Query worker warm-up step %s failed: %s", self.name, exc)
        return True  # never let a warm-up step stop the fork server


def _extensions() -> list[str]:
    raw = os.environ.get(EXTENSIONS_ENV)
    if raw is None:
        return list(DEFAULT_EXTENSIONS)
    return [name.strip() for name in raw.split(",") if name.strip()]


#: Threads that are safe across fork(): jemalloc (DuckDB's allocator) stops
#: and restarts its background purge thread in its own pthread_atfork hooks.
FORK_SAFE_THREADS = frozenset({"jemalloc_bg_thd"})


def _other_threads() -> list[str]:
    """Names of this process's threads other than the calling one and the
    fork-safe ones (Linux reads native threads too; elsewhere Python's)."""
    try:
        names = [(task / "comm").read_text().strip() for task in Path("/proc/self/task").iterdir()]
    except OSError:
        return [t.name for t in threading.enumerate() if t is not threading.current_thread()]
    others = [n for n in names if n not in FORK_SAFE_THREADS]
    return others[1:]  # one of them is this thread


def warm_up() -> dict[str, float]:
    """Run every warm-up step once; return how long each took."""
    if timings:
        return timings
    with _step("dependencies"):
        from .runner import ensure_dependencies

        ensure_dependencies()
    with _step("imports"):
        import pyarrow
        import pyarrow.ipc  # noqa: F401
        import sqlglot  # noqa: F401

        from . import bindings, describe, gate, masks, rows, session  # noqa: F401
    with _step("sources"):
        from ..sources import _discover_sources

        _discover_sources()
    with _step("extensions"):
        from ..utils.duckdb_engine import connect, load_extension, require_duckdb

        # Loaded once to put the files in the page cache and map the libraries;
        # then closed. A database cannot be kept open for the query processes
        # to inherit: DuckDB 2.0 starts some 48 background threads per database
        # even at threads = 1, and they end only when it is closed.
        conn = connect(require_duckdb(), config={"threads": 1})
        try:
            for name in _extensions():
                try:
                    load_extension(conn, name)
                except Exception as exc:
                    logger.warning("Query worker: extension %s not preloaded: %s", name, exc)
        finally:
            conn.close()
    with _step("single_thread"):
        import duckdb as _duckdb

        try:
            _duckdb.default_connection().close()
        except Exception:  # older DuckDB: no default connection to close
            pass
        others = _other_threads()
        if others:
            logger.warning(
                "Query worker fork server has other threads before forking (%s); "
                "a query process could inherit a lock one of them holds",
                ", ".join(others),
            )
        timings["other_threads"] = float(len(others))
    return timings


if os.environ.get("CLASSIFYRE_QUERY_WORKER_FORKSERVER") == "1":
    # Imported by the fork server (set_forkserver_preload): log like the CLI
    # and warm up. Imported anywhere else (tests, mypy), do nothing.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    warm_up()
