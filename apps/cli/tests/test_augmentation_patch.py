"""apply_patch is the single place that writes, and it is additive only.

These run without a child process: the patch shape is what the child sends,
and enforcement lives parent-side precisely so it does not depend on the child
behaving.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from src.augmentation.session import AugmentationSession


class _StubSource:
    source_type = "postgresql"

    def __init__(self) -> None:
        self.tags: dict[str, dict[str, str]] = {}
        self.edges: list[Any] = []

    def record_augmentation_tags(self, asset_hash: str, tags: dict[str, str]) -> None:
        merged = dict(self.tags.get(asset_hash, {}))
        merged.update(tags)
        self.tags[asset_hash] = merged

    def add_edges(self, edges: Any) -> None:
        self.edges.extend(edges)

    def generate_hash_id(self, asset_id: str) -> str:
        return f"hash:{asset_id}"


def _asset(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "hash": "abc123",
        "name": "orders",
        "asset_kind": "table",
        "external_url": "postgres://db/orders",
        "links": [],
        "urn": None,
        "metadata": {"table_name": "orders", "database": "prod"},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _session(source: _StubSource | None = None) -> AugmentationSession:
    recipe = {"type": "POSTGRESQL", "augmentation": {"enabled": False}}
    return AugmentationSession(recipe, source or _StubSource())


def test_metadata_lands_only_under_augmentation() -> None:
    asset = _asset()
    _session().apply_patch(asset, {"metadata": {"join_key": "customer:42"}})
    assert asset.metadata == {
        "table_name": "orders",
        "database": "prod",
        "augmentation": {"join_key": "customer:42"},
    }


def test_connector_metadata_keys_are_untouched() -> None:
    asset = _asset()
    _session().apply_patch(asset, {"metadata": {"table_name": "hijacked", "database": "hijacked"}})
    # Connector keys are structurally unreachable: apply_patch only writes
    # inside the augmentation namespace, so even a patch that names them
    # cannot move them.
    assert asset.metadata["table_name"] == "orders"
    assert asset.metadata["database"] == "prod"
    assert asset.metadata["augmentation"] == {
        "table_name": "hijacked",
        "database": "hijacked",
    }


def test_structural_fields_are_unreachable() -> None:
    asset = _asset()
    _session().apply_patch(
        asset,
        {
            "hash": "forged",
            "name": "forged",
            "checksum": "forged",
            "content": "forged",
            "metadata": {"join_key": "k"},
        },
    )
    assert asset.hash == "abc123"
    assert asset.name == "orders"
    assert not hasattr(asset, "checksum") or getattr(asset, "checksum", None) != "forged"
    assert getattr(asset, "content", None) != "forged"


def test_tags_are_recorded_on_the_source() -> None:
    source = _StubSource()
    _session(source).apply_patch(asset := _asset(), {"tags": {"legal_hold": "retained"}})
    assert source.tags == {"abc123": {"legal_hold": "retained"}}
    # Tags are not asset fields: they travel to the pipeline's tag pass.
    assert not hasattr(asset, "tags") or getattr(asset, "tags", None) in (None, {})


def test_links_append_deduplicated() -> None:
    asset = _asset(links=["hash:one"])
    _session().apply_patch(asset, {"links": ["hash:one", "hash:two"]})
    assert asset.links == ["hash:one", "hash:two"]


def test_urn_set_only_when_empty() -> None:
    bare = _asset()
    _session().apply_patch(bare, {"urn": "snowflake://acme/PROD/PUBLIC/ORDERS"})
    assert bare.urn == "snowflake://acme/PROD/PUBLIC/ORDERS"

    owned = _asset(urn="postgres://db/prod/orders")
    _session().apply_patch(owned, {"urn": "snowflake://acme/PROD/PUBLIC/ORDERS"})
    assert owned.urn == "postgres://db/prod/orders"


def test_invalid_urn_ignored_with_warning() -> None:
    session = _session()
    asset = _asset()
    session.apply_patch(asset, {"urn": "not a urn at all !!!"})
    assert asset.urn is None
    assert session.warnings, "expected a warning for the invalid URN"


def test_non_json_metadata_ignored_with_warning() -> None:
    session = _session()
    asset = _asset()
    session.apply_patch(asset, {"metadata": {"ok": 1, "bad": object()}})
    assert asset.metadata["augmentation"] == {"ok": 1}
    assert session.warnings


def test_malformed_patch_ignored_with_warning() -> None:
    session = _session()
    asset = _asset()
    before = dict(asset.metadata)
    session.apply_patch(asset, "garbage")
    session.apply_patch(asset, None)
    assert asset.metadata == before
    assert session.warnings


def test_edges_resolve_connector_ids_to_hashes() -> None:
    from src.graph.edges import FlowType, Ref, edge_to_payload, flow

    source = _StubSource()
    session = _session(source)
    asset = _asset()
    payload = edge_to_payload(
        flow(
            upstream=Ref("asset", "abc123"), downstream=Ref("asset", "orders-2"), type=FlowType.COPY
        )
    )
    session.apply_patch(asset, {"edges": [payload]})
    assert len(source.edges) == 1
    assert session.stats.edges == 1


def test_malformed_edges_ignored_with_warning() -> None:
    session = _session()
    session.apply_patch(_asset(), {"edges": [{"class": "LINEAGE"}]})
    session.apply_patch(_asset(), {"edges": "not-a-list"})
    assert session.warnings
