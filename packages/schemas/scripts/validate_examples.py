#!/usr/bin/env python3
"""Validate input examples against the input sources schema."""

import json
import sys
from pathlib import Path

import fastjsonschema

# Map source type to schema definition name
TYPE_TO_DEFINITION = {
    "SLACK": "SlackInput",
    "S3_COMPATIBLE_STORAGE": "S3CompatibleStorageInput",
    "AZURE_BLOB_STORAGE": "AzureBlobStorageInput",
    "GOOGLE_CLOUD_STORAGE": "GoogleCloudStorageInput",
    "WORDPRESS": "WordPressInput",
    "POSTGRESQL": "PostgreSQLInput",
    "MYSQL": "MySQLInput",
    "MSSQL": "MSSQLInput",
    "ORACLE": "OracleInput",
    "HIVE": "HiveInput",
    "DATABRICKS": "DatabricksInput",
    "SNOWFLAKE": "SnowflakeInput",
    "MONGODB": "MongoDBInput",
    "POWERBI": "PowerBIInput",
    "TABLEAU": "TableauInput",
    "CONFLUENCE": "ConfluenceInput",
    "JIRA": "JiraInput",
    "SERVICEDESK": "ServiceDeskInput",
}

SCHEMAS_DIR = Path(__file__).parent.parent / "src" / "schemas"


def load_schema():
    """Load the input sources schema."""
    schema_path = SCHEMAS_DIR / "all_input_sources.json"
    with open(schema_path, "r") as f:
        return json.load(f)


def load_examples():
    """Load the input examples."""
    examples_path = SCHEMAS_DIR / "all_input_examples.json"
    with open(examples_path, "r") as f:
        return json.load(f)


def create_validation_schema_for_type(schema: dict, source_type: str) -> dict:
    """Create a validation schema for a specific source type."""
    definition_name = TYPE_TO_DEFINITION.get(source_type)
    if not definition_name:
        raise ValueError(f"Unknown source type: {source_type}")

    # Create a schema that references the specific input definition
    return {
        "$schema": schema.get("$schema", "http://json-schema.org/draft-07/schema#"),
        "$ref": f"#/definitions/{definition_name}",
        "definitions": schema.get("definitions", {}),
    }


def validate_examples():
    """Validate all examples against the schema."""
    schema = load_schema()
    examples = load_examples()

    errors = []
    total_examples = 0
    validated_examples = 0

    for source_type, example_list in examples.items():
        if not isinstance(example_list, list):
            errors.append(f"Invalid format for {source_type}: expected array, got {type(example_list).__name__}")
            continue

        # Create validator for this source type
        try:
            type_schema = create_validation_schema_for_type(schema, source_type)
            validator = fastjsonschema.compile(type_schema)
        except ValueError as e:
            # Skip types that don't have a schema definition
            print(f"⚠️  Skipping {source_type}: {e}")
            continue
        except Exception as e:
            errors.append(f"Failed to create validator for {source_type}: {e}")
            continue

        # Validate each example's config field
        for idx, example in enumerate(example_list):
            total_examples += 1
            
            # Validate example structure
            if not isinstance(example, dict):
                errors.append(f"{source_type}[{idx}]: Example must be an object")
                continue
            
            if "name" not in example:
                errors.append(f"{source_type}[{idx}]: Missing 'name' field")
            if "description" not in example:
                errors.append(f"{source_type}[{idx}]: Missing 'description' field")
            if "config" not in example:
                errors.append(f"{source_type}[{idx}]: Missing 'config' field")
                continue
            
            # Validate config against schema
            try:
                validator(example["config"])
                validated_examples += 1
            except fastjsonschema.JsonSchemaException as e:
                errors.append(f"{source_type}[{idx}] ({example.get('name', 'unnamed')}): {e.message}")
            except Exception as e:
                errors.append(f"{source_type}[{idx}] ({example.get('name', 'unnamed')}): Unexpected error: {e}")

    # Print results
    print(f"Validated {validated_examples}/{total_examples} examples")
    
    if errors:
        print("\nValidation errors:")
        for error in errors:
            print(f"  ❌ {error}")
        return False
    
    print("✅ All examples are valid!")
    return True


if __name__ == "__main__":
    success = validate_examples()
    sys.exit(0 if success else 1)
