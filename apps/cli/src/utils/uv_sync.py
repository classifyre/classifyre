"""Safe, shared `uv sync` for runtime-installed optional dependency groups.

Optional detector/source dependencies are installed on demand at runtime so the
base CLI image stays slim. Several processes can request installs against the
*same* virtualenv at once — the detector pool spawns many worker processes, and
each lazily imports its detector. Two failure modes follow from that:

1. ``uv sync --group X`` removes packages that belong to groups not passed in the
   same call, so independent per-group syncs uninstall each other's packages.
2. Two concurrent ``uv sync`` runs (or one killed mid-write by an OOM / timeout /
   pod stop) can leave a package half-written — e.g. ``numpy`` present on disk but
   missing its ``__init__.py`` — which then crashes every importer.

This module makes runtime installs safe:

* **Cross-process file lock** — only one ``uv sync`` touches the venv at a time.
* **Cross-process group accumulation** — the set of installed groups is persisted
  next to the venv and every sync re-passes the full union, so groups never
  uninstall each other across processes.
* **Self-heal** — an "in progress" marker is written before each sync and removed
  on success; finding a leftover marker means a previous sync was interrupted, so
  the next sync runs with ``--reinstall`` to repair any partial install.

The in-process fast path (``_synced_groups``) still short-circuits repeat calls
within a single process without taking the file lock.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Iterable
from pathlib import Path

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_synced_groups: set[str] = set()
_failed_groups: dict[str, str] = {}

_LOCK_FILENAME = ".classifyre-uv-sync.lock"
_STATE_FILENAME = ".classifyre-uv-sync-groups.json"
_INPROGRESS_FILENAME = ".classifyre-uv-sync.inprogress"


def _auto_install_enabled() -> bool:
    value = os.environ.get("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "1").strip().lower()
    return value not in {"0", "false", "no"}


def _uv_command() -> list[str]:
    uv_binary = shutil.which("uv")
    if uv_binary:
        return [uv_binary]
    return [sys.executable, "-m", "uv"]


def _state_dir() -> Path:
    """Directory for the lock + state files: the active venv (per-pod in K8s)."""
    override = os.environ.get("CLASSIFYRE_UV_SYNC_STATE_DIR")
    if override:
        return Path(override)
    return Path(sys.prefix)


def _read_persisted_groups() -> set[str]:
    try:
        path = _state_dir() / _STATE_FILENAME
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return {str(g) for g in data}
    except Exception as exc:  # never fail a sync on a malformed/missing state file
        logger.debug("Could not read persisted uv-sync groups: %s", exc)
    return set()


def _write_persisted_groups(groups: set[str]) -> None:
    try:
        path = _state_dir() / _STATE_FILENAME
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(sorted(groups)), encoding="utf-8")
        tmp.replace(path)  # atomic on POSIX
    except Exception as exc:
        logger.debug("Could not persist uv-sync groups: %s", exc)


class _FileLock:
    """Best-effort advisory inter-process lock (POSIX ``flock``).

    Released automatically if the holding process dies, so a killed ``uv sync``
    never deadlocks the next one. Falls back to a no-op if ``fcntl`` is missing
    (non-POSIX) — correctness then relies on the rest of the safeguards.
    """

    def __init__(self, path: Path, timeout: float) -> None:
        self._path = path
        self._timeout = timeout
        self._fd: int | None = None

    def __enter__(self) -> _FileLock:
        try:
            import fcntl
        except ImportError:
            return self  # non-POSIX: skip locking

        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(str(self._path), os.O_CREAT | os.O_RDWR, 0o644)
        deadline = time.monotonic() + self._timeout
        while True:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
                if time.monotonic() >= deadline:
                    os.close(self._fd)
                    self._fd = None
                    raise TimeoutError(
                        f"Timed out after {self._timeout}s waiting for uv sync lock at {self._path}"
                    ) from exc
                time.sleep(0.5)

    def __exit__(self, *_exc: object) -> None:
        if self._fd is None:
            return
        try:
            import fcntl

            fcntl.flock(self._fd, fcntl.LOCK_UN)
        except Exception:
            pass
        finally:
            os.close(self._fd)
            self._fd = None


def sync_group(group: str) -> tuple[bool, str | None]:
    """Ensure *group* is installed, re-syncing with ALL accumulated groups.

    Safe to call concurrently from multiple processes against one venv.
    Returns ``(success, detail_or_None)``.
    """
    with _lock:
        if group in _synced_groups:
            return True, None
        if group in _failed_groups:
            return False, _failed_groups[group]

    timeout = int(os.environ.get("CLASSIFYRE_UV_SYNC_TIMEOUT_SECONDS", "900"))
    state_dir = _state_dir()
    lock_path = state_dir / _LOCK_FILENAME
    inprogress_path = state_dir / _INPROGRESS_FILENAME

    try:
        with _FileLock(lock_path, timeout=timeout):
            persisted = _read_persisted_groups()
            # A leftover marker means a previous sync was interrupted mid-write
            # (partial install) — repair by reinstalling.
            repair = inprogress_path.exists()

            # Another process may have already installed this group.
            if group in persisted and not repair:
                with _lock:
                    _synced_groups.update(persisted | {group})
                return True, None

            all_groups = persisted | _synced_groups | {group}
            command = [*_uv_command(), "sync", "--frozen", "--no-dev"]
            if repair:
                command.append("--reinstall")
            for g in sorted(all_groups):
                command.extend(["--group", g])

            try:
                inprogress_path.write_text(group, encoding="utf-8")
            except Exception as exc:
                logger.debug("Could not write uv-sync in-progress marker: %s", exc)

            logger.info(
                "Installing optional dependency group '%s'%s...",
                group,
                " (repairing interrupted install)" if repair else "",
            )
            try:
                result = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
            except Exception as exc:
                detail = f"Failed to execute uv sync for group '{group}': {exc}"
                with _lock:
                    _failed_groups[group] = detail
                logger.error(detail)
                return False, detail

            if result.returncode == 0:
                _write_persisted_groups(all_groups)
                try:
                    inprogress_path.unlink()
                except FileNotFoundError:
                    pass
                with _lock:
                    _synced_groups.update(all_groups)
                logger.info("Installed dependency group '%s'", group)
                return True, None

            detail = result.stderr.strip() or result.stdout.strip() or "Unknown uv sync error"
            message = f"uv sync failed for group '{group}': {detail}"
            with _lock:
                _failed_groups[group] = message
            logger.error(message)
            return False, message
    except TimeoutError as exc:
        detail = str(exc)
        with _lock:
            _failed_groups[group] = detail
        logger.error(detail)
        return False, detail


def warm_groups(groups: Iterable[str]) -> tuple[bool, str | None]:
    """Install *groups* once, up front.

    Called by the parent CLI process before the detector worker pool spawns, so
    the pool's worker processes find dependencies already present instead of each
    racing on its own ``uv sync``. Best-effort: failures are returned but the
    per-worker ``require_module`` path (lock-protected) remains the safety net.
    """
    ordered = sorted({g for g in groups if g})
    if not ordered:
        return True, None
    if not _auto_install_enabled():
        return True, None

    last_detail: str | None = None
    ok = True
    for group in ordered:
        success, detail = sync_group(group)
        if not success:
            ok = False
            if detail:
                last_detail = detail
    return ok, last_detail


def auto_install_enabled() -> bool:
    return _auto_install_enabled()
