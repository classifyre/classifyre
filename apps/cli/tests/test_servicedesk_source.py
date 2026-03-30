from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.atlassian_common import AtlassianCloudClient
from src.sources.servicedesk.source import ServiceDeskSource
from src.utils.file_parser import ParsedBytes
from src.utils.validation import validate_input


def _servicedesk_recipe(
    *,
    strategy: str = "ALL",
    optional: dict[str, Any] | None = None,
) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "type": "SERVICEDESK",
        "required": {
            "base_url": "https://your-domain.atlassian.net",
            "account_email": "user@example.com",
        },
        "masked": {"api_token": "token"},
        "sampling": {"strategy": strategy, "limit": 100},
    }
    if optional is not None:
        recipe["optional"] = optional
    return recipe


async def _collect_assets(source: ServiceDeskSource):
    assets = []
    async for batch in source.extract():
        assets.extend(batch)
    return assets


def test_servicedesk_test_connection_success(monkeypatch: pytest.MonkeyPatch):
    source = ServiceDeskSource(_servicedesk_recipe())
    monkeypatch.setattr(source.client, "get_json", lambda *_args, **_kwargs: {"values": []})

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "Successfully connected" in result["message"]


def test_servicedesk_test_connection_failure(monkeypatch: pytest.MonkeyPatch):
    source = ServiceDeskSource(_servicedesk_recipe())

    def _raise(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(source.client, "get_json", _raise)

    result = source.test_connection()

    assert result["status"] == "FAILURE"
    assert "Failed to connect" in result["message"]


def test_servicedesk_scope_is_optional():
    validate_input(_servicedesk_recipe(), "servicedesk")


def test_servicedesk_scope_filters_are_sent(monkeypatch: pytest.MonkeyPatch):
    source = ServiceDeskSource(
        _servicedesk_recipe(
            optional={
                "scope": {
                    "service_desk_ids": [1, 2],
                    "request_type_ids": [55],
                    "request_status": "OPEN_REQUESTS",
                    "request_ownership": ["OWNED_REQUESTS", "PARTICIPATED_REQUESTS"],
                    "organization_id": 99,
                    "search_term": "vpn",
                }
            }
        )
    )
    calls: list[tuple[str, dict[str, Any]]] = []

    def _iter(path: str, *, params: dict[str, Any] | None = None, limit: int = 50):
        _ = limit
        calls.append((path, dict(params or {})))
        return []

    monkeypatch.setattr(source.client, "iter_servicedesk_values", _iter)

    requests = source._fetch_requests()

    assert requests == []
    assert len(calls) == 2
    assert calls[0][0] == "/rest/servicedeskapi/request"
    assert calls[0][1] == {
        "searchTerm": "vpn",
        "requestStatus": "OPEN_REQUESTS",
        "requestOwnership": ["OWNED_REQUESTS", "PARTICIPATED_REQUESTS"],
        "organizationId": 99,
        "serviceDeskId": 1,
        "requestTypeId": 55,
    }
    assert calls[1][1]["serviceDeskId"] == 2


def test_servicedesk_start_limit_pagination(monkeypatch: pytest.MonkeyPatch):
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
                "values": [{"issueKey": "HELP-1"}],
                "size": 1,
                "isLastPage": False,
            }
        if len(calls) == 2:
            return {
                "values": [{"issueKey": "HELP-2"}],
                "size": 1,
                "isLastPage": True,
            }
        raise AssertionError("Unexpected pagination call")

    monkeypatch.setattr(client, "get_json", _get_json)

    values = client.iter_servicedesk_values(
        "/rest/servicedeskapi/request",
        params={"serviceDeskId": 1},
        limit=1,
    )

    assert [item["issueKey"] for item in values] == ["HELP-1", "HELP-2"]
    assert calls[0] == {"serviceDeskId": 1, "start": 0, "limit": 1}
    assert calls[1] == {"serviceDeskId": 1, "start": 1, "limit": 1}
    client.close()


