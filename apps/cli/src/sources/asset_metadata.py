"""Asset-metadata contract: the single source of truth for what each source
extracts is the ``x-asset-metadata`` catalog embedded in
``packages/schemas/src/schemas/all_input_sources.json``.

This module loads/resolves that catalog and validates metadata dicts against it.
Validation is strict (raises) under pytest or when ``CLASSIFYRE_STRICT_METADATA``
is set, and otherwise logs a warning during real ingestion — so drift between a
source's emitted keys and the declared catalog is caught either in CI or at runtime.
"""

from __future__ import annotations

import logging
import os
from functools import cache
from typing import Any

from ..utils.validation import _load_schema

logger = logging.getLogger(__name__)

_CATALOG_KEY = "x-asset-metadata"

ResolvedField = dict[str, Any]  # {name, type, description, required}


class AssetMetadataContractError(AssertionError):
    """Raised (in strict mode) when emitted metadata violates the catalog."""


def _strict_mode() -> bool:
    return bool(
        os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("CLASSIFYRE_STRICT_METADATA")
    )


@cache
def load_catalog() -> dict[str, Any]:
    """Load and cache the ``x-asset-metadata`` catalog from the merged schema."""
    schema = _load_schema("all_input_sources.json")
    catalog = schema.get(_CATALOG_KEY)
    if not isinstance(catalog, dict):
        raise AssetMetadataContractError(
            f"Missing '{_CATALOG_KEY}' catalog in all_input_sources.json"
        )
    return catalog


def _source_key(source_type: str) -> str:
    # Catalog keys mirror the AssetType enum (uppercased source_type).
    return source_type.upper()


def describe_type(prop_schema: dict[str, Any]) -> str:
    """Render a JSON-Schema property type as a short display string."""
    json_type = prop_schema.get("type")
    if json_type == "array":
        items = prop_schema.get("items", {})
        item_type = items.get("type", "string") if isinstance(items, dict) else "string"
        return f"{item_type}[]"
    return str(json_type) if json_type else "string"


def resolve_fields(source_type: str, asset_kind: str) -> list[ResolvedField]:
    """Resolve the declared fields for a (source, asset kind).

    The asset entry composes one or more reusable ``contentTypes`` via ``use``
    plus its own ``properties``; ``required`` is the union of each used content
    type's required list and the entry's own. Raises if the entry is absent.
    """
    catalog = load_catalog()
    sources = catalog.get("sources", {})
    source_entry = sources.get(_source_key(source_type))
    if not isinstance(source_entry, dict) or asset_kind not in source_entry:
        raise AssetMetadataContractError(
            f"No catalog entry for source '{source_type}' asset kind '{asset_kind}'"
        )
    entry = source_entry[asset_kind]
    content_types = catalog.get("contentTypes", {})

    properties: dict[str, dict[str, Any]] = {}
    required: set[str] = set()

    for content_type_name in entry.get("use", []):
        content_type = content_types.get(content_type_name, {})
        properties.update(content_type.get("properties", {}))
        required.update(content_type.get("required", []))

    properties.update(entry.get("properties", {}))
    required.update(entry.get("required", []))

    return [
        {
            "name": name,
            "type": describe_type(prop),
            "description": prop.get("description", ""),
            "required": name in required,
        }
        for name, prop in properties.items()
    ]


def validate_metadata(
    source_type: str,
    asset_kind: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Validate an emitted metadata dict against the catalog and return it.

    Strict mode raises ``AssetMetadataContractError``; otherwise it logs a
    warning. Checks: no undeclared keys, and every required field is present
    with a non-null value.
    """
    try:
        fields = resolve_fields(source_type, asset_kind)
    except AssetMetadataContractError as exc:
        if _strict_mode():
            raise
        logger.warning("Asset metadata contract: %s", exc)
        return data

    declared = {field["name"] for field in fields}
    required = {field["name"] for field in fields if field["required"]}
    present_non_null = {key for key, value in data.items() if value is not None}

    undeclared = sorted(set(data) - declared)
    missing_required = sorted(required - present_non_null)

    if undeclared or missing_required:
        message = (
            f"[{source_type}/{asset_kind}] "
            f"undeclared={undeclared} missing_required={missing_required}"
        )
        if _strict_mode():
            raise AssetMetadataContractError(message)
        logger.warning("Asset metadata contract drift: %s", message)

    return data
