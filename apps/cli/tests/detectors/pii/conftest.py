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

_pdfplumber_available = False
try:
    importlib.import_module("pdfplumber")
    _pdfplumber_available = True
except Exception:
    pass

requires_pdfplumber = pytest.mark.skipif(
    not _pdfplumber_available,
    reason="pdfplumber not available in this environment (install file-processing group)",
)
