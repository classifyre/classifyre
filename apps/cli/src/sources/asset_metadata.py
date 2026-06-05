"""Asset-metadata contract: the single source of truth for what each source
extracts is the ``x-assets-metadata`` catalog embedded in
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

# ── Normalized metadata key constants (reused across sources) ────────────────
SIZE_BYTES = "size_bytes"
MIME_TYPE = "mime_type"
ROW_COUNT = "row_count"
COLUMN_COUNT = "column_count"
COLUMN_NAMES = "column_names"
COLUMN_TYPES = "column_types"
PAGE_COUNT = "page_count"
ENCODING = "encoding"
IMAGE_WIDTH = "image_width"
IMAGE_HEIGHT = "image_height"
PARSE_ERROR = "parse_error"
AUTHOR = "author"
STATUS = "status"
TAGS = "tags"

_CATALOG_KEY = "x-assets-metadata"
_DEFAULT_TYPE = "string"

ResolvedField = dict[str, Any]  # {name, type, description, required}


class AssetMetadataContractError(AssertionError):
    """Raised (in strict mode) when emitted metadata violates the catalog."""


def _strict_mode() -> bool:
    return bool(
        os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("CLASSIFYRE_STRICT_METADATA")
    )


@cache
def load_catalog() -> dict[str, Any]:
    """Load and cache the ``x-assets-metadata`` catalog from the merged schema."""
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


def resolve_fields(source_type: str, asset_kind: str) -> list[ResolvedField]:
    """Resolve the declared fields for a (source, asset kind).

    Resolution: concat ``use`` groups, then inline ``fields`` (inheriting
    type/description from ``commonFields`` when omitted); deduped by name with
    inline entries overriding group entries. Raises if the entry is absent.
    """
    catalog = load_catalog()
    sources = catalog.get("sources", {})
    source_entry = sources.get(_source_key(source_type))
    if not isinstance(source_entry, dict) or asset_kind not in source_entry:
        raise AssetMetadataContractError(
            f"No catalog entry for source '{source_type}' asset kind '{asset_kind}'"
        )
    entry = source_entry[asset_kind]
    common_fields = catalog.get("commonFields", {})
    field_groups = catalog.get("fieldGroups", {})

    resolved: dict[str, ResolvedField] = {}

    for group_name in entry.get("use", []):
        for field in field_groups.get(group_name, []):
            resolved[field["name"]] = {
                "name": field["name"],
                "type": field.get("type", _DEFAULT_TYPE),
                "description": field.get("description", ""),
                "required": bool(field.get("required", False)),
            }

    for field in entry.get("fields", []):
        name = field["name"]
        common = common_fields.get(name, {})
        resolved[name] = {
            "name": name,
            "type": field.get("type") or common.get("type") or _DEFAULT_TYPE,
            "description": field.get("description") or common.get("description") or "",
            "required": bool(field.get("required", False)),
        }

    return list(resolved.values())


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
