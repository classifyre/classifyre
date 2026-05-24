"""PII detector test configuration and shared fixtures."""

from importlib.util import find_spec

import pytest

_presidio_available = find_spec("presidio_analyzer") is not None

requires_presidio = pytest.mark.skipif(
    not _presidio_available,
    reason="presidio_analyzer not available in this environment",
)

_pdfplumber_available = find_spec("pdfplumber") is not None

requires_pdfplumber = pytest.mark.skipif(
    not _pdfplumber_available,
    reason="pdfplumber not available in this environment (install file-processing group)",
)
