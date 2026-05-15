"""Shared uv-sync state so that every `uv sync` call includes ALL accumulated groups.

`uv sync --group X` removes packages that belong to other groups.  When sources
and detectors each call `uv sync --group <their_group>` independently, the last
call uninstalls packages from earlier groups.  This module keeps a global set of
requested groups and always passes them all to `uv sync`.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_synced_groups: set[str] = set()
_failed_groups: dict[str, str] = {}


def _auto_install_enabled() -> bool:
    value = os.environ.get("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "1").strip().lower()
    return value not in {"0", "false", "no"}


def _uv_command() -> list[str]:
    uv_binary = shutil.which("uv")
    if uv_binary:
        return [uv_binary]
    return [sys.executable, "-m", "uv"]


def sync_group(group: str) -> tuple[bool, str | None]:
    """Ensure *group* is installed, re-syncing with ALL previously requested groups."""
    with _lock:
        if group in _synced_groups:
            return True, None
        if group in _failed_groups:
            return False, _failed_groups[group]

        all_groups = _synced_groups | {group}
        timeout = int(os.environ.get("CLASSIFYRE_UV_SYNC_TIMEOUT_SECONDS", "900"))
        command = [*_uv_command(), "sync", "--frozen", "--no-dev"]
        for g in sorted(all_groups):
            command.extend(["--group", g])

        logger.info("Installing optional dependency group '%s'...", group)
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
            _failed_groups[group] = detail
            logger.error(detail)
            return False, detail

        if result.returncode == 0:
            _synced_groups.update(all_groups)
            logger.info("Installed dependency group '%s'", group)
            return True, None

        detail = result.stderr.strip() or result.stdout.strip() or "Unknown uv sync error"
        message = f"uv sync failed for group '{group}': {detail}"
        _failed_groups[group] = message
        logger.error(message)
        return False, message


def auto_install_enabled() -> bool:
    return _auto_install_enabled()
