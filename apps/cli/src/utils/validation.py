"""Validate CLI payloads against the shared JSON schemas.

Recipe validation errors are safe to log: the ``masked`` credential bag is
never included, and known secret values plus credential-shaped patterns are
redacted from the detail. Loggers must still redact the message they receive
(see ``notebook.redact``), but a validation failure on its own can no longer
leak an API key or password.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import exceptions as jsonschema_exceptions
from jsonschema import validators

import schemas

from .redaction import Redactor, redact_generic

#: Cap on the human-readable detail. Redaction runs before truncation, so a
#: cut never leaves half a secret behind.
MAX_SAFE_DETAIL_CHARS = 500


class RecipeValidationError(ValueError):
    """A recipe failed input-schema validation. Safe to log and display."""


def _load_schema(schema_filename: str) -> dict[str, Any]:
    schema_dir = Path(schemas.__file__).parent
    schema_path = schema_dir / schema_filename

    with open(schema_path) as f:
        return json.load(f)


def _validate_schema(instance: dict[str, Any], schema: dict[str, Any]) -> None:
    validator_cls = validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    validator.validate(instance)


def _safe_detail(
    error: jsonschema_exceptions.ValidationError,
    recipe: dict[str, Any] | None,
) -> str:
    """Render one validation error without the offending instance values."""
    redactor = Redactor.from_recipe(recipe)
    path = ".".join(str(part) for part in error.absolute_path) or "(root)"
    raw = str(error.message or "invalid value")
    cleaned = redact_generic(redactor.redact(raw))[:MAX_SAFE_DETAIL_CHARS]
    validator = str(getattr(error, "validator", "") or "")
    qualifier = f" [{validator}]" if validator else ""
    return f"at '{path}'{qualifier}: {cleaned} (masked values hidden)"


def format_validation_error(
    error: jsonschema_exceptions.ValidationError,
    recipe: dict[str, Any] | None = None,
) -> str:
    """Format any jsonschema error safely, hiding the credential bag."""
    return f"Recipe validation failed {_safe_detail(error, recipe)}"


def validate_input(data: dict[str, Any], schema_name: str = "") -> None:  # noqa: ARG001
    """
    Validate input data against the unified all_input_sources schema.
    The schema_name parameter is kept for compatibility but ignored.

    Raises:
        RecipeValidationError: with a log-safe message that never includes
            ``masked`` values.
    """
    schema = _load_schema("all_input_sources.json")
    validator_cls = validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    errors = list(validator.iter_errors(data))
    if not errors:
        return
    best = jsonschema_exceptions.best_match(iter(errors))
    raise RecipeValidationError(f"Recipe validation failed {_safe_detail(best, data)}")


def validate_output(data: dict[str, Any], schema_name: str = "") -> None:  # noqa: ARG001
    """
    Validate output data against the unified single_asset_scan_results schema.
    The schema_name parameter is kept for compatibility but ignored.
    """
    schema = _load_schema("single_asset_scan_results.json")
    _validate_schema(data, schema)


def validate_test_connection(data: dict[str, Any]) -> None:
    """
    Validate test connection output against the core test-connection schema.
    """
    schema: dict[str, Any] = {
        "type": "object",
        "required": ["status"],
        "properties": {
            "status": {"type": "string", "enum": ["SUCCESS", "FAILURE"]},
            "message": {"type": "string"},
        },
    }

    _validate_schema(data, schema)
