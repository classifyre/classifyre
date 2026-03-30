from unittest.mock import MagicMock, patch

import pytest

from src.sources.slack.source import SlackSource
from src.utils.hashing import unhash_id


@pytest.fixture
def slack_recipe():
    return {
        "type": "SLACK",
        "required": {"workspace": "acme"},
        "masked": {"bot_token": "xoxb-test-token"},
        "optional": {"ingestion": {"rate_limit_delay_seconds": 0}},
    }


@pytest.fixture
def slack_recipe_no_workspace():
    return {
        "type": "SLACK",
        "required": {},
        "masked": {"bot_token": "xoxb-test-token"},
        "optional": {"ingestion": {"rate_limit_delay_seconds": 0}},
    }


def _make_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload
    response.headers = {}
    return response


@patch("src.sources.slack.source.requests.Session")
def test_slack_test_connection_success(mock_session_cls, slack_recipe):
    mock_session = MagicMock()
    mock_session.headers = {}
    mock_session.request.return_value = _make_response(
        {"ok": True, "team": "Acme", "team_id": "T123"}
    )
    mock_session_cls.return_value = mock_session

    source = SlackSource(slack_recipe)
    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Acme" in result["message"]


@pytest.mark.asyncio
@patch("src.sources.slack.source.requests.Session")
async def test_slack_extract_messages(mock_session_cls, slack_recipe):
    mock_session = MagicMock()
    mock_session.headers = {}

    def request_side_effect(_method, url, params=None, data=None, timeout=None):  # noqa: ARG001
        if url.endswith("/conversations.list"):
            return _make_response(
                {
                    "ok": True,
                    "channels": [
                        {
                            "id": "C123",
                            "name": "general",
                            "is_private": False,
                        }
                    ],
                    "response_metadata": {"next_cursor": ""},
                }
            )
        if url.endswith("/conversations.history"):
            return _make_response(
                {
                    "ok": True,
                    "messages": [
                        {
                            "ts": "1700000000.000100",
                            "text": "Hello from Slack",
                            "user": "U123",
                        }
                    ],
                    "has_more": False,
                    "response_metadata": {"next_cursor": ""},
                }
            )
        if url.endswith("/auth.test"):
            return _make_response({"ok": True})
        raise AssertionError(f"Unexpected URL: {url}")

    mock_session.request.side_effect = request_side_effect
    mock_session_cls.return_value = mock_session

    source = SlackSource(slack_recipe)
    results = []

    async for batch in source.extract():
        results.extend(batch)

    assert len(results) == 1
    decoded = unhash_id(results[0].hash)
    assert decoded.endswith("acme_#_C123_#_1700000000.000100")
    assert results[0].external_url.startswith("https://acme.slack.com/archives/C123")


@pytest.mark.asyncio
@patch("src.sources.slack.source.requests.Session")
async def test_slack_extract_batches(mock_session_cls, slack_recipe):
    mock_session = MagicMock()
    mock_session.headers = {}

    slack_recipe = {
        **slack_recipe,
        "optional": {
            "channels": {"channel_ids": ["C123"]},
            "ingestion": {"rate_limit_delay_seconds": 0},
        },
    }

    call_count = 0

    def request_side_effect(_method, url, params=None, data=None, timeout=None):  # noqa: ARG001
        nonlocal call_count
        if url.endswith("/conversations.history"):
            call_count += 1
            if call_count == 1:
                return _make_response(
                    {
                        "ok": True,
                        "messages": [
                            {
                                "ts": "1700000000.000101",
                                "text": "Message 1",
                                "user": "U123",
                            },
                            {
                                "ts": "1700000000.000102",
                                "text": "Message 2",
                                "user": "U123",
                            },
                            {
                                "ts": "1700000000.000103",
                                "text": "Message 3",
                                "user": "U123",
                            },
                        ],
                        "has_more": True,
                        "response_metadata": {"next_cursor": "abc"},
                    }
                )
            if call_count == 2:
                return _make_response(
                    {
                        "ok": True,
                        "messages": [
                            {
                                "ts": "1700000000.000104",
                                "text": "Message 4",
                                "user": "U123",
                            },
                            {
                                "ts": "1700000000.000105",
                                "text": "Message 5",
                                "user": "U123",
                            },
                        ],
                        "has_more": False,
                        "response_metadata": {"next_cursor": ""},
                    }
                )

        raise AssertionError(f"Unexpected URL: {url}")

    mock_session.request.side_effect = request_side_effect
    mock_session_cls.return_value = mock_session

    original_batch_size = SlackSource.BATCH_SIZE
    SlackSource.BATCH_SIZE = 2
    try:
        source = SlackSource(slack_recipe)
        batches = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        SlackSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 2, 1]


@patch("src.sources.slack.source.requests.Session")
def test_slack_location_fallback_without_workspace(
    mock_session_cls,
    slack_recipe_no_workspace,
):
    mock_session = MagicMock()
    mock_session.headers = {}
    mock_session_cls.return_value = mock_session

    source = SlackSource(slack_recipe_no_workspace)
    asset = source._message_to_asset(
        {"ts": "1700000000.000200", "text": "Hi", "user": "U123"},
        "C123",
        "general",
    )

    assert asset.external_url.startswith("slack://channel")
