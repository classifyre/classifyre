"""Which dependency groups a notebook's imports need.

The editor advertises boto3, duckdb and pdfplumber as available. Most of them
live in an optional uv group that nothing installs for a notebook, so without
this mapping the advertised list is a promise the runtime does not keep.
"""

from __future__ import annotations

from typing import Any

from src.notebook.groups import groups_for, modules_imported


def cells(*sources: str) -> list[dict[str, Any]]:
    return [
        {"id": f"c{index}", "type": "code", "source": source}
        for index, source in enumerate(sources)
    ]


class TestModulesImported:
    def test_reads_both_import_forms(self) -> None:
        assert modules_imported(cells("import duckdb", "from boto3 import client")) == {
            "duckdb",
            "boto3",
        }

    def test_keeps_the_dotted_path(self) -> None:
        # `azure.identity` and `azure.storage.blob` come from different
        # distributions, so the first segment alone is not enough.
        assert modules_imported(cells("from azure.identity import X")) == {"azure.identity"}

    def test_a_string_that_mentions_import_is_not_an_import(self) -> None:
        assert modules_imported(cells('query = "import boto3"')) == set()

    def test_a_relative_import_is_not_a_package(self) -> None:
        assert modules_imported(cells("from . import helpers")) == set()

    def test_a_notebook_that_does_not_parse_yields_nothing(self) -> None:
        # The contract check reports that failure properly a moment later; this
        # is not the place to raise about it.
        assert modules_imported(cells("def broken(:")) == set()


class TestGroupsFor:
    def test_maps_an_import_to_the_group_that_provides_it(self) -> None:
        assert groups_for(cells("import duckdb")) == ["file-processing"]

    def test_maps_the_import_name_not_the_distribution_name(self) -> None:
        # `pip install python-docx`, `import docx`.
        assert groups_for(cells("import docx")) == ["file-processing"]

    def test_base_dependencies_need_no_group(self) -> None:
        assert groups_for(cells("import requests, json")) == []

    def test_an_unknown_package_needs_no_group(self) -> None:
        # A package the author declared themselves; uv pip install handles it.
        assert groups_for(cells("import tensorflow")) == []

    def test_a_namespace_import_covers_everything_beneath_it(self) -> None:
        # `import azure` could mean either distribution, so both groups are
        # warmed rather than guessing which.
        assert "azure-blob-storage" in groups_for(cells("import azure"))

    def test_a_specific_namespace_import_is_matched_too(self) -> None:
        assert groups_for(cells("from azure.storage.blob import BlobClient")) == [
            "azure-blob-storage"
        ]

    def test_each_group_is_named_once(self) -> None:
        groups = groups_for(cells("import pdfplumber", "import openpyxl", "import duckdb"))
        assert groups == ["file-processing"]

    def test_an_empty_notebook_needs_nothing(self) -> None:
        assert groups_for([]) == []
