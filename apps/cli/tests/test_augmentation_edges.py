"""Augmentation edges: flow/same_as/Ref.urn, finalize() edges, periodic drain."""

from __future__ import annotations

from types import SimpleNamespace

from src.augmentation.session import EDGE_FLUSH_THRESHOLD, AugmentationSession
from src.graph.edges import Ref
from src.utils.hashing import hash_id
from tests.test_augmentation_session import FakeSource, _asset, _recipe

EDGES_NOTEBOOK = """from classifyre import FlowType, Ref, flow, references, same_as


def augment(asset):
    yield flow(
        upstream=Ref.urn("snowflake://acme/PROD/PUBLIC/ORDERS"),
        downstream=asset.ref,
        type=FlowType.COPY,
    )
    yield same_as(asset.ref, Ref("asset", "hash:other"))


def finalize():
    yield references(Ref("asset", "hash:a"), Ref("asset", "hash:b"))
"""


async def test_augment_and_finalize_edges_land_on_the_source() -> None:
    recipe = _recipe(EDGES_NOTEBOOK)
    source = FakeSource(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        await session.augment(_asset())
        assert len(source.edges) == 2
        await session.finish()
        assert len(source.edges) == 3
        assert session.stats.edges == 3
    finally:
        session.close()


class HashIdSource(FakeSource):
    source_type = "hashidsource"

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id("HASHIDSOURCE", asset_id)


def test_asset_ref_hash_is_not_hashed_again() -> None:
    recipe = _recipe("def augment(asset):\n    pass\n")
    source = HashIdSource(recipe)
    session = AugmentationSession(recipe, source)
    try:
        finished = hash_id("HASHIDSOURCE", "a")
        assert session._resolve_ref(Ref("asset", finished)).value == finished
        assert session._resolve_ref(Ref("asset", "a")).value == finished
    finally:
        session.close()


async def test_edge_burst_crosses_the_flush_threshold() -> None:
    recipe = _recipe(EDGES_NOTEBOOK)
    source = FakeSource(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        for index in range(EDGE_FLUSH_THRESHOLD // 2 + 1):
            asset = SimpleNamespace(
                hash=f"hash:n{index}",
                name=f"n{index}",
                asset_kind="record",
                external_url=f"fake://n{index}",
                links=[],
                urn=None,
                metadata={},
            )
            await session.augment(asset)
            if session.flush_requested:
                break
        assert session.flush_requested
        session.clear_flush_request()
        assert not session.flush_requested
    finally:
        session.close()


async def test_broken_edges_notebook_warns_but_keeps_metadata() -> None:
    recipe = _recipe(
        "def augment(asset):\n    asset.set('join_key', 'k')\n    yield 'not-an-edge'\n"
    )
    source = FakeSource(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        asset = _asset()
        await session.augment(asset)
        # The edge is dropped with a warning; the metadata still lands.
        assert asset.metadata["augmentation"] == {"join_key": "k"}
        assert source.edges == []
        assert session.warnings
    finally:
        session.close()
