"""Shared fixtures and skip markers for custom detector tests."""

from __future__ import annotations

import importlib

import pytest

_gliner2_available = False
try:
    importlib.import_module("gliner2")
    _gliner2_available = True
except Exception:
    pass

requires_gliner2 = pytest.mark.skipif(
    not _gliner2_available,
    reason="gliner2 not installed (install custom/detectors group)",
)

_pdfplumber_available = False
try:
    importlib.import_module("pdfplumber")
    _pdfplumber_available = True
except Exception:
    pass

requires_pdfplumber = pytest.mark.skipif(
    not _pdfplumber_available,
    reason="pdfplumber not available (install file-processing group)",
)
