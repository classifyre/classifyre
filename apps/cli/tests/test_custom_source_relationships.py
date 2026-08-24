"""A notebook's relationships, from the SDK call to the wire.

The translation being pinned is the one an author must never have to think
about: a notebook names things by *its own* ids, and the graph needs hashes —
except for a ``Ref.urn(...)``, which names something in another system and must
survive untouched, because hashing it would destroy the only thing that can
ever resolve it.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.graph.edges import edge_to_payload
from src.notebook.contract import OPTIONAL_FUNCTIONS, validate_notebook
from src.notebook.sdk import Context, iter_relationships, namespace


def _run_notebook(code: str) -> list[dict[str, Any]]:
    """Execute a notebook body and return what ``relationships()`` produced."""
    globals_ = namespace(Context())
    exec(compile(code, "notebook.py", "exec"), globals_)
    return [edge_to_payload(edge) for edge in iter_relationships(globals_["relationships"]())]


NOTEBOOK = """
def relationships():
    yield flow(
        upstream=Ref.asset("orders"),
        downstream=Ref.asset("top_deliveries"),
        type=FlowType.TRANSFORM,
        fields=[
            FieldMapping("delivery_time", ["placed_on", "delivered_on"],
                         "DATEDIFF(placed_on, delivered_on)"),
            FieldMapping(None, ["placed_on"]),
        ],
        sql="SELECT ... ORDER BY placed_on",
    )
    yield flow(
        upstream=Ref.urn(urn_for("snowflake", "acme", "PROD", "PUBLIC", "RAW_ORDERS")),
        downstream=Ref.asset("orders"),
        type=FlowType.COPY,
    )
    yield contains(Ref.asset("orders"), Ref.asset("orders_2024"))
    yield references(Ref.asset("orders"), Ref.asset("customers"))
"""


class TestTheContract:
    def test_relationships_is_an_optional_contract_function(self) -> None:
        # Optional, not required: a connector that has nothing to say about how
        # its assets relate is still a perfectly good connector.
        assert "relationships" in OPTIONAL_FUNCTIONS

    def test_a_notebook_without_it_still_validates(self) -> None:
        cells = [
            {"id": "a", "type": "code", "source": "def test_connection():\n    return {}"},
            {"id": "b", "type": "code", "source": "def extract():\n    return []"},
        ]
        assert validate_notebook(cells).ok

    def test_defining_it_is_visible_to_the_adapter(self) -> None:
        # This is what lets the adapter skip a subprocess round trip for the
        # ordinary notebook that never declares any.
        cells = [
            {"id": "a", "type": "code", "source": "def test_connection():\n    return {}"},
            {"id": "b", "type": "code", "source": "def extract():\n    return []"},
            {"id": "c", "type": "code", "source": "def relationships():\n    return []"},
        ]
        assert "relationships" in validate_notebook(cells).defined_functions


class TestWhatANotebookCanExpress:
    def test_each_builder_produces_its_own_class(self) -> None:
        classes = [edge["class"] for edge in _run_notebook(NOTEBOOK)]
        assert classes == ["FLOW", "FLOW", "CONTAINMENT", "REFERENCE"]

    def test_lineage_points_the_way_the_data_moves(self) -> None:
        edge = _run_notebook(NOTEBOOK)[0]
        assert edge["from"]["value"] == "orders"
        assert edge["to"]["value"] == "top_deliveries"

    def test_column_mappings_survive_the_subprocess_boundary(self) -> None:
        fields = _run_notebook(NOTEBOOK)[0]["fields"]
        derived = next(f for f in fields if f["downstream"] == "delivery_time")
        assert derived["upstreams"] == ["placed_on", "delivered_on"]
        assert derived["transform"] == "DATEDIFF(placed_on, delivered_on)"

    def test_an_order_by_column_becomes_an_indirect_dependency(self) -> None:
        fields = _run_notebook(NOTEBOOK)[0]["fields"]
        indirect = next(f for f in fields if f["downstream"] is None)
        assert indirect["type"] == "INDIRECT"

    def test_a_cross_system_upstream_is_kept_as_a_urn(self) -> None:
        edge = _run_notebook(NOTEBOOK)[1]
        assert edge["from"]["kind"] == "urn"
        assert edge["from"]["value"] == "snowflake://acme/PROD/PUBLIC/RAW_ORDERS"

    def test_urn_for_folds_the_way_the_owning_connector_does(self) -> None:
        # Same helper, same rules — which is the only reason the two ever meet.
        globals_ = namespace(Context())
        assert globals_["urn_for"]("SNOWFLAKE", "AcMe", "prod", "public", "orders") == (
            "snowflake://acme/PROD/PUBLIC/ORDERS"
        )


class TestGuardrails:
    def test_a_raw_dict_is_rejected(self) -> None:
        # The whole value of the builders is that the author had to choose a
        # class. Accepting a dict would put it back into free text.
        with pytest.raises(TypeError, match="flow\\(\\)"):
            list(iter_relationships([{"from": "a", "to": "b"}]))

    def test_reversing_a_flow_edge_is_not_expressible_positionally(self) -> None:
        globals_ = namespace(Context())
        with pytest.raises(TypeError):
            globals_["flow"](globals_["Ref"].asset("a"), globals_["Ref"].asset("b"))

    def test_a_single_edge_does_not_have_to_be_wrapped_in_a_list(self) -> None:
        globals_ = namespace(Context())
        edge = globals_["contains"](globals_["Ref"].asset("a"), globals_["Ref"].asset("b"))
        assert len(list(iter_relationships(edge))) == 1


class TestAdapterTranslation:
    def test_notebook_ids_become_hashes_and_urns_pass_through(self) -> None:
        from src.graph.edges import Ref
        from src.sources.custom.source import CustomSource

        resolve = CustomSource._resolve_ref
        fake = type("F", (), {"generate_hash_id": lambda _self, value: f"hash::{value}"})()

        assert resolve(fake, Ref.asset("ticket-1")) == Ref("asset", "hash::ticket-1")
        # Untouched: hashing a URN would destroy the one thing that resolves it.
        urn = Ref.urn("s3://bucket/key.csv")
        assert resolve(fake, urn) == urn
