from src.sources.recipe_normalizer import normalize_source_recipe


def test_normalize_source_recipe_strips_fetch_all_until_first_success():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "sampling": {
                "strategy": "RANDOM",
                "fetch_all_until_first_success": True,
            },
        }
    )

    assert normalized["sampling"]["strategy"] == "RANDOM"
    assert "fetch_all_until_first_success" not in normalized["sampling"]


def test_normalize_source_recipe_strips_legacy_limit_and_max_columns():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "sampling": {
                "strategy": "RANDOM",
                "limit": 50,
                "max_columns": 10,
            },
        }
    )

    assert "limit" not in normalized["sampling"]
    assert "max_columns" not in normalized["sampling"]


def test_normalize_source_recipe_copies_rows_per_page_from_optional_sampling():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "optional": {
                "sampling": {
                    "mode": "latest",
                    "rows_per_page": 15,
                }
            },
        }
    )

    assert normalized["sampling"]["strategy"] == "LATEST"
    assert normalized["sampling"]["rows_per_page"] == 15
    assert "fetch_all_until_first_success" not in normalized["sampling"]
