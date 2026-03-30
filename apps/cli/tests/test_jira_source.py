from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.atlassian_common import AtlassianCloudClient
from src.sources.jira.source import JiraSource
from src.utils.file_parser import ParsedBytes
from src.utils.validation import validate_input


def _jira_recipe(
    *,
    strategy: str = "ALL",
    scope: dict[str, Any] | None = None,
    include_scope: bool = True,
    optional_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    optional: dict[str, Any] = {}
    if include_scope:
        optional["scope"] = {"project_keys": ["PLAT"]} if scope is None else scope
    if optional_extra:
        optional.update(optional_extra)
    return {
        "type": "JIRA",
        "required": {
            "base_url": "https://your-domain.atlassian.net",
            "account_email": "user@example.com",
        },
        "masked": {"api_token": "token"},
        **({"optional": optional} if optional else {}),
        "sampling": {"strategy": strategy, "limit": 100},
    }


async def _collect_assets(source: JiraSource):
    assets = []
    async for batch in source.extract():
        assets.extend(batch)
    return assets


def test_jira_test_connection_success(monkeypatch: pytest.MonkeyPatch):
    source = JiraSource(_jira_recipe())
    monkeypatch.setattr(source.client, "get_json", lambda *_args, **_kwargs: {"values": []})

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Successfully connected" in result["message"]


def test_jira_test_connection_failure(monkeypatch: pytest.MonkeyPatch):
    source = JiraSource(_jira_recipe())

    def _raise(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(source.client, "get_json", _raise)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Failed to connect" in result["message"]


def test_jira_scope_is_optional():
    recipe = _jira_recipe(include_scope=False)
    validate_input(recipe, "jira")


def test_jira_effective_jql_composition_with_scope_and_user_query():
    source = JiraSource(
        _jira_recipe(
            strategy="LATEST",
            scope={
                "project_keys": ["PLAT", "ENG"],
                "project_ids": [10001],
                "jql": "statusCategory != Done ORDER BY priority DESC",
            },
        )
    )
    jql = source._effective_jql()

    assert "(statusCategory != Done)" in jql
    assert "project in (PLAT, ENG)" in jql
    assert "project in (10001)" in jql
    assert jql.endswith("ORDER BY priority DESC")


def test_jira_effective_jql_adds_latest_order_when_missing():
    source = JiraSource(_jira_recipe(strategy="LATEST", scope={"project_keys": ["PLAT"]}))

    jql = source._effective_jql()

    assert "project in (PLAT)" in jql
    assert jql.endswith("ORDER BY updated DESC")


def test_jira_effective_jql_defaults_when_scope_is_omitted():
    source = JiraSource(_jira_recipe(strategy="RANDOM", include_scope=False))
    assert source._effective_jql() == "issuekey IS NOT EMPTY"

    latest_source = JiraSource(_jira_recipe(strategy="LATEST", include_scope=False))
    assert latest_source._effective_jql() == "issuekey IS NOT EMPTY ORDER BY updated DESC"


def test_jira_next_page_token_pagination(monkeypatch: pytest.MonkeyPatch):
    client = AtlassianCloudClient(
        base_url="https://your-domain.atlassian.net",
        account_email="user@example.com",
        api_token="token",
    )
    calls: list[dict[str, Any]] = []

    def _get_json(_path: str, *, params: dict[str, Any] | None = None):
        calls.append(dict(params or {}))
        if len(calls) == 1:
            return {
                "issues": [{"key": "PLAT-1"}],
                "isLast": False,
                "nextPageToken": "token-1",
            }
        if len(calls) == 2:
            return {
                "issues": [{"key": "PLAT-2"}],
                "isLast": True,
            }
        raise AssertionError("Unexpected pagination call")

    monkeypatch.setattr(client, "get_json", _get_json)

    issues = client.iter_jira_search_jql(
        jql="project = PLAT",
        fields=["summary"],
        max_results=1,
    )

    assert [issue["key"] for issue in issues] == ["PLAT-1", "PLAT-2"]
    assert calls[0]["jql"] == "project = PLAT"
    assert calls[0]["maxResults"] == 1
    assert "nextPageToken" not in calls[0]
    assert calls[1]["nextPageToken"] == "token-1"
    client.close()


@pytest.mark.asyncio
async def test_jira_extract_issue_comments_attachments_and_links(
    monkeypatch: pytest.MonkeyPatch,
):
    source = JiraSource(
        _jira_recipe(
            scope={"project_keys": ["PLAT"]},
            optional_extra={"content": {"include_comments": True, "include_attachments": True}},
        ),
        source_id="source-1",
        runner_id="runner-1",
    )

    issue = {
        "id": "1001",
        "key": "PLAT-1",
        "fields": {
            "summary": "Fix auth issue",
            "description": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": "Details in https://docs.example.com/auth",
                            }
                        ],
                    }
                ],
            },
            "issuetype": {"name": "Bug"},
            "status": {"name": "In Progress"},
            "priority": {"name": "High"},
            "project": {"key": "PLAT"},
            "created": "2025-01-01T00:00:00Z",
            "updated": "2025-01-02T00:00:00Z",
            "issuelinks": [
                {
                    "outwardIssue": {"key": "PLAT-2"},
                }
            ],
            "attachment": [
                {
                    "id": "att-1",
                    "filename": "error.log",
                    "mimeType": "text/plain",
                    "size": 120,
                    "content": "https://your-domain.atlassian.net/secure/attachment/att-1/error.log",
                }
            ],
        },
    }

    monkeypatch.setattr(
        source.client,
        "iter_jira_search_jql",
        lambda **_kwargs: [issue],
    )
    monkeypatch.setattr(
        source,
        "_fetch_issue_comments",
        lambda _issue_key: [
            {
                "body": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "See https://status.example.com/incidents/42",
                                }
                            ],
                        }
                    ],
                }
            }
        ],
    )

    assets = await _collect_assets(source)

    issue_assets = [a for a in assets if a.external_url.endswith("/browse/PLAT-1")]
    assert len(issue_assets) == 1
    issue_asset = issue_assets[0]
    assert issue_asset.asset_type == OutputAssetType.TXT

    comment_assets = [a for a in assets if a.name.startswith("Comments for issue PLAT-1")]
    assert len(comment_assets) == 1

    attachment_assets = [a for a in assets if a.name == "error.log"]
    assert len(attachment_assets) == 1
    assert attachment_assets[0].asset_type == OutputAssetType.TXT

    linked_issue_hash = source.generate_hash_id("https://your-domain.atlassian.net/browse/PLAT-2")
    description_url_hash = source.generate_hash_id("https://docs.example.com/auth")
    comment_url_hash = source.generate_hash_id("https://status.example.com/incidents/42")

    assert linked_issue_hash in issue_asset.links
    assert comment_assets[0].hash in issue_asset.links
    assert attachment_assets[0].hash in issue_asset.links
    assert description_url_hash in issue_asset.links
    assert comment_url_hash in issue_asset.links

    # Linked issue is link-only and must not be expanded into a full asset.
    assert not any(asset.external_url.endswith("/browse/PLAT-2") for asset in assets)


