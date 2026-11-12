"""The embedded DuckDB the CLI reads table-shaped files and lakehouse tables with.

DuckDB is a query engine, not a connector library: it is used here for what it is
good at — reading files that are tables (CSV/TSV, JSON lines, Avro, SQLite and
DuckDB database files) and lakehouse tables (Delta, Iceberg) — and for nothing
else. Documents, images and media keep their own parsers.

Two things every caller needs are kept in one place:

* **Extensions.** ``excel``-style readers, ``avro``, ``sqlite``, ``delta``,
  ``iceberg`` and ``httpfs`` are extensions DuckDB downloads on first ``INSTALL``.
  Scan pods already install their optional Python groups at run time into the
  persisted ``UV_CACHE_DIR`` volume, so extensions go next to them
  (``$UV_CACHE_DIR/duckdb-extensions``) and are downloaded once per volume, not
  once per scan. ``CLASSIFYRE_DUCKDB_EXTENSION_DIR`` overrides the location and
  ``CLASSIFYRE_DUCKDB_EXTENSION_REPOSITORY`` points at a mirror for clusters
  without internet access.
* **Paths.** DuckDB reads part of a file only when it is given a path or URL.
  Handed a Python file object it reads the object end to end, so payloads are
  materialized to a temporary file first (see :func:`materialized_path`).
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .payload import BinarySource, as_binary_io, is_bytes

logger = logging.getLogger(__name__)

EXTENSION_DIR_ENV = "CLASSIFYRE_DUCKDB_EXTENSION_DIR"
#: Extensions the CLI image ships with (Dockerfile, cli-builder), read-only.
BAKED_EXTENSION_DIR_ENV = "CLASSIFYRE_DUCKDB_BAKED_EXTENSION_DIR"
EXTENSION_REPOSITORY_ENV = "CLASSIFYRE_DUCKDB_EXTENSION_REPOSITORY"

_COPY_CHUNK_BYTES = 1024 * 1024

# INSTALL writes into the shared extension directory; two threads installing the
# same extension at once race on the same file.
_install_lock = threading.Lock()
_installed: set[str] = set()


class DuckDBExtensionUnavailableError(RuntimeError):
    """A DuckDB extension could neither be loaded nor installed.

    The message carries "unavailable" on purpose: ``iter_file_pages`` maps that
    word to ``ENGINE_UNAVAILABLE`` coverage, which tells the operator the file was
    fine and the engine was missing, rather than that the file failed to parse.
    """


def require_duckdb() -> Any:
    """Import duckdb from the file-processing group (installed on demand)."""
    from ..detectors.dependencies import require_module

    return require_module("duckdb", "file parser", ["file-processing"])


def extension_directory() -> str | None:
    """Where extensions are installed, or None for DuckDB's own default."""
    explicit = os.environ.get(EXTENSION_DIR_ENV, "").strip()
    if explicit:
        return explicit
    uv_cache = os.environ.get("UV_CACHE_DIR", "").strip()
    if uv_cache:
        return str(Path(uv_cache) / "duckdb-extensions")
    return None


def connect(duckdb_module: Any | None = None) -> Any:
    """A fresh in-memory DuckDB connection with the extension settings applied.

    Fresh rather than shared: an ``ATTACH`` is visible to every cursor of a
    database, and a payload's temporary file should not outlive its read.
    Opening one costs about a millisecond.
    """
    duckdb = duckdb_module or require_duckdb()
    conn = duckdb.connect()
    directory = extension_directory()
    if directory:
        try:
            Path(directory).mkdir(parents=True, exist_ok=True)
            conn.execute(f"SET extension_directory = {sql_literal(directory)}")
        except Exception as exc:
            logger.debug("DuckDB extension directory %s unusable: %s", directory, exc)
    repository = os.environ.get(EXTENSION_REPOSITORY_ENV, "").strip()
    if repository:
        conn.execute(f"SET custom_extension_repository = {sql_literal(repository)}")
    return conn


#: Community extensions (DuckDB's community repository, not its core one).
COMMUNITY_EXTENSIONS = frozenset({"paimon", "hudi"})
COMMUNITY_REPOSITORY_ENV = "CLASSIFYRE_DUCKDB_COMMUNITY_REPOSITORY"


#: Extensions DuckDB publishes only from its nightly repository, under the name
#: INSTALL takes (``odbc``) when LOAD takes another (``odbc_scanner``). The ODBC
#: scanner's binary is built on the stable C API and runs on any DuckDB >= 1.2.
NIGHTLY_EXTENSIONS = {"odbc_scanner": "odbc"}
NIGHTLY_REPOSITORY_ENV = "CLASSIFYRE_DUCKDB_NIGHTLY_REPOSITORY"


#: Extensions whose file is named differently from what LOAD takes.
_EXTENSION_FILES = {
    "postgres": "postgres_scanner",
    "mysql": "mysql_scanner",
    "sqlite": "sqlite_scanner",
}


