"""PII detector test configuration and shared fixtures."""

import importlib

import pytest

_presidio_available = False
try:
    importlib.import_module("presidio_analyzer")
    _presidio_available = True
except Exception:
    pass

requires_presidio = pytest.mark.skipif(
    not _presidio_available,
    reason="presidio_analyzer not available in this environment",
)
