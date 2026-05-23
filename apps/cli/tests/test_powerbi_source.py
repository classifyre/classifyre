from __future__ import annotations

from typing import Any

import pytest

from src.sources.powerbi.source import PowerBIAssetRef, PowerBISource


def _service_principal_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "POWERBI",
        "required": {
            "auth_mode": "SERVICE_PRINCIPAL",
            "tenant_id": "11bb8523-44f1-4e22-a058-81f49f3fe8e8",
            "client_id": "49eaace0-dde1-41f9-9c1a-0db63adfd779",
        },
        "masked": {
            "client_secret": "example-secret",
        },
        "optional": {
            "extraction": {
                "extract_ownership": True,
                "extract_workspaces_to_containers": True,
                "extract_datasets_to_containers": True,
                "extract_dashboards": True,
                "extract_reports": True,
                "extract_dataset_schema": True,
            },
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


def _access_token_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "POWERBI",
        "required": {
            "auth_mode": "ACCESS_TOKEN",
        },
        "masked": {
            "access_token": "eyJhbGciOi...",
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


class _FakeResponse:
    def __init__(
        self,
        payload: dict[str, Any],
        *,
        status_code: int = 200,
    ) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = "{}" if payload else ""

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeSession:
    def __init__(self) -> None:
        self.post_calls: list[dict[str, Any]] = []
        self.request_calls: list[dict[str, Any]] = []

    def post(self, url: str, data: dict[str, Any], timeout: int) -> _FakeResponse:
        self.post_calls.append({"url": url, "data": data, "timeout": timeout})
        return _FakeResponse(
            {
                "access_token": "service-principal-token",
                "expires_in": 3600,
            }
        )

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, Any],
        params: dict[str, Any] | None,
        json: dict[str, Any] | None,
        timeout: int,
    ) -> _FakeResponse:
        self.request_calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "params": params,
                "json": json,
                "timeout": timeout,
            }
        )

        if url.endswith("/groups"):
            return _FakeResponse(
                {
                    "value": [
                        {
                            "id": "workspace-1",
                            "name": "Finance Analytics",
                        }
                    ]
                }
            )

        return _FakeResponse({"value": []})

    def close(self) -> None:
        return None


