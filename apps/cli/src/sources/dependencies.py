"""Helpers for optional source dependencies."""

from __future__ import annotations

import importlib
import logging
import os
import shutil
import subprocess
import sys
import threading
from types import ModuleType

logger = logging.getLogger(__name__)
_install_lock = threading.Lock()
_installed_groups: set[str] = set()
_failed_groups: dict[str, str] = {}


class MissingSourceDependencyError(RuntimeError):
    """Raised when an optional source dependency is unavailable."""

    def __init__(
        self,
        source_name: str,
        dependencies: list[str],
        uv_groups: list[str],
        detail: str | None = None,
    ) -> None:
        self.source_name = source_name
        self.dependencies = dependencies
        self.uv_groups = uv_groups
        self.detail = detail

        deps = ", ".join(dependencies)
        group_hint = " or ".join(f"`uv sync --group {group}`" for group in uv_groups)
        message = (
            f"{source_name} source requires optional dependencies ({deps}). "
            f"Install with {group_hint}."
        )
        if detail:
            message = f"{message} {detail}"
        super().__init__(message)


def _auto_install_enabled() -> bool:
    value = os.environ.get("CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS", "1").strip().lower()
    return value not in {"0", "false", "no"}


def _ordered_groups(groups: list[str]) -> list[str]:
    return sorted(dict.fromkeys(groups))


def _uv_command() -> list[str]:
    uv_binary = shutil.which("uv")
    if uv_binary:
        return [uv_binary]
    return [sys.executable, "-m", "uv"]


def _install_uv_group(group: str) -> tuple[bool, str | None]:
    if group in _installed_groups:
        return True, None
    if group in _failed_groups:
        return False, _failed_groups[group]

    timeout = int(os.environ.get("CLASSIFYRE_UV_SYNC_TIMEOUT_SECONDS", "900"))
    command = [*_uv_command(), "sync", "--frozen", "--no-dev", "--group", group]

    logger.info("Installing optional source dependency group '%s'...", group)
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception as exc:  # pragma: no cover
        detail = f"Failed to execute uv sync for group '{group}': {exc}"
        _failed_groups[group] = detail
        logger.error(detail)
        return False, detail

    if result.returncode == 0:
        _installed_groups.add(group)
        logger.info("Installed dependency group '%s'", group)
        return True, None

    detail = result.stderr.strip() or result.stdout.strip() or "Unknown uv sync error"
    message = f"uv sync failed for group '{group}': {detail}"
    _failed_groups[group] = message
    logger.error(message)
    return False, message


def require_module(
    module_name: str,
    source_name: str,
    uv_groups: list[str],
    detail: str | None = None,
) -> ModuleType:
    """Import a module or raise MissingSourceDependencyError with uv guidance."""
    try:
        return importlib.import_module(module_name)
    except Exception as exc:  # pragma: no cover - environment dependent
        detail_messages: list[str] = [f"Original error: {exc}"]

        if _auto_install_enabled() and uv_groups:
            with _install_lock:
                for group in _ordered_groups(uv_groups):
                    success, install_detail = _install_uv_group(group)
                    if install_detail:
                        detail_messages.append(install_detail)
                    if not success:
                        continue

                    try:
                        importlib.invalidate_caches()
                        return importlib.import_module(module_name)
                    except Exception as retry_exc:  # pragma: no cover
                        detail_messages.append(
                            f"Module '{module_name}' still unavailable after installing '{group}': {retry_exc}"
                        )

        base_detail = detail or "Optional dependency import failed"
        error_detail = (
            f"{base_detail}. {'; '.join(detail_messages)}" if detail_messages else base_detail
        )
        raise MissingSourceDependencyError(
            source_name=source_name,
            dependencies=[module_name.split(".", maxsplit=1)[0]],
            uv_groups=uv_groups,
            detail=error_detail,
        ) from exc