@pytest.mark.asyncio
async def test_jira_fetch_content_for_attachment(monkeypatch: pytest.MonkeyPatch):
    source = JiraSource(_jira_recipe())
    attachment_url = "https://your-domain.atlassian.net/secure/attachment/att-9/log.txt"
    attachment_hash = source.generate_hash_id(attachment_url)
    source._attachment_url_by_hash[attachment_hash] = attachment_url

    monkeypatch.setattr(
        source.client,
        "get_bytes",
        lambda _url: (b"jira attachment text payload", "text/plain"),
    )
    monkeypatch.setattr(
        "src.sources.jira.source.parse_bytes",
        lambda _file_bytes, **_kwargs: ParsedBytes(
            mime_type="text/plain",
            raw_content="jira attachment text payload",
            text_content="jira attachment text payload",
            is_binary=False,
            file_size_bytes=28,
            parse_error=None,
        ),
    )

    content = await source.fetch_content(attachment_hash)

    assert content is not None
    raw, text = content
    assert "jira attachment text payload" in raw
    assert "jira attachment text payload" in text


def test_jira_resolve_link_for_detection_maps_hash_to_url():
    source = JiraSource(_jira_recipe())
    url = "https://your-domain.atlassian.net/browse/PLAT-77"
    hashed = source.generate_hash_id(url)

    assert source.resolve_link_for_detection(hashed) == url


@pytest.mark.parametrize(
    ("mime_type", "file_name", "expected"),
    [
        ("text/csv", "export.csv", OutputAssetType.TABLE),
        ("text/tab-separated-values", "export.tsv", OutputAssetType.TABLE),
        ("application/vnd.ms-excel", "export.xls", OutputAssetType.TABLE),
        ("application/vnd.apache.parquet", "export.parquet", OutputAssetType.TABLE),
        ("application/octet-stream", "export.xlsx", OutputAssetType.TABLE),
        ("application/octet-stream", "archive.zip", OutputAssetType.BINARY),
    ],
)
def test_jira_attachment_asset_type_supports_tabular_fallbacks(
    mime_type: str,
    file_name: str,
    expected: OutputAssetType,
):
    source = JiraSource(_jira_recipe())
    assert source._asset_type_from_mime_or_name(mime_type, file_name) == expected
