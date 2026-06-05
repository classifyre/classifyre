"""Conformance tests for the x-asset-metadata catalog.

Guards the contract between the declarative catalog (in all_input_sources.json)
and the CLI code: structure validity, full source coverage, and that the two
shared producers (file_metadata, tabular_base) match their declared content
types. Per-source emitted-vs-declared enforcement happens "for free" because
every source builds assets through ``BaseSource.validated_metadata`` which
raises under pytest.
"""

from __future__ import annotations

from src.sources.asset_metadata import load_catalog, resolve_fields
from src.sources.tabular_base import TABULAR_METADATA_KEYS
from src.utils.file_metadata import FILE_METADATA_KEYS
from src.utils.validation import _load_schema

# Content types whose union backs the object-storage "file" asset.
_FILE_CONTENT_TYPES = ["file", "image", "document", "spreadsheet", "text", "json"]


def test_catalog_present_with_content_types_and_sources() -> None:
    catalog = load_catalog()
    assert isinstance(catalog.get("contentTypes"), dict)
    assert isinstance(catalog.get("sources"), dict)


def test_content_types_are_well_formed_object_schemas() -> None:
    catalog = load_catalog()
    for name, content_type in catalog["contentTypes"].items():
        assert content_type.get("type") == "object", name
        properties = content_type.get("properties", {})
        assert properties, f"{name} has no properties"
        for prop_name, prop in properties.items():
            assert isinstance(prop.get("type"), str), f"{name}.{prop_name} missing type"
        for required_name in content_type.get("required", []):
            assert required_name in properties, f"{name} requires unknown {required_name}"


def test_every_source_and_asset_kind_resolves() -> None:
    catalog = load_catalog()
    for source_key, asset_kinds in catalog["sources"].items():
        assert asset_kinds, f"{source_key} has no asset kinds"
        for asset_kind in asset_kinds:
            fields = resolve_fields(source_key.lower(), asset_kind)
            assert fields, f"{source_key}/{asset_kind} resolved to no fields"
            names = [field["name"] for field in fields]
            assert len(names) == len(set(names)), f"duplicate field in {source_key}/{asset_kind}"
            for field in fields:
                assert isinstance(field["type"], str)
                assert isinstance(field["required"], bool)
                assert isinstance(field["description"], str)


def test_catalog_covers_every_asset_type() -> None:
    schema = _load_schema("all_input_sources.json")
    asset_types = set(schema["definitions"]["AssetType"]["enum"])
    catalog_sources = set(load_catalog()["sources"])
    assert catalog_sources == asset_types


def test_file_content_types_match_producer() -> None:
    catalog = load_catalog()
    union: set[str] = set()
    for name in _FILE_CONTENT_TYPES:
        union |= set(catalog["contentTypes"][name]["properties"])
    assert union == set(FILE_METADATA_KEYS)


def test_tabular_content_type_matches_producer() -> None:
    catalog = load_catalog()
    table_keys = set(catalog["contentTypes"]["tabularTable"]["properties"])
    assert table_keys == set(TABULAR_METADATA_KEYS)
