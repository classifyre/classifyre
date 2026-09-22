"""``Asset.tags``: the facts a connector already knows, keyed by Tag detector."""

from __future__ import annotations

import pytest

from src.notebook.sdk import Asset, Tag


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


# ── Tag(value, severity=) (field report P9) ───────────────────────────────────


def test_a_tag_value_splits_into_value_and_severity() -> None:
    asset = Asset(id="a", tags={"insolvencies_yoy": Tag("+34%", severity="HIGH")})

    # `tags` keeps its plain {key: value} shape, so everything that read it
    # before severities existed keeps working.
    assert asset.tags == {"insolvencies_yoy": "+34%"}
    assert asset.tag_severities == {"insolvencies_yoy": "HIGH"}


def test_a_tag_without_a_severity_records_none() -> None:
    asset = Asset(id="a", tags={"legal_hold": Tag("retained")})

    assert asset.tags == {"legal_hold": "retained"}
    assert asset.tag_severities == {}


def test_plain_string_tags_record_no_severity() -> None:
    assert Asset(id="a", tags={"k": "v"}).tag_severities == {}


def test_severity_is_normalised_to_upper_case() -> None:
    assert Tag("x", severity="high").severity == "HIGH"


def test_an_unknown_severity_is_rejected_at_the_notebook() -> None:
    # Failing here names the notebook line; failing at ingest names nothing.
    with pytest.raises(ValueError, match="CRITICAL, HIGH, MEDIUM, LOW, INFO"):
        Tag("x", severity="URGENT")


def test_joined_values_keep_the_most_severe_band() -> None:
    # Two assertions under one key share one finding, so they share one
    # severity; lowering it would understate a fact the connector made.
    asset = Asset(
        id="a",
        tags=[
            ("risk", Tag("late filing", severity="LOW")),
            ("risk", Tag("insolvency", severity="HIGH")),
        ],
    )

    assert asset.tags == {"risk": "late filing, insolvency"}
    assert asset.tag_severities == {"risk": "HIGH"}


def test_a_dropped_value_drops_its_severity() -> None:
    assert Asset(id="a", tags={"k": Tag("   ", severity="HIGH")}).tag_severities == {}
