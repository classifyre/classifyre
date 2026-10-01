"""Connector declarations of meaning (SL3 R6): ``Ref.term``, ``means()`` and
``asset.means()``.

A declaration is only useful if it reaches the API as a ``term://`` URN the
graph resolves against glossary keys, so the URN form is pinned here and in
``apps/api/src/graph/urn.spec.ts``.
"""

from __future__ import annotations

import pytest

from src.augmentation.sdk import AugmentedAsset
from src.graph import EdgeClass, Method, Ref, means
from src.graph.edges import edge_from_payload, edge_to_payload
from src.utils.urn import Urn, UrnError, normalize_urn


class TestTermRef:
    def test_builds_a_term_urn(self) -> None:
        assert Ref.term("gmbh") == Ref("urn", "term://glossary/gmbh")

    def test_folds_case_and_whitespace(self) -> None:
        assert Ref.term("  GmbH ") == Ref("urn", "term://glossary/gmbh")
        assert normalize_urn("TERM://Glossary/Bank-Account-IBAN") == (
            "term://glossary/bank-account-iban"
        )

    @pytest.mark.parametrize("key", ["", "-gmbh", "gmbh ag", "ümlaut", "a" * 101, "x/y"])
    def test_rejects_keys_outside_c8(self, key: str) -> None:
        with pytest.raises(ValueError):
            Ref.term(key)
        with pytest.raises(UrnError):
            Urn.term(key)

    def test_misspelt_constructor_points_at_ref_term(self) -> None:
        with pytest.raises(AttributeError, match=r"Ref\.term"):
            Ref.concept  # type: ignore[attr-defined]  # noqa: B018


class TestMeans:
    def test_is_a_means_reference_from_the_subject_to_the_term(self) -> None:
        edge = means(
            Ref.asset("fn-606601k"),
            Ref.term("gmbh"),
            evidence={"field": "Rechtsform", "value": "GES"},
        )
        assert edge.edge_class is EdgeClass.REFERENCE
        assert edge.relation_type == "MEANS"
        assert edge.method is Method.SYSTEM_CATALOG
        assert edge.frm == Ref.asset("fn-606601k")
        assert edge.to.value == "term://glossary/gmbh"
        assert edge.evidence == {"field": "Rechtsform", "value": "GES"}

    def test_accepts_a_bare_key(self) -> None:
        assert means(Ref.asset("a"), "euid").to == Ref.term("euid")

    def test_refuses_anything_but_a_term(self) -> None:
        with pytest.raises(ValueError, match="glossary term"):
            means(Ref.asset("a"), Ref.asset("b"))

    def test_confidence_override(self) -> None:
        assert means(Ref.asset("a"), "gmbh", confidence=0.4).confidence == 0.4

    def test_survives_the_notebook_boundary(self) -> None:
        edge = means(Ref.asset("a"), Ref.term("gmbh"))
        assert edge_from_payload(edge_to_payload(edge)) == edge

    def test_ingests_as_a_to_urn(self) -> None:
        ingest = means(Ref.asset("a"), Ref.term("gmbh")).to_ingest()
        assert ingest.to_urn == "term://glossary/gmbh"
        assert ingest.relation_type == "MEANS"
        assert ingest.relation_class == "REFERENCE"


class TestAugmentedAssetMeans:
    def _asset(self) -> AugmentedAsset:
        return AugmentedAsset(hash="abc123", name="FN 606601k")

    def test_stages_a_declaration_in_the_patch(self) -> None:
        asset = self._asset()
        asset.means("gmbh", evidence={"field": "Rechtsform"})
        asset.means("gmbh", evidence={"field": "Rechtsform"})  # idempotent
        patch = asset.patch()
        assert len(patch["means"]) == 1
        declared = edge_from_payload(patch["means"][0])
        assert declared.frm == Ref.asset("abc123")
        assert declared.to == Ref.term("gmbh")
        assert declared.relation_type == "MEANS"

    def test_an_invalid_key_is_a_warning_not_an_error(self) -> None:
        asset = self._asset()
        asset.means("not a key")
        patch = asset.patch()
        assert patch["means"] == []
        assert any("asset.means" in warning for warning in patch["warnings"])
