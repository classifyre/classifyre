"""The edge SDK's job is to make the two silent mistakes loud.

The silent mistakes are (a) filing a containment or reference relation as
lineage, which produces a graph that is technically correct and unreadable, and
(b) reversing an edge, which produces a lineage answer that is confidently
backwards. Neither raises on its own, so they are pinned here.
"""

from __future__ import annotations

import pytest

from src.graph import (
    ContainmentType,
    EdgeClass,
    FieldMapping,
    FieldTransform,
    FlowType,
    Method,
    Ref,
    ReferenceType,
    contains,
    flow,
    references,
    same_as,
    uses,
)


def payload(edge: object) -> dict:
    return edge.to_ingest().model_dump(mode="json", by_alias=True, exclude_none=True)  # type: ignore[attr-defined]


class TestDirection:
    def test_flow_points_the_way_data_moves(self) -> None:
        # The invariant every traversal depends on: from = upstream,
        # to = downstream, so the arrow on screen follows the data.
        edge = flow(upstream=Ref.asset("orders"), downstream=Ref.asset("top_deliveries"))
        assert (edge.frm.value, edge.to.value) == ("orders", "top_deliveries")
        wire = payload(edge)
        assert wire["fromHash"] == "orders"
        assert wire["toHash"] == "top_deliveries"

    def test_both_ends_are_keyword_only(self) -> None:
        # Reversal is the easiest mistake in the subject and the hardest to
        # notice later, so it must not be expressible positionally.
        with pytest.raises(TypeError):
            flow(Ref.asset("a"), Ref.asset("b"))  # type: ignore[misc]


class TestClassIsNotFreeText:
    def test_each_builder_fixes_its_own_class(self) -> None:
        assert flow(upstream=Ref.asset("a"), downstream=Ref.asset("b")).edge_class is EdgeClass.FLOW
        assert contains(Ref.asset("a"), Ref.asset("b")).edge_class is EdgeClass.CONTAINMENT
        assert same_as(Ref.asset("a"), Ref.asset("b")).edge_class is EdgeClass.IDENTITY
        assert references(Ref.asset("a"), Ref.asset("b")).edge_class is EdgeClass.REFERENCE
        assert uses(Ref.asset("a"), Ref.asset("b")).edge_class is EdgeClass.USAGE

    def test_a_foreign_key_is_not_lineage(self) -> None:
        # No data moves through a foreign key. It must never become a hop in a
        # lineage path, however useful it is for join suggestions.
        edge = references(
            Ref.asset("orders"), Ref.asset("customers"), type=ReferenceType.FOREIGN_KEY
        )
        assert edge.edge_class is EdgeClass.REFERENCE
        assert payload(edge)["relationClass"] == "REFERENCE"


class TestEndpoints:
    def test_a_urn_endpoint_is_normalized_on_the_way_out(self) -> None:
        edge = flow(
            upstream=Ref.urn("SNOWFLAKE://Acme/prod/public/raw_orders"),
            downstream=Ref.asset("orders"),
        )
        assert payload(edge)["fromUrn"] == "snowflake://acme/PROD/PUBLIC/RAW_ORDERS"

    def test_hash_and_urn_endpoints_use_different_wire_fields(self) -> None:
        wire = payload(flow(upstream=Ref.asset("h"), downstream=Ref.urn("s3://b/k")))
        assert wire["fromHash"] == "h"
        assert wire["toUrn"] == "s3://b/k"
        assert "fromUrn" not in wire and "toHash" not in wire

    def test_empty_endpoints_are_rejected_at_construction(self) -> None:
        with pytest.raises(ValueError):
            Ref.asset("   ")


class TestFieldMappings:
    def test_granularity_follows_the_presence_of_mappings(self) -> None:
        plain = flow(upstream=Ref.asset("a"), downstream=Ref.asset("b"))
        assert payload(plain)["granularity"] == "DATASET"
        detailed = flow(
            upstream=Ref.asset("a"),
            downstream=Ref.asset("b"),
            fields=[FieldMapping("delivery_time", ["placed_on", "delivered_on"])],
        )
        assert payload(detailed)["granularity"] == "FIELD"

    def test_a_mapping_with_no_output_column_is_indirect(self) -> None:
        # An ORDER BY column shapes which rows come out without feeding any
        # output column. Left as TRANSFORMED it would render as an arrow into
        # nothing; recorded once against the dataset it stays useful.
        mapping = FieldMapping(None, ["placed_on"])
        assert mapping.type is FieldTransform.INDIRECT

    def test_blank_upstream_names_are_dropped(self) -> None:
        assert FieldMapping("x", ["a", "  ", ""]).upstreams == ("a",)


class TestProvenance:
    def test_confidence_defaults_to_the_strength_of_the_method(self) -> None:
        observed = flow(
            upstream=Ref.asset("a"), downstream=Ref.asset("b"), method=Method.RUNTIME_OBSERVED
        )
        guessed = flow(upstream=Ref.asset("a"), downstream=Ref.asset("b"), method=Method.HEURISTIC)
        assert observed.confidence > guessed.confidence

    def test_explicit_confidence_wins_and_is_clamped(self) -> None:
        edge = flow(upstream=Ref.asset("a"), downstream=Ref.asset("b"), confidence=5.0)
        assert edge.confidence == 1.0

    def test_sql_is_carried_as_evidence(self) -> None:
        edge = flow(upstream=Ref.asset("a"), downstream=Ref.asset("b"), sql="SELECT 1")
        assert payload(edge)["evidence"] == {"sql": "SELECT 1"}


class TestBackCompat:
    def test_the_email_attachment_edge_is_unchanged_on_the_wire(self) -> None:
        # The one edge type that already exists in production. Its shape must
        # not move; it only gains a class.
        wire = payload(
            contains(Ref.asset("email"), Ref.asset("att"), type=ContainmentType.ATTACHED_TO)
        )
        assert wire["fromType"] == "asset"
        assert wire["fromHash"] == "email"
        assert wire["toHash"] == "att"
        assert wire["relationType"] == "ATTACHED_TO"
        assert wire["relationClass"] == "CONTAINMENT"

    def test_flow_subtypes_are_direction_neutral_nouns(self) -> None:
        # A verb would read backwards on an edge that points downstream.
        assert {str(t) for t in FlowType} == {
            "TRANSFORM",
            "VIEW",
            "COPY",
            "WRITE",
            "EXPORT",
            "SEND",
        }
