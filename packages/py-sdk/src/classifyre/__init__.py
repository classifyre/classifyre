"""Authoring SDK for Classifyre custom sources.

A custom source is a marimo notebook defining ``check``, ``discover`` and
``fetch`` as top-level functions. See the package README for the shape.
"""

from ._assets import KINDS, AssetContent, AssetError, AssetRef
from ._context import (
    ExecutionContext,
    MissingSecretError,
    MissingVariableError,
    context,
)

__all__ = [
    "AssetContent",
    "AssetError",
    "AssetRef",
    "ExecutionContext",
    "KINDS",
    "MissingSecretError",
    "MissingVariableError",
    "context",
]

__version__ = "0.4.123.dev0"
