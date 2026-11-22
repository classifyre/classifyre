"""Which source types a query can read, and the binding that reads each.

The declaration is ``x-query`` in ``packages/schemas/src/schemas/all_input_sources.json``
(docs/prd/QC-query-connectors.md §5.1); the API names tables from the same
entry. ``_BINDINGS`` maps each declared type to the module and class that read
it, imported only when a query reads that type. tests/test_query_manifest.py
checks that the two agree in both directions.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from .base import BindingError, QueryBinding, SourceContext, TableLocation

__all__ = [
    "BindingError",
    "Declaration",
    "QueryBinding",
    "SourceContext",
    "TableLocation",
    "binding_class",
    "declared_sources",
    "query_dependency_groups",
]

#: source type → (module in this package, class).
_BINDINGS: dict[str, tuple[str, str]] = {
    "POSTGRESQL": ("postgres", "PostgresBinding"),
    "MYSQL": ("mysql", "MySQLBinding"),
    "DATABRICKS": ("databricks", "DatabricksBinding"),
    "ODBC": ("odbc", "OdbcBinding"),
    "ICEBERG_REST": ("attached_catalog", "AttachedCatalogBinding"),
    "DUCKLAKE": ("attached_catalog", "AttachedCatalogBinding"),
    "S3_COMPATIBLE_STORAGE": ("object_storage", "ObjectStorageBinding"),
    "AZURE_BLOB_STORAGE": ("object_storage", "ObjectStorageBinding"),
    "GOOGLE_CLOUD_STORAGE": ("object_storage", "ObjectStorageBinding"),
    "LOCAL_FOLDER": ("object_storage", "ObjectStorageBinding"),
    "MEILISEARCH": ("meilisearch", "MeilisearchConnector"),
    "NEO4J": ("neo4j", "Neo4jConnector"),
    "CUSTOM": ("custom", "CustomConnector"),
}


#: The optional dependency groups each type's source client imports
#: (``require_module(..., uv_groups=...)`` in ``src/sources/<type>/``). They
#: are baked into the CLI image (root ``Dockerfile``, cli-builder), so neither a
#: query Job nor the query worker installs anything while a query waits, and
#: the worker can run on a read-only root filesystem.
#: tests/test_query_manifest.py checks both against the sources and the image.
_SOURCE_GROUPS: dict[str, tuple[str, ...]] = {
    "POSTGRESQL": ("postgresql",),
    "MYSQL": ("mysql",),
    "DATABRICKS": ("databricks",),
    "ODBC": ("odbc",),
    "ICEBERG_REST": ("iceberg-rest",),
    "DUCKLAKE": ("file-processing",),
    "S3_COMPATIBLE_STORAGE": ("s3-compatible-storage",),
    "AZURE_BLOB_STORAGE": ("azure-blob-storage",),
    "GOOGLE_CLOUD_STORAGE": ("google-cloud-storage",),
    "LOCAL_FOLDER": (),
    "MEILISEARCH": (),
    "NEO4J": ("neo4j",),
    # A notebook's own imports are warmed when its process starts
    # (``warm_declared_groups``), in the query Job: CUSTOM never runs in the
    # worker.
    "CUSTOM": (),
}


def query_dependency_groups() -> set[str]:
    """Every group a query of a declared type may import: the sources' own
    clients and the bindings' (``QueryBinding.dependency_groups``)."""
    groups = {g for t in declared_sources() for g in _SOURCE_GROUPS.get(t, ())}
    groups.update(g for t in declared_sources() for g in binding_class(t).dependency_groups)
    return groups


@dataclass(frozen=True)
class Declaration:
    """One source type's ``x-query`` entry."""

    tier: str
    asset_kinds: tuple[str, ...]
    address: str
    extensions: tuple[str, ...]


def _schema_path() -> Path:
    import schemas

    return Path(schemas.__file__).parent / "all_input_sources.json"


@cache
def declared_sources() -> dict[str, Declaration]:
    """Every queryable source type, by its upper-case type name."""
    with open(_schema_path(), encoding="utf-8") as handle:
        raw = json.load(handle).get("x-query", {}).get("sources", {})
    return {
        str(source_type).upper(): Declaration(
            tier=str(entry.get("tier") or ""),
            asset_kinds=tuple(str(kind) for kind in entry.get("assetKinds") or ()),
            address=str(entry.get("address") or ""),
            extensions=tuple(str(name) for name in entry.get("extensions") or ()),
        )
        for source_type, entry in raw.items()
        if isinstance(entry, dict)
    }


def binding_class(source_type: str) -> type[QueryBinding]:
    """The binding that reads a declared source type's tables."""
    key = source_type.upper()
    target = _BINDINGS.get(key) if key in declared_sources() else None
    if target is None:
        raise BindingError(f"Sources of type {key} cannot be queried yet.")
    module_name, class_name = target
    module = importlib.import_module(f"{__name__}.{module_name}")
    cls: type[QueryBinding] = getattr(module, class_name)
    return cls