@pytest.mark.asyncio
async def test_servicedesk_extract_request_comments_attachments_and_links(
    monkeypatch: pytest.MonkeyPatch,
):
    source = ServiceDeskSource(
        _servicedesk_recipe(
            optional={
                "content": {"include_comments": True, "include_attachments": True},
            }
        ),
        source_id="source-1",
        runner_id="runner-1",
    )

    request = {
        "issueId": "1001",
        "issueKey": "HELP-1",
        "summary": "VPN access broken",
        "createdDate": {"iso8601": "2025-01-01T00:00:00Z"},
        "currentStatus": {
            "status": "Waiting for support",
            "statusDate": {"iso8601": "2025-01-02T00:00:00Z"},
        },
        "serviceDesk": {"name": "IT Help"},
        "requestType": {"name": "Incident"},
        "_links": {"web": "https://your-domain.atlassian.net/servicedesk/customer/portal/1/HELP-1"},
        "requestFieldValues": [
            {
                "label": "Description",
                "value": "See runbook: https://docs.example.com/runbook",
            }
        ],
    }

    monkeypatch.setattr(source, "_fetch_requests", lambda: [request])

    def _iter(path: str, *, params: dict[str, Any] | None = None, limit: int = 50):
        _ = params
        _ = limit
        if path.endswith("/comment"):
            return [{"body": "Customer update https://status.example.com/incidents/42"}]
        if path.endswith("/attachment"):
            return [
                {
                    "filename": "vpn-screenshot.png",
                    "mimeType": "image/png",
                    "size": 128,
                    "_links": {
                        "content": "https://your-domain.atlassian.net/rest/servicedeskapi/request/HELP-1/attachment/att-1"
                    },
                }
            ]
        raise AssertionError(f"Unexpected path: {path}")

    monkeypatch.setattr(source.client, "iter_servicedesk_values", _iter)

    assets = await _collect_assets(source)

    request_assets = [a for a in assets if a.external_url.endswith("/portal/1/HELP-1")]
    assert len(request_assets) == 1
    request_asset = request_assets[0]
    assert request_asset.asset_type == OutputAssetType.TXT

    comment_assets = [a for a in assets if a.name.startswith("Comments for request HELP-1")]
    assert len(comment_assets) == 1

    attachment_assets = [a for a in assets if a.name == "vpn-screenshot.png"]
    assert len(attachment_assets) == 1
    assert attachment_assets[0].asset_type == OutputAssetType.IMAGE

    body_url_hash = source.generate_hash_id("https://docs.example.com/runbook")
    comment_url_hash = source.generate_hash_id("https://status.example.com/incidents/42")

    assert comment_assets[0].hash in request_asset.links
    assert attachment_assets[0].hash in request_asset.links
    assert body_url_hash in request_asset.links
    assert comment_url_hash in request_asset.links


@pytest.mark.asyncio
async def test_servicedesk_fetch_content_for_attachment(monkeypatch: pytest.MonkeyPatch):
    source = ServiceDeskSource(_servicedesk_recipe())
    attachment_url = (
        "https://your-domain.atlassian.net/rest/servicedeskapi/request/HELP-9/attachment/att-9"
    )
    attachment_hash = source.generate_hash_id(attachment_url)
    source._attachment_url_by_hash[attachment_hash] = attachment_url

    monkeypatch.setattr(
        source.client,
        "get_bytes",
        lambda _url: (b"servicedesk attachment payload", "text/plain"),
    )
    monkeypatch.setattr(
        "src.sources.servicedesk.source.parse_bytes",
        lambda _file_bytes, **_kwargs: ParsedBytes(
            mime_type="text/plain",
            raw_content="servicedesk attachment payload",
            text_content="servicedesk attachment payload",
            is_binary=False,
            file_size_bytes=29,
            parse_error=None,
        ),
    )

    content = await source.fetch_content(attachment_hash)

    assert content is not None
    raw, text = content
    assert "servicedesk attachment payload" in raw
    assert "servicedesk attachment payload" in text


def test_servicedesk_resolve_link_for_detection_maps_hash_to_url():
    source = ServiceDeskSource(_servicedesk_recipe())
    url = "https://your-domain.atlassian.net/servicedesk/customer/portal/1/HELP-77"
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
def test_servicedesk_attachment_asset_type_supports_tabular_fallbacks(
    mime_type: str,
    file_name: str,
    expected: OutputAssetType,
):
    source = ServiceDeskSource(_servicedesk_recipe())
    assert source._asset_type_from_mime_or_name(mime_type, file_name) == expected
