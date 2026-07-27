"""Tests for the slack_sdk-backed Slack source.

The WebClient is faked rather than mocked at the HTTP layer: slack_sdk lives in an
optional dependency group, so these tests must not require it to be installed.
``SlackSource._build_client`` is the single seam where the real client is created.
"""

from __future__ import annotations

from typing import Any, ClassVar

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.slack.source import SlackSource
from src.utils.hashing import unhash_id


class FakeResponse:
    """Stands in for slack_sdk's SlackResponse (only `.data` is consumed)."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data


class FakeWebClient:
    """Records calls and replays queued payloads per Slack method."""

    def __init__(self, payloads: dict[str, Any] | None = None) -> None:
        self.retry_handlers: list[Any] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._payloads = payloads or {}

    def _respond(self, method: str, **params: Any) -> FakeResponse:
        self.calls.append((method, params))
        payload = self._payloads.get(method)
        if payload is None:
            raise AssertionError(f"Unexpected Slack method: {method}")
        if callable(payload):
            payload = payload(**params)
        elif isinstance(payload, list):
            payload = payload.pop(0) if payload else {"ok": True}

        payload = dict(payload)
        # Slack never returns more items than the requested `limit`; honouring it
        # here is what makes page-size assertions meaningful.
        limit = params.get("limit")
        if isinstance(limit, int):
            for key in ("messages", "channels"):
                if isinstance(payload.get(key), list) and len(payload[key]) > limit:
                    payload[key] = payload[key][:limit]
        return FakeResponse(payload)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)

        def _call(**params: Any) -> FakeResponse:
            return self._respond(name, **params)

        return _call

    def calls_for(self, method: str) -> list[dict[str, Any]]:
        return [params for called, params in self.calls if called == method]


def make_source(
    monkeypatch: pytest.MonkeyPatch,
    payloads: dict[str, Any] | None = None,
    *,
    recipe: dict[str, Any] | None = None,
) -> tuple[SlackSource, FakeWebClient]:
    client = FakeWebClient(payloads)
    monkeypatch.setattr(SlackSource, "_build_client", lambda _self: client)
    source = SlackSource(recipe if recipe is not None else slack_recipe())
    return source, client


def slack_recipe(
    *,
    workspace: str | None = "acme",
    optional: dict[str, Any] | None = None,
    strategy: str = "ALL",
) -> dict[str, Any]:
    return {
        "type": "SLACK",
        "required": {"workspace": workspace} if workspace else {},
        "masked": {"bot_token": "xoxb-test-token"},
        "optional": {
            "ingestion": {"rate_limit_delay_seconds": 0, "include_thread_replies": False},
            **(optional or {}),
        },
        "sampling": {"strategy": strategy},
    }


def one_channel_payloads(
    messages: list[dict[str, Any]],
    *,
    channel: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "auth_test": {"ok": True, "team": "Acme", "team_id": "T123", "bot_id": "B1"},
        "conversations_list": {
            "ok": True,
            "channels": [channel or {"id": "C123", "name": "general", "is_private": False}],
            "response_metadata": {"next_cursor": ""},
        },
        "conversations_history": {
            "ok": True,
            "messages": messages,
            "has_more": False,
            "response_metadata": {"next_cursor": ""},
        },
    }


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def test_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch,
        {"auth_test": {"ok": True, "team": "Acme", "team_id": "T123", "bot_id": "B1"}},
    )
    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Acme" in result["message"]


def test_test_connection_rejects_non_bot_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """auth.test succeeds for user tokens too; the source must refuse them."""
    source, _ = make_source(
        monkeypatch,
        {"auth_test": {"ok": True, "team": "Acme", "team_id": "T123", "user_id": "U1"}},
    )
    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "bot token" in result["message"].lower()


def test_client_registers_rate_limit_retry_handler() -> None:
    """The real client must retry Slack's 429s or ingestion dies on first burst."""
    pytest.importorskip("slack_sdk")

    source = SlackSource(slack_recipe())
    assert source.client.retry_handlers, "no retry handlers registered"
    assert any("RateLimit" in type(handler).__name__ for handler in source.client.retry_handlers)


# ---------------------------------------------------------------------------
# Channel discovery
# ---------------------------------------------------------------------------


def test_channel_types_default_to_every_conversation_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, client = make_source(monkeypatch, one_channel_payloads([]))
    source.discover()

    types = client.calls_for("conversations_list")[0]["types"]
    assert set(types.split(",")) == {"public_channel", "private_channel", "mpim", "im"}


def test_direct_messages_get_a_display_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """DM conversations have no `name`, so one is derived for asset titles."""
    source, _ = make_source(
        monkeypatch,
        one_channel_payloads([], channel={"id": "D1", "is_im": True, "user": "U9"}),
    )
    discovered = source.discover()

    assert discovered["channels"][0]["name"] == "dm-U9"


