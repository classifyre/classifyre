"""``Asset.tags``: the facts a connector already knows, keyed by Tag detector."""

from __future__ import annotations

import pytest

from src.notebook.sdk import Asset


def test_a_dict_is_the_ordinary_shape() -> None:
    assert Asset(id="a", tags={"cardholder_data": "pan"}).tags == {"cardholder_data": "pan"}


def test_no_tags_is_an_empty_dict() -> None:
    assert Asset(id="a").tags == {}
    assert Asset(id="a", tags=None).tags == {}


def test_pairs_are_accepted() -> None:
    assert Asset(id="a", tags=[("legal_hold", "retained")]).tags == {"legal_hold": "retained"}


def test_key_value_dicts_are_accepted() -> None:
    tags = Asset(id="a", tags=[{"key": "legal_hold", "value": "retained"}]).tags
    assert tags == {"legal_hold": "retained"}


def test_repeated_keys_are_joined_rather_than_dropped() -> None:
    # Two assertions about one asset are both true; keeping only the last would
    # discard one silently.
    tags = Asset(id="a", tags=[("jurisdiction", "EU"), ("jurisdiction", "UK")]).tags
    assert tags == {"jurisdiction": "EU, UK"}


def test_blank_keys_and_values_are_dropped() -> None:
    assert Asset(id="a", tags={"": "x", "k": "", "  ": "  "}).tags == {}


def test_values_are_stringified_and_stripped() -> None:
    assert Asset(id="a", tags={"count": 3, "k": "  v  "}).tags == {"count": "3", "k": "v"}


def test_a_string_is_rejected_with_the_shape_it_wanted() -> None:
    with pytest.raises(TypeError, match="detector key"):
        Asset(id="a", tags="cardholder_data")


def test_a_non_pair_entry_is_rejected() -> None:
    with pytest.raises(TypeError, match="pairs"):
        Asset(id="a", tags=[1, 2])
