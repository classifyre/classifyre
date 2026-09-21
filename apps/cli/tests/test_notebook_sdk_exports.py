"""The enums and evidence the notebook SDK promises are importable (GENESIS field report P11)."""

from __future__ import annotations

from src.graph.edges import EdgeClass, Ref, contains, references, same_as
from src.notebook.sdk import Context, build_module


def test_edge_enums_are_importable_from_classifyre() -> None:
    module = build_module(Context())
    for name in ("Method", "ReferenceType", "ContainmentType", "FieldTransform", "UsageType"):
        assert hasattr(module, name), name
        assert name in module.__all__
    assert module.Method("MANUAL") == "MANUAL"


def test_identity_and_reference_edges_carry_evidence() -> None:
    a, b = Ref.urn("region://de/ags/05315"), Ref.urn("http://data.europa.eu/nuts/code/DEA23")
    edge = same_as(
        a, b, method="MANUAL", confidence=0.9, evidence={"match": "alias", "checked_by": "hand"}
    )
    assert edge.edge_class == EdgeClass.IDENTITY
    assert edge.evidence == {"match": "alias", "checked_by": "hand"}
    assert edge.confidence == 0.9
    assert references(a, b, evidence={"why": "cites"}).evidence == {"why": "cites"}
    assert contains(a, b, evidence={"level": "Kreis"}).evidence == {"level": "Kreis"}


def test_defaults_are_unchanged() -> None:
    a, b = Ref.urn("x://a"), Ref.urn("x://b")
    assert same_as(a, b).evidence == {}
    assert references(a, b).confidence == same_as(a, b).confidence


def test_tag_is_importable_from_classifyre() -> None:
    # `Tag(value, severity=)` is how one detector covers a banded rule
    # (field report P9); it has to be importable and pre-bound like Asset.
    from src.notebook.sdk import Tag, namespace

    module = build_module(Context())
    assert module.Tag is Tag
    assert "Tag" in module.__all__
    assert namespace(Context())["Tag"] is Tag
