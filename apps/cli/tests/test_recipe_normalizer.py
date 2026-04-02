from src.sources.recipe_normalizer import normalize_source_recipe


def test_normalize_source_recipe_keeps_fetch_all_until_first_success():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "sampling": {
                "strategy": "RANDOM",
                "limit": 5,
                "fetch_all_until_first_success": True,
            },
        }
    )

    assert normalized["sampling"]["strategy"] == "RANDOM"
    assert normalized["sampling"]["fetch_all_until_first_success"] is True


def test_normalize_source_recipe_copies_fetch_all_flag_from_optional_sampling():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "optional": {
                "sampling": {
                    "mode": "latest",
                    "limit": 7,
                    "fetch_all_until_first_success": True,
                }
            },
        }
    )

    assert normalized["sampling"]["strategy"] == "LATEST"
    assert normalized["sampling"]["limit"] == 7
    assert normalized["sampling"]["fetch_all_until_first_success"] is True


def test_normalize_source_recipe_ignores_non_boolean_fetch_all_flag():
    normalized = normalize_source_recipe(
        {
            "type": "POSTGRESQL",
            "required": {"host": "db.local", "port": 5432},
            "sampling": {
                "strategy": "RANDOM",
                "fetch_all_until_first_success": "yes",
            },
        }
    )

    assert "fetch_all_until_first_success" not in normalized["sampling"]
