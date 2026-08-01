"""Byte-valued fields must stay readable, whichever source produced them.

Every source hands rows and documents to text detectors as strings, so each one
has to turn byte-valued fields into text. Two ways of doing that are wrong and
both were in the tree:

* ``str(value)`` emits a Python repr — ``b'{"email": ...}'`` — so quotes arrive
  escaped and newlines arrive spelled out as ``\\n``.
* a flat ``<N bytes>`` summary drops the content, so text stored in a BLOB, a
  BSON ``Binary`` or a byte-array property was never read by any detector.

These are family-wide guards: the rendering lives in one helper, and a regression
in it silently blinds every source at once.
"""

from __future__ import annotations

import json

import pytest

from src.utils.file_parser import is_readable_text, json_safe_default, render_bytes_cell

TEXT_DOC = b"Contact Grace at grace@example.com about invoice 4471."
JSON_DOC = b'{"name": "Ada Lovelace", "email": "ada@example.com"}'
MULTILINE = b"Dear Grace,\n\nInvoice 4471 is overdue.\nContact ada@example.com\n"
JUNK = b"\x01\x02\x03\x04\x05\x06"
PNG_HEADER = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"


# ── The shared helper ────────────────────────────────────────────────────


def test_is_readable_text_separates_documents_from_blobs() -> None:
    assert is_readable_text(TEXT_DOC)
    assert is_readable_text(JSON_DOC)
    assert is_readable_text(MULTILINE)
    # Control bytes decode as valid UTF-8, so a successful decode proves nothing.
    assert not is_readable_text(JUNK)
    assert not is_readable_text(PNG_HEADER)
    assert not is_readable_text(b"")


def test_is_readable_text_accepts_utf16() -> None:
    """UTF-16 interleaves a NUL with every character and is still text."""
    assert is_readable_text(TEXT_DOC.decode().encode("utf-16"))


def test_render_bytes_cell_decodes_text_and_summarizes_binary() -> None:
    assert render_bytes_cell(TEXT_DOC) == TEXT_DOC.decode()
    assert render_bytes_cell(JSON_DOC) == JSON_DOC.decode()
    assert render_bytes_cell(JUNK) == "<6 bytes>"
    assert render_bytes_cell(b"") == "<0 bytes>"


def test_render_bytes_cell_never_emits_a_python_repr() -> None:
    rendered = render_bytes_cell(MULTILINE)
    assert not rendered.startswith("b'")
    assert "\\n" not in rendered  # newlines stayed newlines
    assert rendered.count("\n") == MULTILINE.decode().count("\n")


def test_json_safe_default_keeps_byte_fields_readable() -> None:
    encoded = json.dumps({"payload": JSON_DOC}, default=json_safe_default)
    assert json.loads(encoded)["payload"] == JSON_DOC.decode()
    assert json.loads(json.dumps({"v": JUNK}, default=json_safe_default))["v"] == "<6 bytes>"


# ── Per-source wiring ────────────────────────────────────────────────────


def test_sql_family_serializes_byte_cells_as_text() -> None:
    """Covers postgresql, mysql, mssql, sqlite and hive through the shared base."""
    from src.sources.tabular_base import BaseTabularSource

    serialize = BaseTabularSource._serialize_cell
    assert serialize(None, JSON_DOC) == JSON_DOC.decode()
    assert serialize(None, bytearray(TEXT_DOC)) == TEXT_DOC.decode()
    # psycopg hands BYTEA back as a memoryview.
    assert serialize(None, memoryview(TEXT_DOC)) == TEXT_DOC.decode()
    assert serialize(None, JUNK) == "<6 bytes>"
    assert serialize(None, None) == "null"


@pytest.mark.parametrize(
    ("module_path", "class_name"),
    [
        ("src.sources.oracle.source", "OracleSource"),
        ("src.sources.databricks.source", "DatabricksSource"),
        ("src.sources.snowflake.source", "SnowflakeSource"),
    ],
)
def test_dialect_overrides_serialize_byte_cells_as_text(module_path: str, class_name: str) -> None:
    """These three override _serialize_cell, so the base fix does not reach them."""
    module = pytest.importorskip(module_path)
    source_class = getattr(module, class_name)

    assert source_class._serialize_cell(None, TEXT_DOC) == TEXT_DOC.decode()
    assert source_class._serialize_cell(None, JUNK) == "<6 bytes>"


def test_mongodb_binary_field_is_not_a_repr() -> None:
    """A BSON Binary subclasses bytes, so default=str rendered its repr.

    Asserted on plain bytes so the guard runs without pymongo installed — that is
    the same branch ``json_safe_default`` takes for a ``Binary`` — and again on a
    real ``Binary`` wherever the optional driver is available.
    """
    from src.sources.mongodb.source import MongoDBSource

    payloads = [JSON_DOC]
    try:
        from bson import Binary

        payloads.append(Binary(JSON_DOC))
    except ImportError:
        pass

    for payload in payloads:
        document = json.loads(MongoDBSource._serialize_document(None, {"payload": payload}))
        assert document["payload"] == JSON_DOC.decode()
        assert "b'" not in document["payload"]


def test_neo4j_byte_array_property_is_not_a_repr() -> None:
    from src.sources.neo4j.source import Neo4jSource

    node = json.loads(Neo4jSource._serialize_node(None, {"blob": bytearray(TEXT_DOC)}))

    assert node["blob"] == TEXT_DOC.decode()
    assert "bytearray(" not in node["blob"]


def test_kafka_summarizes_binary_payloads_instead_of_control_characters() -> None:
    """Regression: the old UnicodeDecodeError fallback never fired for control
    bytes, which are valid UTF-8, so binary messages emitted raw control chars."""
    from src.sources.kafka.source import KafkaSource

    assert KafkaSource._decode(TEXT_DOC) == TEXT_DOC.decode()
    assert KafkaSource._decode(JUNK) == "<6 bytes>"
    assert KafkaSource._decode(None) == "null"
