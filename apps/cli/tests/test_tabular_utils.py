from __future__ import annotations

import json

from src.sources.tabular_utils import build_tabular_location, format_tabular_sample_content


def test_format_tabular_sample_content_uses_cell_lines_without_equals_prefixes() -> None:
    raw_content, text_content = format_tabular_sample_content(
        scope_label="table",
        scope_value="postgres.public.training_set",
        strategy="RANDOM",
        rows=[("Patrick Clark", "patrick.clark@example.com", "Acme")],
        column_names=["name", "email", "company"],
        serialize_cell=str,
        include_column_names=True,
        raw_metadata={
            "database": "postgres",
            "schema": "public",
            "table": "training_set",
        },
    )

    assert "row_1:" in text_content
    assert "  name: Patrick Clark" in text_content
    assert "  email: patrick.clark@example.com" in text_content
    assert "name=Patrick Clark" not in text_content
    assert "email=patrick.clark@example.com" not in text_content

    payload = json.loads(raw_content)
    assert payload["rows"][0]["name"] == "Patrick Clark"
    assert payload["rows"][0]["email"] == "patrick.clark@example.com"


def test_format_tabular_sample_content_indents_multiline_cell_continuations() -> None:
    _raw_content, text_content = format_tabular_sample_content(
        scope_label="table",
        scope_value="postgres.public.training_set",
        strategy="ALL",
        rows=[("460 Hannah Vista Suite 923\nHardinburgh, MP 62832",)],
        column_names=["address"],
        serialize_cell=str,
        include_column_names=True,
    )

    assert "  address: 460 Hannah Vista Suite 923" in text_content
    assert "    Hardinburgh, MP 62832" in text_content


def test_build_tabular_location_prefers_primary_key_and_sets_column_description() -> None:
    raw_content = json.dumps(
        {
            "database": "postgres",
            "schema": "public",
            "table": "training_set",
            "rows": [
                {
                    "id": "5",
                    "name": "Patrick Clark",
                    "email": "patrick.clark@example.com",
                    "text": "Please contact Patrick Clark at patrick.clark@example.com.",
                }
            ],
        }
    )

    location = build_tabular_location(
        raw_content=raw_content,
        matched_content="Patrick Clark",
        base_path="public.training_set",
        primary_key_columns=["id"],
    )

    assert location.path == "public.training_set, id=5"
    assert location.description == "column name"


def test_build_tabular_location_falls_back_to_row_index_for_substring_matches() -> None:
    raw_content = json.dumps(
        {
            "catalog": "main",
            "schema": "money",
            "table": "users",
            "rows": [
                {
                    "display_name": "Alice Example",
                    "about_me": "Reach Alice Example at alice@example.com",
                }
            ],
        }
    )

    location = build_tabular_location(
        raw_content=raw_content,
        matched_content="alice@example.com",
        base_path="main.money.users",
    )

    assert location.path == "main.money.users, row 1"
    assert location.description == "column about_me"


def test_build_tabular_location_uses_row_and_column_hints_for_duplicate_values() -> None:
    raw_content = json.dumps(
        {
            "database": "postgres",
            "schema": "public",
            "table": "training_set",
            "rows": [
                {
                    "id": "4",
                    "email": "carlacherry@example.org",
                    "text": "Patrick Clark can be reached at carlacherry@example.org",
                }
            ],
        }
    )

    location = build_tabular_location(
        raw_content=raw_content,
        matched_content="carlacherry@example.org",
        base_path="public.training_set",
        primary_key_columns=["id"],
        row_index=1,
        column_name="text",
    )

    assert location.path == "public.training_set, id=4"
    assert location.description == "column text"


def test_build_tabular_location_normalizes_whitespace_in_match() -> None:
    raw_content = json.dumps(
        {
            "database": "postgres",
            "schema": "public",
            "table": "training_set",
            "rows": [
                {
                    "id": "4",
                    "name": "Patrick Clark",
                    "email": "carlacherry@example.org",
                }
            ],
        }
    )

    location = build_tabular_location(
        raw_content=raw_content,
        matched_content="Patrick Clark\n  ",
        base_path="public.training_set",
        primary_key_columns=["id"],
    )

    assert location.path == "public.training_set, id=4"
    assert location.description == "column name"
