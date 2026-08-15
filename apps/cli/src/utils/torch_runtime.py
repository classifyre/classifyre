"""Torch runtime configuration applied before torch is ever imported.

Docling's OCR models run under torch, and torch.compile's inductor backend
generates C++ and shells out to a compiler *at scan time*. That is a poor fit
for how this CLI is deployed, in two independent ways:

1. It needs a working C++ toolchain on the machine running the scan. Neither
   the desktop bundle nor a slim container image promises one.
2. Inductor builds the compiler command line without quoting its paths, so any
   path containing a space breaks it. The desktop venv lives under
   ``~/Library/Application Support/…``, which produces exactly that:

       clang++: error: no such file or directory:
         'Support/Classifyre/python-runtime/…/torch/lib'

   Observed on a real desktop install: 167 compile errors and 33 OCR
   extractions that returned no text at all, silently costing coverage on
   every image and scanned document in the corpus.

Docling falls back to eager execution when compilation fails, so the failure is
not always fatal — it is just expensive. Measured on one 600x200 PNG with warm
models: **58.5s compiling and failing, 24.9s with compilation disabled**, for
identical extracted text. The compile step is pure loss here.

So it is off by default. An explicitly set ``TORCH_COMPILE_DISABLE`` is always
honoured, so a deployment that has a toolchain, space-free paths, and a
measured reason to want inductor can turn it back on.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# torch 2.13 reads TORCH_COMPILE_DISABLE. The older TORCHDYNAMO_DISABLE is
# still widely cited but no longer flips torch._dynamo.config.disable, so
# setting that one instead would look correct and do nothing.
_DISABLE_ENV = "TORCH_COMPILE_DISABLE"


def configure_torch_runtime(env: dict[str, str] | None = None) -> bool:
    """Disable torch.compile unless the environment already decided.

    Must be called before torch (or anything importing it, such as docling) is
    imported: torch reads this variable at import time.

    :returns: True when this call disabled compilation, False when the
        environment already set a value and was left alone.
    """
    target = env if env is not None else os.environ

    existing = target.get(_DISABLE_ENV)
    if existing is not None and existing.strip() != "":
        logger.debug("Leaving %s=%s as configured by the environment", _DISABLE_ENV, existing)
        return False

    target[_DISABLE_ENV] = "1"
    return True
