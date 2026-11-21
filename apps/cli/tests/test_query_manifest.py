"""The ``x-query`` declaration and the CLI's bindings agree (docs/prd/QC-query-connectors.md §5.1).

One declaration in ``packages/schemas/src/schemas/all_input_sources.json`` says
which source types can be queried and how; the API names their tables from it
and the query job attaches them. A type declared without a binding, or a
binding nobody declared, would make the catalog offer a table the job cannot
read (or hide one it can), so both directions are checked here.
"""

from __future__ import annotations

import pytest

from src.query import bindings
from src.query.connectors import QueryBinding, binding_class, declared_sources

TIERS = {"native", "extension", "connector", "custom"}


def test_every_declared_source_type_has_a_binding_of_its_tier() -> None:
    declared = declared_sources()
    assert declared, "x-query declares no source types"
    for source_type, declaration in declared.items():
        assert declaration.tier in TIERS, source_type
        cls = binding_class(source_type)
        assert issubclass(cls, QueryBinding), source_type
        assert cls.tier == declaration.tier, source_type


def test_the_job_queries_exactly_the_declared_types() -> None:
    assert bindings.QUERYABLE_SOURCE_TYPES == frozenset(declared_sources())


def test_every_declaration_names_table_shaped_asset_kinds_and_an_address() -> None:
    for source_type, declaration in declared_sources().items():
        assert declaration.asset_kinds, source_type
        assert declaration.address, source_type


def test_an_undeclared_type_has_no_binding() -> None:
    with pytest.raises(bindings.BindingError, match="cannot be queried yet"):
        binding_class("SLACK")


def test_today_s_ten_types_stay_queryable() -> None:
    # QC1 changes no behaviour: the ten types DQ built are all declared.
    assert set(declared_sources()) >= {
        "POSTGRESQL",
        "MYSQL",
        "DATABRICKS",
        "ODBC",
        "ICEBERG_REST",
        "DUCKLAKE",
        "S3_COMPATIBLE_STORAGE",
        "AZURE_BLOB_STORAGE",
        "GOOGLE_CLOUD_STORAGE",
        "LOCAL_FOLDER",
    }