def test_auto_join_only_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = one_channel_payloads([])
    payloads["conversations_join"] = {"ok": True}

    source, client = make_source(
        monkeypatch,
        payloads,
        recipe=slack_recipe(optional={"channels": {"auto_join_public_channels": True}}),
    )
    source._join_if_needed("C123")
    assert client.calls_for("conversations_join") == [{"channel": "C123"}]

    source2, client2 = make_source(monkeypatch, payloads)
    source2._join_if_needed("C123")
    assert client2.calls_for("conversations_join") == []


# ---------------------------------------------------------------------------
# Message extraction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch,
        one_channel_payloads(
            [{"ts": "1700000000.000100", "text": "Hello from Slack", "user": "U123"}]
        ),
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]

    assert len(assets) == 1
    assert unhash_id(assets[0].hash).endswith("acme_#_C123_#_1700000000.000100")
    assert assets[0].external_url.startswith("https://acme.slack.com/archives/C123")
    assert assets[0].asset_type == OutputAssetType.TXT


@pytest.mark.asyncio
async def test_extract_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        {
            "ok": True,
            "messages": [
                {"ts": f"1700000000.00010{i}", "text": f"Message {i}", "user": "U123"}
                for i in (1, 2, 3)
            ],
            "has_more": True,
            "response_metadata": {"next_cursor": "abc"},
        },
        {
            "ok": True,
            "messages": [
                {"ts": f"1700000000.00010{i}", "text": f"Message {i}", "user": "U123"}
                for i in (4, 5)
            ],
            "has_more": False,
            "response_metadata": {"next_cursor": ""},
        },
    ]
    source, _ = make_source(
        monkeypatch,
        {
            "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
            "conversations_history": pages,
        },
        recipe=slack_recipe(optional={"channels": {"channel_ids": ["C123"]}}),
    )

    original = SlackSource.BATCH_SIZE
    SlackSource.BATCH_SIZE = 2
    try:
        batches = [batch async for batch in source.extract()]
    finally:
        SlackSource.BATCH_SIZE = original

    assert [len(batch) for batch in batches] == [2, 2, 1]


def test_permalink_falls_back_without_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(monkeypatch, recipe=slack_recipe(workspace=None))
    asset = source._message_to_asset(
        {"ts": "1700000000.000200", "text": "Hi", "user": "U123"}, "C123", "general"
    )

    assert asset.external_url.startswith("slack://channel")


# ---------------------------------------------------------------------------
# Sampling strategies
# ---------------------------------------------------------------------------


