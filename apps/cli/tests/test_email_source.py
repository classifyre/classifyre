from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from src.models.generated_single_asset_scan_results import AssetType
from src.sources.email.source import EmailSource


# ---------------------------------------------------------------------------
# Fakes for the imap_tools API
# ---------------------------------------------------------------------------
class FakeAtt:
    def __init__(
        self, filename, payload, content_type, content_id=None, content_disposition="attachment"
    ):
        self.filename = filename
        self.payload = payload
        self.content_type = content_type
        self.content_id = content_id
        self.content_disposition = content_disposition
        self.size = len(payload)
        self.part = None


class FakeMsg:
    def __init__(
        self,
        uid,
        subject,
        from_,
        to=(),
        cc=(),
        date=None,
        text="",
        html="",
        headers=None,
        attachments=None,
    ):
        self.uid = uid
        self.subject = subject
        self.from_ = from_
        self.to = to
        self.cc = cc
        self.bcc = ()
        self.reply_to = ()
        self.date = date or datetime(2026, 2, 1, 12, 0, tzinfo=UTC)
        self.text = text
        self.html = html
        self.headers = headers or {}
        self.attachments = attachments or []
        self.obj = {}


class FakeFolder:
    def set(self, name):
        return None

    def list(self):
        return []


class FakeMailBox:
    def __init__(self, messages):
        self._messages = messages
        self.folder = FakeFolder()

    def login(self, username, password, initial_folder="INBOX"):
        return self

    def logout(self):
        return None

    def fetch(self, criteria="ALL", mark_seen=True, bulk=False, reverse=False, limit=None, **_kw):
        msgs = list(self._messages)
        if reverse:
            msgs = list(reversed(msgs))
        if limit:
            msgs = msgs[:limit]
        return iter(msgs)


def _fake_module(mailbox):
    mod = MagicMock()
    mod.MailBox.return_value = mailbox
    mod.MailBoxUnencrypted.return_value = mailbox
    mod.AND = lambda **kw: ("AND", kw)
    return mod


@pytest.fixture
def email_recipe():
    return {
        "type": "EMAIL",
        "required": {"host": "imap.gmail.com", "port": 993},
        "masked": {"username": "you@gmail.com", "password": "app-pass"},
        "optional": {"scope": {"folders": ["INBOX"]}},
        "sampling": {"strategy": "LATEST"},
    }


