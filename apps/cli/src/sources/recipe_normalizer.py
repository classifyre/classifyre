from __future__ import annotations

from copy import deepcopy
from typing import Any

_VALID_SAMPLING_STRATEGIES = {"RANDOM", "LATEST", "ALL"}


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _as_positive_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _normalize_sampling_strategy(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized if normalized in _VALID_SAMPLING_STRATEGIES else None


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _pick(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _normalize_object_storage_shape(
    normalized: dict[str, Any],
    source_type_value: str,
) -> None:
    required = _as_dict(normalized.get("required"))
    optional = _as_dict(normalized.get("optional"))
    optional_connection = _as_dict(optional.get("connection"))
    optional_scope = _as_dict(optional.get("scope"))

    for key in (
        "request_timeout_seconds",
        "max_keys_per_page",
        "max_object_bytes",
    ):
        value = normalized.get(key)
        if value is None:
            continue
        optional_connection.setdefault(key, value)
        normalized.pop(key, None)

    for key in (
        "prefix",
        "include_extensions",
        "exclude_extensions",
        "include_empty_objects",
        "include_object_metadata",
        "include_content_preview",
    ):
        value = normalized.get(key)
        if value is None:
            continue
        optional_scope.setdefault(key, value)
        normalized.pop(key, None)

    if source_type_value == "S3_COMPATIBLE_STORAGE":
        if (bucket := normalized.pop("bucket", None)) is not None:
            required.setdefault("bucket", bucket)
        for key in ("endpoint_url", "region_name", "verify_ssl"):
            value = normalized.get(key)
            if value is None:
                continue
            optional_connection.setdefault(key, value)
            normalized.pop(key, None)

    if source_type_value == "AZURE_BLOB_STORAGE":
        if (account_url := normalized.pop("account_url", None)) is not None:
            required.setdefault("account_url", account_url)
        if (container := normalized.pop("container", None)) is not None:
            required.setdefault("container", container)

    if source_type_value == "GOOGLE_CLOUD_STORAGE":
        if (bucket := normalized.pop("bucket", None)) is not None:
            required.setdefault("bucket", bucket)
        for key in ("project_id", "gcp_credentials_file"):
            value = normalized.get(key)
            if value is None:
                continue
            optional_connection.setdefault(key, value)
            normalized.pop(key, None)

    required.pop("provider", None)
    normalized["required"] = required
    if optional_connection:
        optional["connection"] = optional_connection
    if optional_scope:
        optional["scope"] = optional_scope
    if optional:
        normalized["optional"] = optional


def normalize_source_recipe(
    recipe: dict[str, Any],
    source_type: str | None = None,
) -> dict[str, Any]:
    normalized = deepcopy(recipe)
    source_type_value = str(source_type or normalized.get("type") or "").upper()

    if source_type_value:
        normalized["type"] = source_type_value

    optional = _as_dict(normalized.get("optional"))
    optional_content = _as_dict(optional.get("content"))
    optional_crawl = _as_dict(optional.get("crawl"))
    optional_ingestion = _as_dict(optional.get("ingestion"))
    optional_sampling = _as_dict(optional.get("sampling"))
    sampling = _as_dict(normalized.get("sampling"))

    strategy = _pick(
        _normalize_sampling_strategy(sampling.get("strategy")),
        _normalize_sampling_strategy(optional_sampling.get("strategy")),
        _normalize_sampling_strategy(optional_sampling.get("mode")),
        "RANDOM",
    )
    limit = _pick(
        _as_positive_int(sampling.get("limit")),
        _as_positive_int(optional_sampling.get("limit")),
        _as_positive_int(optional_sampling.get("rows")),
        _as_positive_int(optional_content.get("limit_total_items")),
        _as_positive_int(optional_crawl.get("max_pages")),
        _as_positive_int(optional_ingestion.get("limit_total_messages")),
        100,
    )

    sampling["strategy"] = strategy
    if strategy != "ALL":
        sampling["limit"] = limit
    else:
        sampling.pop("limit", None)

    for key in (
        "order_by_column",
        "fallback_to_random",
        "max_columns",
        "max_cell_chars",
        "max_total_chars",
        "include_column_names",
    ):
        if key not in sampling and key in optional_sampling:
            sampling[key] = optional_sampling[key]

    fetch_all_until_first_success = _pick(
        _as_bool(sampling.get("fetch_all_until_first_success")),
        _as_bool(optional_sampling.get("fetch_all_until_first_success")),
    )
    if fetch_all_until_first_success is not None:
        sampling["fetch_all_until_first_success"] = fetch_all_until_first_success
    else:
        sampling.pop("fetch_all_until_first_success", None)

    normalized["sampling"] = sampling

    optional.pop("sampling", None)
    optional_content.pop("limit_total_items", None)
    optional_crawl.pop("max_pages", None)
    optional_ingestion.pop("limit_total_messages", None)

    if optional:
        normalized["optional"] = optional

    if source_type_value == "WORDPRESS":
        required = _as_dict(normalized.get("required"))
        if isinstance(normalized.get("url"), str):
            required.setdefault("url", normalized.pop("url"))
        normalized["required"] = required
        normalized.setdefault("masked", _as_dict(normalized.get("masked")))

    if source_type_value == "SLACK":
        required = _as_dict(normalized.get("required"))
        if isinstance(normalized.get("workspace"), str):
            required.setdefault("workspace", normalized.pop("workspace"))
        normalized["required"] = required

    if source_type_value in {
        "S3_COMPATIBLE_STORAGE",
        "AZURE_BLOB_STORAGE",
        "GOOGLE_CLOUD_STORAGE",
    }:
        _normalize_object_storage_shape(normalized, source_type_value)

    return normalized