def _many_messages(count: int) -> list[dict[str, Any]]:
    return [
        {"ts": f"17000000{index:04d}.000100", "text": f"m{index}", "user": "U1"}
        for index in range(count)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("strategy", ["LATEST", "RANDOM", "AUTOMATIC"])
async def test_non_all_strategies_cap_one_window(
    monkeypatch: pytest.MonkeyPatch, strategy: str
) -> None:
    """Only ALL is unbounded; every other strategy stops after one window."""
    payloads = {
        "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
        "conversations_history": lambda **_kwargs: {
            "ok": True,
            "messages": _many_messages(200),
            "has_more": True,
            "response_metadata": {"next_cursor": "next"},
        },
    }
    source, _ = make_source(
        monkeypatch,
        payloads,
        recipe={
            **slack_recipe(optional={"channels": {"channel_ids": ["C123"]}}),
            "sampling": {"strategy": strategy, "rows_per_page": 50},
        },
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    assert len(assets) == 50


@pytest.mark.asyncio
async def test_all_strategy_walks_every_page(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        {
            "ok": True,
            "messages": _many_messages(3),
            "has_more": True,
            "response_metadata": {"next_cursor": "p2"},
        },
        {
            "ok": True,
            "messages": [{"ts": "1700009999.000100", "text": "last", "user": "U1"}],
            "has_more": False,
            "response_metadata": {"next_cursor": ""},
        },
    ]
    source, _ = make_source(
        monkeypatch,
        {
            "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
            "conversations_history": pages,
        },
        recipe={
            **slack_recipe(optional={"channels": {"channel_ids": ["C123"]}}),
            "sampling": {"strategy": "ALL", "rows_per_page": 10},
        },
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    assert len(assets) == 4


@pytest.mark.asyncio
async def test_automatic_saves_resume_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch,
        {
            "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
            "conversations_history": lambda **_kwargs: {
                "ok": True,
                "messages": _many_messages(10),
                "has_more": True,
                "response_metadata": {"next_cursor": "resume-here"},
            },
        },
        recipe={
            **slack_recipe(optional={"channels": {"channel_ids": ["C123"]}}),
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        },
    )

    async for _batch in source.extract():
        pass

    assert source.current_sampling_cursor() == {"channel:C123": "resume-here"}


@pytest.mark.asyncio
async def test_automatic_resumes_from_saved_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    source, client = make_source(
        monkeypatch,
        {
            "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
            "conversations_history": {
                "ok": True,
                "messages": _many_messages(2),
                "has_more": False,
                "response_metadata": {"next_cursor": ""},
            },
        },
        recipe={
            **slack_recipe(optional={"channels": {"channel_ids": ["C123"]}}),
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        },
    )
    source._sampling_cursor = {"channel:C123": "saved-cursor"}

    async for _batch in source.extract():
        pass

    assert client.calls_for("conversations_history")[0]["cursor"] == "saved-cursor"
    # Channel exhausted: the cursor wraps so the next run starts from the top.
    assert source.current_sampling_cursor() == {"channel:C123": None}


@pytest.mark.asyncio
async def test_random_narrows_the_channel_set(monkeypatch: pytest.MonkeyPatch) -> None:
    channels = [
        {"id": f"C{index:03d}", "name": f"chan-{index}", "is_private": False} for index in range(40)
    ]
    source, client = make_source(
        monkeypatch,
        {
            "auth_test": {"ok": True, "team_id": "T123", "bot_id": "B1"},
            "conversations_list": {
                "ok": True,
                "channels": channels,
                "response_metadata": {"next_cursor": ""},
            },
            "conversations_history": lambda **_kwargs: {
                "ok": True,
                "messages": [{"ts": "1700000000.000100", "text": "hi", "user": "U1"}],
                "has_more": False,
                "response_metadata": {"next_cursor": ""},
            },
        },
        recipe={
            **slack_recipe(),
            "sampling": {"strategy": "RANDOM", "rows_per_page": 100},
        },
    )

    async for _batch in source.extract():
        pass

    scanned = {call["channel"] for call in client.calls_for("conversations_history")}
    assert 0 < len(scanned) < len(channels)


# ---------------------------------------------------------------------------
# Thread replies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_thread_replies_are_appended_without_duplicating_the_parent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent = {
        "ts": "1700000000.000100",
        "text": "parent message",
        "user": "U1",
        "thread_ts": "1700000000.000100",
        "reply_count": 2,
    }
    source, _ = make_source(
        monkeypatch,
        {
            **one_channel_payloads([parent]),
            "conversations_replies": {
                "ok": True,
                # conversations.replies always leads with the parent message.
                "messages": [
                    parent,
                    {"ts": "1700000000.000200", "text": "first reply", "user": "U2"},
                    {"ts": "1700000000.000300", "text": "second reply", "user": "U3"},
                ],
                "has_more": False,
                "response_metadata": {"next_cursor": ""},
            },
        },
        recipe=slack_recipe(optional={"ingestion": {"include_thread_replies": True}}),
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    _raw, text = await source.fetch_content(assets[0].hash)

    assert "parent message" in text
    assert "first reply" in text
    assert "second reply" in text
    assert text.count("parent message") == 1


@pytest.mark.asyncio
async def test_thread_replies_skipped_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    source, client = make_source(
        monkeypatch,
        one_channel_payloads([{"ts": "1700000000.000100", "text": "parent", "user": "U1"}]),
        recipe=slack_recipe(optional={"ingestion": {"include_thread_replies": False}}),
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    await source.fetch_content(assets[0].hash)

    assert client.calls_for("conversations_replies") == []


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


def _message_with_file(**overrides: Any) -> dict[str, Any]:
    file_obj = {
        "id": "F123",
        "name": "report.pdf",
        "mimetype": "application/pdf",
        "size": 2048,
        "url_private_download": "https://files.slack.com/files-pri/T1-F123/download/report.pdf",
        "permalink": "https://acme.slack.com/files/U1/F123/report.pdf",
        **overrides,
    }
    return {
        "ts": "1700000000.000100",
        "text": "here is the report",
        "user": "U1",
        "files": [file_obj],
    }


@pytest.mark.asyncio
async def test_attachment_becomes_its_own_asset(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(monkeypatch, one_channel_payloads([_message_with_file()]))

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]

    assert len(assets) == 2
    attachment = next(a for a in assets if a.name == "report.pdf")
    assert attachment.asset_type == OutputAssetType.BINARY
    assert attachment.hash in source._attachment_download_url_by_hash


@pytest.mark.asyncio
async def test_attachments_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch,
        one_channel_payloads([_message_with_file()]),
        recipe=slack_recipe(optional={"attachments": {"include_attachments": False}}),
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    assert len(assets) == 1


@pytest.mark.asyncio
async def test_attachment_over_size_cap_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch,
        one_channel_payloads([_message_with_file(size=10_000_000)]),
        recipe=slack_recipe(optional={"attachments": {"max_attachment_bytes": 1_048_576}}),
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    assert len(assets) == 1


@pytest.mark.asyncio
async def test_attachment_extension_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    excluded, _ = make_source(
        monkeypatch,
        one_channel_payloads([_message_with_file()]),
        recipe=slack_recipe(optional={"attachments": {"exclude_file_extensions": ["pdf"]}}),
    )
    assets = [asset for batch in [b async for b in excluded.extract()] for asset in batch]
    assert len(assets) == 1, "excluded extension still produced an asset"

    included, _ = make_source(
        monkeypatch,
        one_channel_payloads([_message_with_file()]),
        recipe=slack_recipe(optional={"attachments": {"include_file_extensions": [".docx"]}}),
    )
    assets = [asset for batch in [b async for b in included.extract()] for asset in batch]
    assert len(assets) == 1, "allow-list did not exclude the pdf"


@pytest.mark.asyncio
async def test_tombstoned_file_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    source, _ = make_source(
        monkeypatch, one_channel_payloads([_message_with_file(mode="tombstone")])
    )

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    assert len(assets) == 1


@pytest.mark.asyncio
async def test_attachment_text_goes_through_the_file_parser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Attachment content must be extracted by utils/file_parser, not read raw."""
    source, _ = make_source(monkeypatch, one_channel_payloads([_message_with_file()]))

    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    attachment = next(a for a in assets if a.name == "report.pdf")

    downloaded: dict[str, Any] = {}

    def _download(_self: SlackSource, url: str) -> bytes:
        downloaded["url"] = url
        return b"%PDF-1.4 fake pdf bytes"

    monkeypatch.setattr(SlackSource, "_download_file", _download)
    monkeypatch.setattr(
        "src.utils.file_parser._extract_pdf_text",
        lambda _bytes: ("Quarterly revenue figures", None),
    )

    result = await source.fetch_content(attachment.hash)

    assert result is not None
    _raw, text = result
    assert "Quarterly revenue figures" in text
    assert downloaded["url"].endswith("report.pdf")


@pytest.mark.asyncio
async def test_attachment_download_uses_bearer_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """url_private_download needs the bot token; without it Slack serves HTML."""
    source, _ = make_source(monkeypatch, one_channel_payloads([_message_with_file()]))
    captured: dict[str, Any] = {}

    class _Response:
        headers: ClassVar[dict[str, str]] = {"Content-Type": "application/pdf"}
        content = b"%PDF-1.4 bytes"

        def raise_for_status(self) -> None:
            return None

    def _get(url: str, **kwargs: Any) -> _Response:
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return _Response()

    monkeypatch.setattr("requests.get", _get)
    assert source._download_file("https://files.slack.com/x") == b"%PDF-1.4 bytes"
    assert captured["headers"]["Authorization"] == "Bearer xoxb-test-token"


@pytest.mark.asyncio
async def test_html_response_is_treated_as_a_download_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing files:read scope yields a login page, not an HTTP error."""
    source, _ = make_source(monkeypatch, one_channel_payloads([_message_with_file()]))

    class _Response:
        headers: ClassVar[dict[str, str]] = {"Content-Type": "text/html; charset=utf-8"}
        content = b"<html>sign in</html>"

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr("requests.get", lambda _url, **_kwargs: _Response())

    with pytest.raises(RuntimeError, match="files:read"):
        source._download_file("https://files.slack.com/x")


@pytest.mark.asyncio
async def test_textless_attachment_is_not_processed_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An image with no OCR text must not be downloaded again by the fallback."""
    source, _ = make_source(
        monkeypatch,
        one_channel_payloads([_message_with_file(name="icon.png", mimetype="image/png", size=200)]),
    )
    assets = [asset for batch in [b async for b in source.extract()] for asset in batch]
    attachment = next(a for a in assets if a.name == "icon.png")

    downloads = {"n": 0}

    def _download(_self: SlackSource, _url: str) -> bytes:
        downloads["n"] += 1
        # 1x1 PNG: too small for OCR, so no text comes back.
        return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + (1).to_bytes(4, "big") * 2

    monkeypatch.setattr(SlackSource, "_download_file", _download)

    assert await source.fetch_content(attachment.hash) is None
    assert downloads["n"] == 1
    assert attachment.hash in source._content_pages_processed


def test_source_constructs_without_the_slack_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    """Building a source must not require the optional slack_sdk dependency.

    Recipe validation and asset-hash computation happen without any API call, so
    the WebClient is created lazily; constructing eagerly made every such caller
    depend on an optional install.
    """

    def _explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("the Slack client must not be built during __init__")

    monkeypatch.setattr(SlackSource, "_build_client", _explode)

    source = SlackSource(slack_recipe())
    hashed = source.generate_hash_id("C123_#_1700000000.000100")

    assert unhash_id(hashed).endswith("acme_#_C123_#_1700000000.000100")