def _make_ref(
    source: PowerBISource,
    *,
    raw_id: str,
    kind: str,
    workspace_id: str,
    workspace_name: str,
    asset_id: str,
    name: str,
    linked_raw_ids: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> PowerBIAssetRef:
    return source._to_asset_ref(
        raw_id=raw_id,
        kind=kind,
        workspace_id=workspace_id,
        workspace_name=workspace_name,
        asset_id=asset_id,
        name=name,
        external_url=f"https://app.powerbi.com/{kind}/{asset_id}",
        metadata=metadata or {},
        linked_raw_ids=linked_raw_ids,
    )


def test_powerbi_service_principal_acquires_token_and_calls_groups() -> None:
    source = PowerBISource(_service_principal_recipe())
    fake_session = _FakeSession()
    source.session = fake_session

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "SERVICE_PRINCIPAL" in result["message"]
    assert len(fake_session.post_calls) == 1
    assert fake_session.post_calls[0]["data"]["scope"] == source.API_SCOPE
    assert (
        fake_session.request_calls[0]["headers"]["Authorization"]
        == "Bearer service-principal-token"
    )


def test_powerbi_access_token_mode_uses_masked_access_token_without_token_exchange() -> None:
    source = PowerBISource(_access_token_recipe())
    fake_session = _FakeSession()
    source.session = fake_session

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "ACCESS_TOKEN" in result["message"]
    assert fake_session.post_calls == []
    assert fake_session.request_calls[0]["headers"]["Authorization"].startswith("Bearer ")


def test_powerbi_sampling_random_returns_all_when_below_limit() -> None:
    source = PowerBISource(
        _service_principal_recipe(
            sampling={
                "strategy": "RANDOM",
            }
        )
    )

    refs = [
        _make_ref(
            source,
            raw_id=f"workspace-1_#_dataset_#_{index}",
            kind="dataset",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id=str(index),
            name=f"dataset-{index}",
        )
        for index in range(5)
    ]

    sampled = source._sample_refs(refs)

    assert len(sampled) == 5
    assert all(sample in refs for sample in sampled)


def test_powerbi_sampling_latest_uses_order_by_column() -> None:
    source = PowerBISource(
        _service_principal_recipe(
            sampling={
                "strategy": "LATEST",
                "order_by_column": "modifiedDateTime",
            }
        )
    )

    refs = [
        _make_ref(
            source,
            raw_id=f"workspace-1_#_report_#_{index}",
            kind="report",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id=str(index),
            name=f"report-{index}",
            metadata={
                "report": {
                    "modifiedDateTime": f"2026-02-2{index}T10:00:00Z",
                }
            },
        )
        for index in range(3)
    ]

    sampled = source._sample_refs(refs)

    assert [ref.asset_id for ref in sampled] == ["2", "1", "0"]


def test_powerbi_sampling_all_keeps_everything() -> None:
    source = PowerBISource(
        _service_principal_recipe(
            sampling={
                "strategy": "ALL",
            }
        )
    )

    refs = [
        _make_ref(
            source,
            raw_id=f"workspace-1_#_dashboard_#_{index}",
            kind="dashboard",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id=str(index),
            name=f"dashboard-{index}",
        )
        for index in range(4)
    ]

    sampled = source._sample_refs(refs)

    assert sampled == refs


@pytest.mark.asyncio
async def test_powerbi_extract_maps_report_dataset_links() -> None:
    source = PowerBISource(
        _service_principal_recipe(
            sampling={
                "strategy": "ALL",
            }
        )
    )

    workspace_raw_id = source._workspace_raw_id("workspace-1")
    dataset_raw_id = source._dataset_raw_id("workspace-1", "dataset-1")
    report_raw_id = source._report_raw_id("workspace-1", "report-1")

    refs = [
        _make_ref(
            source,
            raw_id=workspace_raw_id,
            kind="workspace",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id="workspace-1",
            name="Finance",
        ),
        _make_ref(
            source,
            raw_id=dataset_raw_id,
            kind="dataset",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id="dataset-1",
            name="Revenue Model",
            linked_raw_ids=[workspace_raw_id],
        ),
        _make_ref(
            source,
            raw_id=report_raw_id,
            kind="report",
            workspace_id="workspace-1",
            workspace_name="Finance",
            asset_id="report-1",
            name="Executive Overview",
            linked_raw_ids=[workspace_raw_id, dataset_raw_id],
            metadata={"report": {"datasetId": "dataset-1"}},
        ),
    ]

    source._discover_assets = lambda: refs

    assets: list[Any] = []
    async for batch in source.extract():
        assets.extend(batch)

    report_asset = next(
        asset for asset in assets if asset.hash == source.generate_hash_id(report_raw_id)
    )
    dataset_hash = source.generate_hash_id(dataset_raw_id)

    assert dataset_hash in report_asset.links


@pytest.mark.asyncio
async def test_powerbi_fetch_content_uses_cache() -> None:
    source = PowerBISource(_service_principal_recipe())

    ref = _make_ref(
        source,
        raw_id=source._dataset_raw_id("workspace-1", "dataset-1"),
        kind="dataset",
        workspace_id="workspace-1",
        workspace_name="Finance",
        asset_id="dataset-1",
        name="Revenue Model",
        metadata={
            "tables": [
                {
                    "name": "transactions",
                    "columns": [{"name": "amount"}, {"name": "currency"}],
                }
            ]
        },
    )
    asset_hash = source.generate_hash_id(ref.raw_id)
    source._asset_lookup[asset_hash] = ref

    first = await source.fetch_content(asset_hash)
    second = await source.fetch_content(asset_hash)

    assert first is not None
    assert first == second
    assert "dataset_tables=1" in first[1]
