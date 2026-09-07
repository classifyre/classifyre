"""Augmentation sessions against a real child process.

Spawning ``python -m src.augmentation.runner`` per test costs ~a second, so
each test below earns its process: the pure-enforcement cases live in
test_augmentation_patch.py (no child), and these prove the wire — handshake,
augment round trip, lazy need/provide, setup/finalize, timeouts, and the
circuit breaker.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

from src.augmentation.session import AugmentationSession
from src.sources.base import BaseSource

TAG_NOTEBOOK = """from classifyre import FlowType, Ref, flow


def setup():
    ctx.state["prefix"] = "customer"


def augment(asset):
    asset.set("join_key", f"{ctx.state['prefix']}:{asset.metadata.get('customer_id', '?')}")
    if asset.metadata.get("hold"):
        asset.tag("legal_hold", "retained")
    asset.link("hash:other")
    yield flow(upstream=Ref.urn("snowflake://acme/PROD/PUBLIC/ORDERS"), downstream=asset.ref, type=FlowType.COPY)


def finalize():
    yield flow(
        upstream=Ref("asset", "hash:a"),
        downstream=Ref("asset", "hash:b"),
        type=FlowType.COPY,
    )
"""

PAYLOAD_NOTEBOOK = """def augment(asset):
    raw = asset.payload()
    asset.set("payload_len", len(raw) if raw else -1)
    asset.set("row_count", len(list(asset.rows())))
    asset.set("text_len", len(asset.text()))
