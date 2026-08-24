"""Typed relationship edges, and the platform names that let them cross systems."""

from .edges import (
    ContainmentType,
    Edge,
    EdgeClass,
    FieldMapping,
    FieldTransform,
    FlowType,
    Method,
    Ref,
    ReferenceType,
    UsageType,
    contains,
    flow,
    references,
    same_as,
    uses,
)

__all__ = [
    "ContainmentType",
    "Edge",
    "EdgeClass",
    "FieldMapping",
    "FieldTransform",
    "FlowType",
    "Method",
    "Ref",
    "ReferenceType",
    "UsageType",
    "contains",
    "flow",
    "references",
    "same_as",
    "uses",
]
