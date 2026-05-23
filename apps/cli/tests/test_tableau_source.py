from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest

from src.sources.tableau.source import TableauAssetRef, TableauSource


def _username_password_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "TABLEAU",
        "required": {
            "auth_mode": "USERNAME_PASSWORD",
            "connect_uri": "https://tableau.company.com",
            "site": "",
        },
        "masked": {
            "username": "svc_tableau",
            "password": "secret",
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


def _pat_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "TABLEAU",
        "required": {
            "auth_mode": "PERSONAL_ACCESS_TOKEN",
            "connect_uri": "https://classifyre.tableau.com",
            "site": "classifyre",
            "token_name": "new-token-3",
        },
        "masked": {
            "token_value": "token-value",
        },
        "sampling": {
            "strategy": "RANDOM",
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _TableauAuth:
        def __init__(self, *, username: str, password: str, site_id: str) -> None:
            self.username = username
            self.password = password
            self.site_id = site_id

    class _PersonalAccessTokenAuth:
        def __init__(self, token_name: str, token_value: str, site_id: str) -> None:
            self.token_name = token_name
            self.token_value = token_value
            self.site_id = site_id

    class _RequestOptions:
        def __init__(self) -> None:
            self.page_size = 100
            self.page_number = 1

    class _FakeModule:
        TableauAuth = _TableauAuth
        PersonalAccessTokenAuth = _PersonalAccessTokenAuth
        RequestOptions = _RequestOptions

        class Server:  # pragma: no cover - tests patch _signed_in_server directly
            def __init__(self, *_args: Any, **_kwargs: Any) -> None:
                raise AssertionError("Server should be provided by _signed_in_server monkeypatch")

    monkeypatch.setattr(
        "src.sources.tableau.source.require_module",
        lambda **_kwargs: _FakeModule(),
    )


@dataclass
class _FakeTag:
    name: str


class _FakeItem:
    def __init__(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)


class _FakePagination:
    def __init__(self, page_number: int, page_size: int, total_available: int) -> None:
        self.page_number = page_number
        self.page_size = page_size
        self.total_available = total_available


class _FakeEndpoint:
    def __init__(self, items: list[Any]) -> None:
        self.items = items
        self.populate_tags_calls = 0

    def get(self, request_options: Any) -> tuple[list[Any], _FakePagination]:
        page_size = int(getattr(request_options, "page_size", 100) or 100)
        page_number = int(getattr(request_options, "page_number", 1) or 1)
        start = (page_number - 1) * page_size
        end = start + page_size
        return (
            self.items[start:end],
            _FakePagination(
                page_number=page_number, page_size=page_size, total_available=len(self.items)
            ),
        )

    def populate_tags(self, item: Any) -> None:
        self.populate_tags_calls += 1
        if not hasattr(item, "tags"):
            item.tags = []


class _FakeUsersEndpoint:
    def get_by_id(self, user_id: str) -> _FakeItem:
        return _FakeItem(
            id=user_id,
            name=f"user-{user_id}",
            full_name=f"User {user_id}",
            email=f"{user_id}@example.com",
        )


class _FakeServer:
    def __init__(
        self,
        *,
        projects: list[Any],
        workbooks: list[Any],
        datasources: list[Any],
    ) -> None:
        self.projects = _FakeEndpoint(projects)
        self.workbooks = _FakeEndpoint(workbooks)
        self.datasources = _FakeEndpoint(datasources)
        self.users = _FakeUsersEndpoint()


@contextmanager
def _server_ctx(server: _FakeServer) -> Iterator[_FakeServer]:
    yield server


def _make_ref(
    source: TableauSource,
    *,
    raw_id: str,
    kind: str,
    asset_id: str,
    name: str,
    updated_at: str,
) -> TableauAssetRef:
    return source._to_asset_ref(
        raw_id=raw_id,
        kind=kind,
        asset_id=asset_id,
        name=name,
        project_name="Finance",
        external_url=f"https://tableau.example.com/{kind}/{asset_id}",
        metadata={
            "updated_at": updated_at,
            "created_at": "2026-02-01T10:00:00+00:00",
        },
    )


def test_tableau_builds_username_password_auth() -> None:
    source = TableauSource(_username_password_recipe())

    auth = source._build_auth()

    assert auth.username == "svc_tableau"
    assert auth.password == "secret"
    assert auth.site_id == ""


def test_tableau_builds_personal_access_token_auth() -> None:
    source = TableauSource(_pat_recipe())

    auth = source._build_auth()

    assert auth.token_name == "new-token-3"
    assert auth.token_value == "token-value"
    assert auth.site_id == "classifyre"


def test_tableau_sampling_random_returns_all_when_below_limit() -> None:
    source = TableauSource(
        _pat_recipe(
            sampling={
                "strategy": "RANDOM",
            }
        )
    )

    refs = [
        _make_ref(
            source,
            raw_id=f"classifyre_#_workbook_#_{index}",
            kind="workbook",
            asset_id=str(index),
            name=f"workbook-{index}",
            updated_at=f"2026-02-2{index}T10:00:00+00:00",
        )
        for index in range(5)
    ]

    sampled = source._sample_refs(refs)

    assert len(sampled) == 5
    assert all(sample in refs for sample in sampled)


def test_tableau_sampling_latest_uses_updated_at() -> None:
    source = TableauSource(
        _pat_recipe(
            sampling={
                "strategy": "LATEST",
                "order_by_column": "updated_at",
            }
        )
    )
    refs = [
        _make_ref(
            source,
            raw_id=f"classifyre_#_workbook_#_{index}",
            kind="workbook",
            asset_id=str(index),
            name=f"workbook-{index}",
            updated_at=f"2026-02-2{index}T10:00:00+00:00",
        )
        for index in range(3)
    ]

    sampled = source._sample_refs(refs)

    assert [ref.asset_id for ref in sampled] == ["2", "1", "0"]


def test_tableau_sampling_all_keeps_everything() -> None:
    source = TableauSource(
        _pat_recipe(
            sampling={
                "strategy": "ALL",
            }
        )
    )
    refs = [
        _make_ref(
            source,
            raw_id=f"classifyre_#_datasource_#_{index}",
            kind="datasource",
            asset_id=str(index),
            name=f"datasource-{index}",
            updated_at=f"2026-02-1{index}T10:00:00+00:00",
        )
        for index in range(4)
    ]

    sampled = source._sample_refs(refs)

    assert sampled == refs


def test_tableau_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = TableauSource(_pat_recipe())
    server = _FakeServer(
        projects=[_FakeItem(id="p1", name="Finance")], workbooks=[], datasources=[]
    )
    monkeypatch.setattr(source, "_signed_in_server", lambda: _server_ctx(server))

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "PERSONAL_ACCESS_TOKEN" in result["message"]
    assert "Reachable projects: 1" in result["message"]


@pytest.mark.asyncio
async def test_tableau_extract_maps_project_links(monkeypatch: pytest.MonkeyPatch) -> None:
    source = TableauSource(
        _pat_recipe(
            optional={
                "extraction": {
                    "ingest_tags": True,
                    "ingest_owner": True,
                    "extract_usage_stats": True,
                },
            },
            sampling={
                "strategy": "ALL",
            },
        )
    )

    now = datetime.now(UTC)
    server = _FakeServer(
        projects=[_FakeItem(id="p1", name="Finance")],
        workbooks=[
            _FakeItem(
                id="wb1",
                name="Executive KPI",
                project_id="p1",
                project_name="Finance",
                webpage_url="https://tableau.example.com/#/workbooks/wb1",
                owner_id="owner-1",
                tags=[_FakeTag(name="executive"), _FakeTag(name="finance")],
                created_at=now,
                updated_at=now,
                total_views=42,
            )
        ],
        datasources=[
            _FakeItem(
                id="ds1",
                name="Revenue Mart",
                project_id="p1",
                project_name="Finance",
                webpage_url="https://tableau.example.com/#/datasources/ds1",
                owner_id="owner-1",
                tags=[_FakeTag(name="finance")],
                created_at=now,
                updated_at=now,
                total_views=11,
            )
        ],
    )
    monkeypatch.setattr(source, "_signed_in_server", lambda: _server_ctx(server))

    assets = []
    async for batch in source.extract():
        assets.extend(batch)

    by_name = {asset.name: asset for asset in assets}
    project_asset = by_name["classifyre / project / Finance"]
    workbook_asset = by_name["classifyre / workbook / Executive KPI"]
    datasource_asset = by_name["classifyre / datasource / Revenue Mart"]

    assert project_asset.links == []
    assert workbook_asset.links == [project_asset.hash]
    assert datasource_asset.links == [project_asset.hash]

    sampled = await source.fetch_content(workbook_asset.hash)
    assert sampled is not None
    raw_content, text_content = sampled
    assert "Executive KPI" in raw_content
    assert "sampling_strategy=" in text_content
