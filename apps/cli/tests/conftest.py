from __future__ import annotations

import os

import pytest


def _env_flag(name: str) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:  # noqa: ARG001
    run_integration = _env_flag("RUN_INTEGRATION_TESTS")
    run_e2e = _env_flag("RUN_E2E_TESTS")

    for item in items:
        if "integration" in item.keywords and not run_integration:
            item.add_marker(pytest.mark.skip(reason="Integration tests disabled"))
        if "e2e" in item.keywords and not run_e2e:
            item.add_marker(pytest.mark.skip(reason="E2E tests disabled"))
