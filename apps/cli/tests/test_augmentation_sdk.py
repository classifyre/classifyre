"""AugmentedAsset: reads, lazy payload, and additive writers — no child needed."""

from __future__ import annotations

import pytest

from src.augmentation.sdk import AugmentedAsset


def _asset(**overrides) -> AugmentedAsset:
    base = {
        "hash": "abc123",
        "id": "orders-1",
        "name": "orders",
        "kind": "table",
        "url": "postgres://db/orders",
        "source_type": "POSTGRESQL",
        "metadata": {"table_name": "orders"},
    }
    base.update(overrides)
    return AugmentedAsset(**base)


def test_reads_expose_the_connector_asset() -> None:
    asset = _asset()
    assert asset.hash == "abc123"
    assert asset.id == "orders-1"
    assert asset.name == "orders"
    assert asset.kind == "table"
    assert asset.url == "postgres://db/orders"
    assert asset.urn is None
    assert asset.source_type == "POSTGRESQL"
    assert asset.ref.value == "abc123"
    assert dict(asset.metadata) == {"table_name": "orders"}


def test_metadata_view_is_read_only() -> None:
    asset = _asset()
    with pytest.raises(TypeError):
        asset.metadata["table_name"] = "hijacked"  # type: ignore[index]


def test_requires_a_hash() -> None:
    with pytest.raises(ValueError):
        AugmentedAsset(hash="")


def test_set_tags_link_urn_stage_a_patch() -> None:
    asset = _asset()
    asset.set("join_key", "customer:42")
    asset.tag("legal_hold", "retained")
    asset.tag("legal_hold", "second-value")
    asset.link("hash:two")
    asset.link("hash:two")
    asset.set_urn("snowflake://acme/PROD/PUBLIC/ORDERS")
    patch = asset.patch()
    assert patch["metadata"] == {"join_key": "customer:42"}
    assert patch["tags"] == {"legal_hold": "retained, second-value"}
    assert patch["links"] == ["hash:two"]
    assert patch["urn"] == "snowflake://acme/PROD/PUBLIC/ORDERS"


def test_empty_writes_are_warnings_not_errors() -> None:
    asset = _asset()
    asset.set("", "x")
    asset.tag("", "x")
    asset.tag("k", "")
    asset.link("")
    asset.set_urn("")
    patch = asset.patch()
    assert patch == {
        "metadata": {},
        "tags": {},
        "links": [],
        "urn": None,
        "warnings": asset.warnings,
    }
    assert len(asset.warnings) == 5


def test_non_json_values_and_bad_urns_are_rejected() -> None:
    asset = _asset()
    asset.set("bad", object())
    asset.set_urn("not a urn !!!")
    patch = asset.patch()
    assert patch["metadata"] == {}
    assert patch["urn"] is None
    assert len(asset.warnings) == 2


def test_lazy_accessors_memoize_one_fetch_each() -> None:
    calls: list[str] = []

    def need(op: str):
        calls.append(op)
        if op == "payload":
            return {"bytes_b64": "aGVsbG8=", "mime": "text/plain"}
        if op == "raw_pages":
            return {"pages": ['{"a": 1}', '{"a": 2}']}
        if op == "text":
            return {"text": "hello", "pages": ["hello"]}
        raise AssertionError(op)

    asset = AugmentedAsset(hash="h", need=need)
    assert asset.payload() == b"hello"
    assert asset.payload() == b"hello"
    assert list(asset.rows()) == [{"a": 1}, {"a": 2}]
    assert asset.text() == "hello"
    assert asset.pages() == ["hello"]
    assert sorted(set(calls)) == ["payload", "raw_pages", "text"]
    assert calls.count("payload") == 1


def test_rows_parses_json_lines_and_arrays() -> None:
    asset = AugmentedAsset(
        hash="h",
        need=lambda _op: {"pages": ['{"a": 1}\n{"b": 2}', '[{"c": 3}, 4, "x"]']},
    )
    assert list(asset.rows()) == [{"a": 1}, {"b": 2}, {"c": 3}]


def test_rows_empty_when_not_records() -> None:
    asset = AugmentedAsset(hash="h", need=lambda _op: {"pages": ["<p>hi</p>"]})
    assert list(asset.rows()) == []


def test_no_fetcher_means_empty_payload() -> None:
    asset = _asset()
    assert asset.payload() is None
    assert asset.raw_pages() == []
    assert list(asset.rows()) == []
    assert asset.text() == ""
    assert asset.pages() == []


def test_fetcher_errors_degrade_to_warnings() -> None:
    def need(_op: str):
        raise RuntimeError("gone")

    asset = AugmentedAsset(hash="h", need=need)
    assert asset.payload() is None
    assert asset.warnings
    # Memoized: the failure is not retried on the next call.
    assert asset.payload() is None
