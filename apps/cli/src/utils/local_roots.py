"""Which local folders a source may point at (review of 383fd5c4, P15; re-review 2026-11-22).

A workspace admin sets a local folder's path. Read by a query on a worker
other workspaces share, or by a scan in the all-in-one image, a path such
as ``/`` or ``/var/lib/classifyre`` would expose other queries' private
directories, or the key that decrypts every workspace's source credentials.

* With ``CLASSIFYRE_QUERY_LOCAL_ROOTS`` set (even empty) it is an allowlist:
  the folder must lie inside one of its roots. The chart sets it from
  ``api.localFolders``; the all-in-one image to ``/data``.
* Whatever the allowlist, a folder is refused that is or contains the
  temporary area, lies in a query's private directory, or touches the
  system's or the image's own state and code.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

#: Separated by ``os.pathsep`` or commas.
LOCAL_ROOTS_ENV = "CLASSIFYRE_QUERY_LOCAL_ROOTS"

#: Never a source's folder, nor contained in one: other queries' private and
#: spill directories live under these.
_CONTAINS_NOT = ("/tmp", "/var/tmp", "/dev/shm")
#: Never a source's folder, inside one or containing one: the process's view
#: of the machine, and the image's state (masked-config.key, iam.secrets, the
#: SQL TLS keys, the database) and code.
_INSIDE_NOT = (
    "/proc",
    "/sys",
    "/dev",
    "/etc",
    "/run",
    "/var/run",
    "/root",
    "/var/lib/classifyre",
    "/var/lib/postgresql",
    "/app",
    "/opt",
    "/cache",
)
#: Directory names of query workspaces (worker.QUERY_DIRS, the spill prefix).
_PRIVATE_NAMES = ("classifyre-queries", "classifyre-query-")


class LocalRootRefusedError(ValueError):
    """A local folder that may not be read; the message says why."""


def _real(path: str) -> Path:
    return Path(os.path.realpath(path))


def _within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def allowed_roots() -> list[str] | None:
    """The allowlist, or None when it is not set."""
    if LOCAL_ROOTS_ENV not in os.environ:
        return None
    raw = os.environ.get(LOCAL_ROOTS_ENV, "")
    return [p.strip() for p in raw.replace(",", os.pathsep).split(os.pathsep) if p.strip()]


def refuse_local_root(path: str, reader: str = "queries") -> None:
    """Raise :class:`LocalRootRefusedError` when ``path`` may not be read."""
    real = _real(path)
    refused = f"The folder {path} may not be read by {reader}"
    temp_roots = {_real(p) for p in (*_CONTAINS_NOT, tempfile.gettempdir())}
    if any(_within(root, real) for root in temp_roots):
        raise LocalRootRefusedError(f"{refused}: it holds temporary files of other work.")
    if any(_within(real, _real(p)) or _within(_real(p), real) for p in _INSIDE_NOT):
        raise LocalRootRefusedError(f"{refused}: it is part of the system or of Classifyre.")
    if any(part.startswith(_PRIVATE_NAMES) for part in real.parts):
        raise LocalRootRefusedError(f"{refused}: it is a query's private directory.")
    allowed = allowed_roots()
    if allowed is not None and not any(_within(real, _real(root)) for root in allowed):
        raise LocalRootRefusedError(
            f"{refused}: it is not under a folder mounted for data "
            f"({LOCAL_ROOTS_ENV}: the chart's api.localFolders, /data in the all-in-one image)."
        )