def baked_extension_path(conn: Any, name: str) -> str | None:
    """The image's own copy of an extension for this DuckDB, if it has one.

    Laid out as INSTALL lays it out: ``<dir>/<version>/<platform>/<name>.duckdb_extension``.
    """
    root = os.environ.get(BAKED_EXTENSION_DIR_ENV, "").strip()
    if not root:
        return None
    try:
        version = conn.execute("SELECT version()").fetchone()[0]
        platform = conn.execute("PRAGMA platform").fetchone()[0]
    except Exception:
        return None
    folder = Path(root) / str(version) / str(platform)
    for file_name in (name, _EXTENSION_FILES.get(name, name)):
        path = folder / f"{file_name}.duckdb_extension"
        if path.is_file():
            return str(path)
    return None


def load_extension(conn: Any, name: str) -> None:
    """Load ``name`` into ``conn``, installing it first when it is not on disk.

    The image's own copy comes first (no download, no shared volume needed),
    then the extension directory, then an INSTALL. Community extensions install
    from DuckDB's community repository, or from
    ``CLASSIFYRE_DUCKDB_COMMUNITY_REPOSITORY`` where a mirror stands in for it;
    the nightly ones (``odbc_scanner``) from ``core_nightly`` or
    ``CLASSIFYRE_DUCKDB_NIGHTLY_REPOSITORY``.
    """
    try:
        conn.execute(f"LOAD {name}")
        return
    except Exception as first_error:
        load_error: Exception = first_error
    baked = baked_extension_path(conn, name)
    if baked:
        try:
            conn.execute(f"LOAD {sql_literal(baked)}")
            return
        except Exception as exc:
            logger.debug("Baked DuckDB extension %s did not load: %s", baked, exc)
    with _install_lock:
        try:
            if name not in _installed:
                if name in NIGHTLY_EXTENSIONS:
                    mirror = os.environ.get(NIGHTLY_REPOSITORY_ENV, "").strip()
                    repository = sql_literal(mirror) if mirror else "core_nightly"
                    conn.execute(f"INSTALL {NIGHTLY_EXTENSIONS[name]} FROM {repository}")
                elif name in COMMUNITY_EXTENSIONS:
                    mirror = os.environ.get(COMMUNITY_REPOSITORY_ENV, "").strip()
                    repository = sql_literal(mirror) if mirror else "community"
                    conn.execute(f"INSTALL {name} FROM {repository}")
                else:
                    conn.execute(f"INSTALL {name}")
                _installed.add(name)
            conn.execute(f"LOAD {name}")
            return
        except Exception as exc:
            load_error = exc
    raise DuckDBExtensionUnavailableError(
        f"DuckDB extension '{name}' unavailable: {load_error}. Set "
        f"{EXTENSION_REPOSITORY_ENV} to a reachable extension mirror, or pre-install "
        f"it into {extension_directory() or '~/.duckdb/extensions'}."
    ) from load_error


def sql_literal(value: str) -> str:
    """A single-quoted SQL string literal."""
    return "'" + value.replace("'", "''") + "'"


def quote_identifier(identifier: str) -> str:
    """A double-quoted SQL identifier."""
    return '"' + identifier.replace('"', '""') + '"'


def _existing_path(source: BinarySource) -> str | None:
    """The on-disk path behind a plain file handle, when there is one.

    Only an ordinary opened file qualifies (a local-folder scan hands those over).
    A rolled-over ``SpooledTemporaryFile`` has no usable name on Linux, and a
    range reader has no file at all; both are copied.
    """
    if is_bytes(source):
        return None
    name = getattr(source, "name", None)
    if isinstance(name, str) and name and Path(name).is_file():
        mode = str(getattr(source, "mode", "rb"))
        if "w" not in mode and "a" not in mode and "+" not in mode:
            return name
    return None


@contextmanager
def materialized_path(
    source: BinarySource,
    *,
    suffix: str = "",
    transcode_from: str | None = None,
) -> Iterator[str]:
    """A filesystem path holding ``source``'s bytes, removed afterwards.

    ``transcode_from`` names a text encoding to re-encode as UTF-8 while copying,
    which is how CSV and JSON lines in any encoding chardet recognises reach
    DuckDB without its 100 MB ``encodings`` extension.
    """
    if transcode_from is None:
        existing = _existing_path(source)
        if existing is not None:
            yield existing
            return

    handle = tempfile.NamedTemporaryFile(prefix="classifyre-duck-", suffix=suffix, delete=False)
    path = handle.name
    try:
        with handle:
            if is_bytes(source) and transcode_from is None:
                handle.write(bytes(source))
            else:
                reader = as_binary_io(source)
                if transcode_from is None:
                    shutil.copyfileobj(reader, handle, _COPY_CHUNK_BYTES)
                else:
                    _transcode(reader, handle, transcode_from)
        yield path
    finally:
        Path(path).unlink(missing_ok=True)


def _transcode(reader: Any, writer: Any, encoding: str) -> None:
    import codecs

    decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
    while True:
        chunk = reader.read(_COPY_CHUNK_BYTES)
        if not chunk:
            writer.write(decoder.decode(b"", final=True).encode("utf-8"))
            return
        writer.write(decoder.decode(chunk).encode("utf-8"))