def _sample_message():
    headers = {
        "message-id": ("<abc-123@mail.example.com>",),
        "authentication-results": ("mx.google.com; spf=pass; dkim=pass; dmarc=pass",),
        "in-reply-to": ("<parent@mail.example.com>",),
    }
    attachments = [
        FakeAtt(
            "photo.png",
            b"\x89PNG\r\n\x1a\nfakebytes",
            "image/png",
            content_id="cid1",
            content_disposition="inline",
        ),
        FakeAtt("data.bin", b"rawbinarydata", "application/octet-stream"),
    ]
    return FakeMsg(
        uid="42",
        subject="Quarterly report",
        from_="Alice <alice@example.com>",
        to=("bob@example.com",),
        cc=("carol@example.com",),
        text="Hello, please find attached.",
        html="<p>Hello, please find attached.</p>",
        headers=headers,
        attachments=attachments,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_email_test_connection_success(email_recipe):
    mailbox = FakeMailBox([])
    with patch("src.sources.email.source.require_module", return_value=_fake_module(mailbox)):
        source = EmailSource(email_recipe)
        result = source.test_connection()
    assert result["status"] == "SUCCESS"


def test_email_test_connection_failure(email_recipe):
    def boom(*_a, **_k):
        raise ConnectionError("auth failed")

    mod = MagicMock()
    mod.MailBox.side_effect = boom
    mod.MailBoxUnencrypted.side_effect = boom
    with patch("src.sources.email.source.require_module", return_value=mod):
        source = EmailSource(email_recipe)
        result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "auth failed" in result["message"]


def _fake_extract_file_metadata(file_bytes, mime_type, *, file_name=""):  # noqa: ARG001
    md = {"size_bytes": len(file_bytes), "mime_type": mime_type}
    if mime_type.startswith("image/"):
        md["image_width"] = 1
        md["image_height"] = 1
    return md


def _fake_resolve_mime(file_bytes, *, declared_mime_type=None, file_name=""):  # noqa: ARG001
    return declared_mime_type or "application/octet-stream"


async def _run_extract(source):
    assets = []
    async for batch in source.extract_raw():
        assets.extend(batch)
    return assets


@pytest.mark.asyncio
async def test_email_extract_emits_email_and_attachments(email_recipe):
    mailbox = FakeMailBox([_sample_message()])
    with (
        patch("src.sources.email.source.require_module", return_value=_fake_module(mailbox)),
        patch("src.sources.email.source.extract_file_metadata", _fake_extract_file_metadata),
        patch("src.sources.email.source.resolve_mime_type", _fake_resolve_mime),
    ):
        source = EmailSource(email_recipe)
        assets = await _run_extract(source)

    email_assets = [a for a in assets if a.asset_kind == "email"]
    attachment_assets = [a for a in assets if a.asset_kind == "attachment"]
    assert len(email_assets) == 1
    assert len(attachment_assets) == 2

    email = email_assets[0]
    # Relationship rule: the email links to every attachment hash.
    assert email.links == [a.hash for a in attachment_assets]
    assert email.asset_type == AssetType.TXT

    md = email.metadata
    assert md["message_id"] == "abc-123@mail.example.com"
    assert md["subject"] == "Quarterly report"
    assert md["from_address"] == "Alice <alice@example.com>"
    assert md["sender_domain"] == "example.com"
    assert md["attachment_count"] == 2
    assert md["has_html"] is True
    assert md["spf"] == "pass"
    assert md["dkim"] == "pass"
    assert md["dmarc"] == "pass"
    assert md["to_addresses"] == ["bob@example.com"]

    image = next(a for a in attachment_assets if a.name == "photo.png")
    assert image.asset_type == AssetType.IMAGE
    assert image.metadata["parent_email_hash"] == email.hash
    assert image.metadata["filename"] == "photo.png"
    assert image.metadata["size_bytes"] > 0
    assert image.metadata["is_inline"] is True
    assert image.metadata["image_width"] == 1
    assert "sha256" in image.metadata


@pytest.mark.asyncio
async def test_email_fetch_content_serves_cached_body_and_bytes(email_recipe):
    mailbox = FakeMailBox([_sample_message()])
    with (
        patch("src.sources.email.source.require_module", return_value=_fake_module(mailbox)),
        patch("src.sources.email.source.extract_file_metadata", _fake_extract_file_metadata),
        patch("src.sources.email.source.resolve_mime_type", _fake_resolve_mime),
    ):
        source = EmailSource(email_recipe)
        assets = await _run_extract(source)

        email = next(a for a in assets if a.asset_kind == "email")
        attachment = next(a for a in assets if a.asset_kind == "attachment")

        body = await source.fetch_content(email.hash)
        assert body is not None
        assert "please find attached" in body[1]

        # Lookup by external_url (the pipeline tries external_url first).
        content_bytes = await source.fetch_content_bytes(attachment.external_url)
        assert content_bytes is not None
        payload, _mime = content_bytes
        assert payload  # non-empty cached bytes

        # Eviction frees the cache.
        source.evict_asset_cache(attachment.hash)
        assert attachment.hash not in source._attachment_bytes_by_hash


def test_email_asset_type_from_mime():
    assert EmailSource._asset_type_from_mime("image/png") == AssetType.IMAGE
    assert EmailSource._asset_type_from_mime("text/csv") == AssetType.TABLE
    assert EmailSource._asset_type_from_mime("application/pdf") == AssetType.TXT
    assert EmailSource._asset_type_from_mime("text/plain") == AssetType.TXT
    assert EmailSource._asset_type_from_mime("application/octet-stream") == AssetType.BINARY


def test_email_in_asset_metadata_catalog():
    from src.sources.asset_metadata import load_catalog

    catalog = load_catalog()
    assert "EMAIL" in catalog["sources"]
    assert set(catalog["sources"]["EMAIL"].keys()) == {"email", "attachment"}
