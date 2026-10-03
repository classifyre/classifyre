"""A record that *is* a named thing declares it (G5 R12)."""

from __future__ import annotations

import pytest

from src.notebook.sdk import ENTITY_METADATA_KEY, Asset, Context, Entity, build_module, namespace


def test_entity_is_importable_from_classifyre() -> None:
    module = build_module(Context())
    assert module.Entity is Entity
    assert "Entity" in module.__all__
    assert namespace(Context())["Entity"] is Entity


def test_a_declared_entity_travels_in_the_asset_metadata() -> None:
    asset = Asset(
        id="123456a",
        urn="firmenbuch://at/fn/123456a",
        entity=Entity(
            type="organization",
            name=" ACME Holding GmbH ",
            identifiers={"vat": "ATU12345678", "fn": "123456a"},
            aliases=["ACME Holding", "ACME Holding", " "],
        ),
    )

    assert asset.metadata[ENTITY_METADATA_KEY] == {
        "name": "ACME Holding GmbH",
        "type": "ORGANIZATION",
        # Sorted, so the same declaration always hashes to the same checksum.
        "identifiers": {"fn": "123456a", "vat": "ATU12345678"},
        "aliases": ["ACME Holding"],
    }


def test_an_asset_without_an_entity_keeps_its_metadata_untouched() -> None:
    # The declaration joins the checksum basis only when set, so existing
    # corpora are not re-checksummed for a feature they do not use.
    asset = Asset(id="a", metadata={"k": "v"})
    assert asset.metadata == {"k": "v"}


def test_the_notebooks_own_metadata_is_kept() -> None:
    asset = Asset(
        id="a",
        urn="crm://customer/1",
        metadata={"segment": "retail"},
        entity=Entity(name="Jane Doe", type="PERSON"),
    )
    assert asset.metadata["segment"] == "retail"
    assert asset.metadata[ENTITY_METADATA_KEY] == {"name": "Jane Doe", "type": "PERSON"}


def test_a_key_stands_in_for_a_urn() -> None:
    asset = Asset(id="a", entity=Entity(name="ACME", key="ACME-Holding"))
    assert asset.metadata[ENTITY_METADATA_KEY]["key"] == "acme-holding"


def test_an_entity_needs_a_urn_or_a_key() -> None:
    # Without either the next scan would create the entity again.
    with pytest.raises(ValueError, match="urn"):
        Asset(id="a", entity=Entity(name="ACME"))


def test_blank_identifiers_are_dropped() -> None:
    entity = Entity(name="ACME", identifiers={"vat": " ", "": "x", "iban": " AT61 "})
    assert entity.identifiers == {"iban": "AT61"}


def test_bad_shapes_are_rejected_with_what_was_wanted() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        Entity(name="  ")
    with pytest.raises(ValueError, match="one of"):
        Entity(name="ACME", type="COMPANY")
    with pytest.raises(TypeError, match="label"):
        Entity(name="ACME", identifiers=["ATU12345678"])  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="list of names"):
        Entity(name="ACME", aliases="ACME Holding")
    with pytest.raises(TypeError, match="Entity"):
        Asset(id="a", urn="x://a", entity={"name": "ACME"})  # type: ignore[arg-type]
