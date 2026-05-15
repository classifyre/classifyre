"""Helpers for optional source dependencies."""

from __future__ import annotations

import importlib
import logging
from types import ModuleType

from src.utils.uv_sync import auto_install_enabled, sync_group

logger = logging.getLogger(__name__)


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


def _ordered_groups(groups: list[str]) -> list[str]:
    return sorted(dict.fromkeys(groups))


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

        if auto_install_enabled() and uv_groups:
            for group in _ordered_groups(uv_groups):
                success, install_detail = sync_group(group)
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
