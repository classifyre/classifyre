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
}


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
