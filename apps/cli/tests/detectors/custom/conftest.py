"""Shared fixtures and skip markers for custom detector tests."""

from __future__ import annotations

from importlib.util import find_spec

import pytest

_gliner2_available = find_spec("gliner2") is not None

requires_gliner2 = pytest.mark.skipif(
    not _gliner2_available,
    reason="gliner2 not installed (install custom/detectors group)",
)

_pdfplumber_available = find_spec("pdfplumber") is not None

requires_pdfplumber = pytest.mark.skipif(
    not _pdfplumber_available,
    reason="pdfplumber not available (install file-processing group)",
)
