import json
from pathlib import Path
from typing import Any

from jsonschema import validators

import schemas


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


def validate_input(data: dict[str, Any], schema_name: str = "") -> None:  # noqa: ARG001
    """
    Validate input data against the unified all_input_sources schema.
    The schema_name parameter is kept for compatibility but ignored.
    """
    schema = _load_schema("all_input_sources.json")
    _validate_schema(data, schema)


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
