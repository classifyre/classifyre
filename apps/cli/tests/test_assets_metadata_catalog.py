"""Conformance tests for the x-assets-metadata catalog.

These guard the contract between the declarative catalog (in
all_input_sources.json) and the CLI code: structure validity, full source
coverage, and that the two shared producers (file_metadata, tabular_base) match
their declared field groups. Per-source emitted-vs-declared enforcement happens
"for free" because every source builds assets through
``BaseSource.validated_metadata`` which raises under pytest.
"""

from __future__ import annotations

from src.sources.asset_metadata import load_catalog, resolve_fields
from src.sources.tabular_base import TABULAR_METADATA_KEYS
from src.utils.file_metadata import FILE_METADATA_KEYS
from src.utils.validation import _load_schema

_VALID_TYPES = {"string", "number", "boolean", "string[]", "object"}


def test_catalog_present_and_field_types_declared() -> None:
    catalog = load_catalog()
    assert set(catalog["fieldTypes"]) == _VALID_TYPES


def test_common_fields_well_formed() -> None:
    catalog = load_catalog()
    for name, field in catalog["commonFields"].items():
        assert field.get("type") in _VALID_TYPES, name
        assert isinstance(field.get("description"), str) and field["description"], name


def test_field_groups_resolve_with_valid_types() -> None:
    catalog = load_catalog()
    common = catalog["commonFields"]
    for group_name, fields in catalog["fieldGroups"].items():
        for field in fields:
            name = field["name"]
            # Type comes from the field itself or is inherited from commonFields.
            field_type = field.get("type") or common.get(name, {}).get("type")
            assert field_type in _VALID_TYPES, f"{group_name}.{name}"


def test_every_source_and_asset_kind_resolves() -> None:
    catalog = load_catalog()
    for source_key, asset_kinds in catalog["sources"].items():
        assert asset_kinds, f"{source_key} has no asset kinds"
        for asset_kind in asset_kinds:
            fields = resolve_fields(source_key.lower(), asset_kind)
            assert fields, f"{source_key}/{asset_kind} resolved to no fields"
            names = [f["name"] for f in fields]
            assert len(names) == len(set(names)), f"duplicate field in {source_key}/{asset_kind}"
            for field in fields:
                assert field["type"] in _VALID_TYPES
                assert isinstance(field["required"], bool)
                assert isinstance(field["description"], str)


def test_catalog_covers_every_asset_type() -> None:
    schema = _load_schema("all_input_sources.json")
    asset_types = set(schema["definitions"]["AssetType"]["enum"])
    catalog_sources = set(load_catalog()["sources"])
    assert catalog_sources == asset_types


def test_file_extracted_group_matches_producer() -> None:
    catalog = load_catalog()
    group_keys = {field["name"] for field in catalog["fieldGroups"]["fileExtracted"]}
    assert group_keys == set(FILE_METADATA_KEYS)


def test_tabular_table_group_matches_producer() -> None:
    catalog = load_catalog()
    group_keys = {field["name"] for field in catalog["fieldGroups"]["tabularTable"]}
    assert group_keys == set(TABULAR_METADATA_KEYS)
