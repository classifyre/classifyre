"""Resolve which optional uv dependency groups a recipe will need.

Used by the parent CLI process to warm those groups once (a single, serialized
``uv sync``) before the detector worker pool spawns, so the pool's worker
processes find their dependencies already installed instead of each racing on its
own ``uv sync``. This is a best-effort optimization — the lock-protected,
self-healing ``require_module`` path in ``uv_sync.py`` remains the safety net, so
an incomplete mapping here only costs a little first-scan contention, never
correctness.

Keep these maps in sync with the ``require_module(..., uv_groups=[...])`` calls
under ``src/detectors`` and ``src/sources``; ``tests/test_dependency_groups.py``
guards them against the detector enum and pyproject group definitions.
"""

from __future__ import annotations

from typing import Any

# Detector type -> optional uv groups imported at runtime.
DETECTOR_TYPE_GROUPS: dict[str, set[str]] = {
    "PII": {"privacy"},
    "SECRETS": {"security"},
    "YARA": {"security"},
    "CODE_SECURITY": {"security"},
    "BROKEN_LINKS": set(),  # uses base deps only
    "CUSTOM": {"custom"},  # llm/regex/classification extras install on demand
}

# Source type -> primary driver group. Sources whose driver is in the base image
# (slack, wordpress, confluence, jira, notion, sitemap, servicedesk, sqlite,
# powerbi) are omitted. Attachment/file parsing installs on demand.
SOURCE_TYPE_GROUPS: dict[str, set[str]] = {
    "POSTGRESQL": {"postgresql"},
    "MYSQL": {"mysql"},
    "MSSQL": {"mssql"},
    "ORACLE": {"oracle"},
    "HIVE": {"hive"},
    "DATABRICKS": {"databricks"},
    "SNOWFLAKE": {"snowflake"},
    "MONGODB": {"mongodb"},
    "NEO4J": {"neo4j"},
    "TABLEAU": {"tableau"},
    "S3_COMPATIBLE_STORAGE": {"s3-compatible-storage"},
    "AZURE_BLOB_STORAGE": {"azure-blob-storage"},
    "GOOGLE_CLOUD_STORAGE": {"google-cloud-storage"},
    "EMAIL": {"email"},
}


def recipe_uv_groups(recipe: dict[str, Any]) -> set[str]:
    """Return the optional uv groups a recipe is expected to install at runtime."""
    groups: set[str] = set()

    source_type = str(recipe.get("type", "")).upper()
    groups |= SOURCE_TYPE_GROUPS.get(source_type, set())

    for detector in recipe.get("detectors") or []:
        if not isinstance(detector, dict) or not detector.get("enabled", True):
            continue
        detector_type = str(detector.get("type", "")).upper()
        groups |= DETECTOR_TYPE_GROUPS.get(detector_type, set())

    sampling = recipe.get("sampling")
    if isinstance(sampling, dict) and sampling.get("enable_ocr"):
        groups.add("ocr")

    return {group for group in groups if group}