"""


class FakeSource(BaseSource):
    source_type = "fakesource"

    def __init__(self, recipe: dict[str, Any]) -> None:
        super().__init__(recipe)
        self.tags: dict[str, dict[str, str]] = {}
        self.edges: list[Any] = []
        self.bytes_reads = 0
        self.pages_reads = 0

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS", "message": "fake"}

    async def extract_raw(self) -> AsyncGenerator[list[Any], None]:
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return f"hash:{asset_id}"

    def abort(self) -> None:
        super().abort()

    def record_augmentation_tags(self, asset_hash: str, tags: Any) -> None:
        merged = dict(self.tags.get(asset_hash, {}))
        merged.update(tags)
        self.tags[asset_hash] = merged

    def add_edges(self, edges: Any) -> None:
        # Honor the BaseSource contract (buffer for drain_edges) and record
        # for assertions.
        super().add_edges(edges)
        self.edges.extend(edges if isinstance(edges, list) else list(edges or []))

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        self.bytes_reads += 1
        return b'{"customer_id": 7}', "application/json"

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        self.pages_reads += 1
        yield ('{"customer_id": 7}', "customer 7")


def _recipe(notebook: str, **overrides: Any) -> dict[str, Any]:
    augmentation: dict[str, Any] = {
        "enabled": True,
        "notebook": {
            "revision": 1,
            "cells": [{"id": "nb", "type": "code", "source": notebook}],
        },
        "variables": {},
        "secrets": {},
    }
    augmentation.update(overrides)
    return {
        "type": "FAKESOURCE",
        "sampling": {"strategy": "ALL"},
        "augmentation": augmentation,
    }


def _source(recipe: dict[str, Any]) -> FakeSource:
    return FakeSource(recipe)


def _asset(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "hash": "hash:a",
        "name": "a",
        "asset_kind": "record",
        "external_url": "fake://a",
        "links": [],
        "urn": None,
        "metadata": {"customer_id": 7},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


async def _run(notebook: str, asset: SimpleNamespace, recipe_overrides: dict | None = None):
    recipe = _recipe(notebook, **(recipe_overrides or {}))
    source = _source(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    source.attach_augmentation(session)
    try:
        await session.startup()
        await session.augment(asset)
        await session.finish()
    finally:
        session.close()
    return source, session


async def test_augment_applies_metadata_tags_links_and_edges() -> None:
    asset = _asset()
    source, session = await _run(TAG_NOTEBOOK, asset)
    assert asset.metadata["augmentation"] == {"join_key": "customer:7"}
    # The hold flag is unset on this asset, so no tag (covered below).
    assert source.tags == {}
    assert asset.links == ["hash:other"]
    # one edge from augment() + one from finalize()
    assert len(source.edges) == 2
    assert session.stats.assets_augmented == 1


async def test_tag_asserted_when_condition_holds() -> None:
    asset = _asset(metadata={"customer_id": 7, "hold": True})
    source, _ = await _run(TAG_NOTEBOOK, asset)
    assert source.tags == {"hash:a": {"legal_hold": "retained"}}


async def test_lazy_payload_served_once_and_memoized() -> None:
    recipe = _recipe(PAYLOAD_NOTEBOOK)
    source = _source(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        asset = _asset()
        await session.augment(asset)
        added = asset.metadata["augmentation"]
        assert added["payload_len"] == len(b'{"customer_id": 7}')
        assert added["row_count"] == 1
        assert added["text_len"] == len("customer 7")
        # One fetch per lazy op: bytes once, raw pages once, text pages once.
        assert source.bytes_reads == 1
        assert source.pages_reads == 2
        # A second augment() over the same asset reuses the memo: the source
        # is read once per op, not once per asset processing.
        await session.augment(_asset())
        assert source.bytes_reads == 1
        assert source.pages_reads == 2
    finally:
        session.close()


async def test_raising_notebook_leaves_asset_unchanged() -> None:
    asset = _asset()
    before = dict(asset.metadata)
    source, session = await _run("def augment(asset):\n    raise RuntimeError('boom')\n", asset)
    assert asset.metadata == before
    assert asset.links == []
    assert source.tags == {}
    assert source.edges == []
    assert session.stats.assets_failed == 1
    assert session.warnings, "a warning must record the failure"


async def test_timeout_disables_nothing_but_warns_and_continues() -> None:
    asset = _asset()
    before = dict(asset.metadata)
    _source, session = await _run(
        "import time\ndef augment(asset):\n    time.sleep(5)\n",
        asset,
        {"limits": {"per_asset_timeout_seconds": 1}},
    )
    assert asset.metadata == before
    assert session.stats.assets_failed == 1
    assert any("timed out" in w for w in session.warnings)


async def test_consecutive_failures_trip_the_circuit_breaker() -> None:
    recipe = _recipe(
        "def augment(asset):\n    raise RuntimeError('always')\n",
        limits={"max_consecutive_failures": 3},
    )
    source = _source(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        for _ in range(5):
            await session.augment(_asset())
        assert not session.enabled
        assert session.stats.assets_failed == 3
        assert any("consecutive" in w for w in session.warnings)
    finally:
        session.close()


async def test_missing_augment_disables_the_run() -> None:
    recipe = _recipe("def setup():\n    pass\n")
    source = _source(recipe)
    session = AugmentationSession.from_recipe(recipe, source)
    assert session is not None
    try:
        await session.startup()
        assert not session.enabled
        asset = _asset()
        await session.augment(asset)
        assert asset.metadata == {"customer_id": 7}
    finally:
        session.close()


async def test_disabled_recipe_builds_no_session() -> None:
    recipe = {"type": "FAKESOURCE", "sampling": {"strategy": "ALL"}}
    assert AugmentationSession.from_recipe(recipe, _source(recipe)) is None
    off = {
        "type": "FAKESOURCE",
        "sampling": {"strategy": "ALL"},
        "augmentation": {"enabled": False},
    }
    assert AugmentationSession.from_recipe(off, _source(off)) is None


async def test_isolation_scrubbed_env_and_secret_redaction() -> None:
    from src.notebook.redact import Redactor
    from src.sources.custom.env import leaked_keys, scrubbed_environment

    assert leaked_keys(scrubbed_environment()) == []
    redactor = Redactor.from_recipe(
        {"masked": {}, "augmentation": {"secrets": {"token": "aug-token-abc123"}}}
    )
    assert redactor.redact("leaked aug-token-abc123 here") == "leaked •••• here"
