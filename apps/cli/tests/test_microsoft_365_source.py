"""Unit tests for the Microsoft 365 source."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.sources.microsoft_365.source import (
    DriveItemRef,
    Microsoft365Source,
    _extract_user_name,
)


def _base_recipe(
    auth_mode: str = "CLIENT_SECRET",
    **overrides: object,
) -> dict:
    if auth_mode == "CLIENT_SECRET":
        required = {
            "auth_mode": "CLIENT_SECRET",
            "tenant_id": "tenant-1",
            "client_id": "client-1",
        }
        masked = {"client_secret": "secret-1"}
    elif auth_mode == "CERTIFICATE":
        required = {
            "auth_mode": "CERTIFICATE",
            "tenant_id": "tenant-1",
            "client_id": "client-1",
        }
        masked = {"certificate_pem": "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"}
    elif auth_mode == "MANAGED_IDENTITY":
        required = {"auth_mode": "MANAGED_IDENTITY"}
        masked = {}
    else:
        raise ValueError(f"Unknown auth_mode: {auth_mode}")

    recipe: dict = {
        "type": "MICROSOFT_365",
        "required": required,
        "masked": masked,
        "sampling": {"strategy": "LATEST"},
        **overrides,
    }
    return recipe


class TestAuthValidation:
    def test_client_secret_valid(self) -> None:
        source = Microsoft365Source(_base_recipe("CLIENT_SECRET"))
        assert source.source_type == "microsoft_365"

    def test_certificate_valid(self) -> None:
        source = Microsoft365Source(_base_recipe("CERTIFICATE"))
        assert source.config.required.auth_mode == "CERTIFICATE"

    def test_managed_identity_valid(self) -> None:
        source = Microsoft365Source(_base_recipe("MANAGED_IDENTITY"))
        assert source.config.required.auth_mode == "MANAGED_IDENTITY"

    def test_mismatched_auth_raises(self) -> None:
        recipe = {
            "type": "MICROSOFT_365",
            "required": {
                "auth_mode": "CLIENT_SECRET",
                "tenant_id": "t",
                "client_id": "c",
            },
            "masked": {"certificate_pem": "bad"},
            "sampling": {"strategy": "LATEST"},
        }
        with pytest.raises(ValueError):
            Microsoft365Source(recipe)


class TestSampling:
    def _make_items(self, count: int) -> list[DriveItemRef]:
        from datetime import UTC, datetime, timedelta

        base = datetime(2025, 1, 1, tzinfo=UTC)
        return [
            DriveItemRef(
                item_id=f"item-{i}",
                name=f"file-{i}.pdf",
                path=f"/docs/file-{i}.pdf",
                size=1000 * (i + 1),
                created=base + timedelta(days=i),
                last_modified=base + timedelta(days=i),
                mime_type="application/pdf",
                web_url=f"https://example.com/file-{i}",
                etag=None,
                created_by=None,
                modified_by=None,
                drive_id="drive-1",
                drive_name="Documents",
                site_name="Test Site",
                ecosystem="sharepoint_sites",
            )
            for i in range(count)
        ]

    def test_latest_returns_most_recent(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        items = self._make_items(20)
        sampled = source._apply_sampling(items)
        assert len(sampled) == 10
        assert sampled[0].item_id == "item-19"

    def test_random_returns_limited(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        items = self._make_items(20)
        sampled = source._apply_sampling(items)
        assert len(sampled) == 10

    def test_random_is_deterministic(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        items = self._make_items(20)
        sampled1 = source._apply_sampling(items)
        sampled2 = source._apply_sampling(items)
        assert [s.item_id for s in sampled1] == [s.item_id for s in sampled2]

    def test_all_returns_everything(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "ALL"})
        source = Microsoft365Source(recipe)
        items = self._make_items(10)
        sampled = source._apply_sampling(items)
        assert len(sampled) == 10

    def test_automatic_advances_cursor_between_runs(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        items = self._make_items(25)

        first = source._apply_sampling(list(items), cursor_key="drive_items:drive-1")
        assert [s.item_id for s in first] == [f"item-{i}" for i in range(24, 14, -1)]
        assert source.current_sampling_cursor()["drive_items:drive-1"] == 10

        # Second run resumes from the persisted cursor
        source2 = Microsoft365Source(recipe)
        source2._sampling_cursor = {"drive_items:drive-1": 10}
        second = source2._apply_sampling(list(items), cursor_key="drive_items:drive-1")
        assert [s.item_id for s in second] == [f"item-{i}" for i in range(14, 4, -1)]
        assert source2.current_sampling_cursor()["drive_items:drive-1"] == 20

    def test_automatic_wraps_around(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        source._sampling_cursor = {"drive_items:drive-1": 20}
        items = self._make_items(25)
        sampled = source._apply_sampling(list(items), cursor_key="drive_items:drive-1")
        assert len(sampled) == 5
        assert source.current_sampling_cursor()["drive_items:drive-1"] == 0

    def test_automatic_uses_per_drive_cursor_keys(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
        source = Microsoft365Source(recipe)
        items = self._make_items(25)
        source._apply_sampling(list(items), cursor_key="drive_items:drive-1")
        source._apply_sampling(list(items), cursor_key="drive_items:drive-2")
        cursor = source.current_sampling_cursor()
        assert cursor["drive_items:drive-1"] == 10
        assert cursor["drive_items:drive-2"] == 10


class TestExtensionFiltering:
    def test_include_extensions(self) -> None:
        recipe = _base_recipe(optional={"scope": {"include_extensions": [".pdf", ".docx"]}})
        source = Microsoft365Source(recipe)
        assert source._matches_extension_filters("report.pdf")
        assert source._matches_extension_filters("doc.docx")
        assert not source._matches_extension_filters("image.png")

    def test_exclude_extensions(self) -> None:
        recipe = _base_recipe(optional={"scope": {"exclude_extensions": [".mp4", ".mov"]}})
        source = Microsoft365Source(recipe)
        assert source._matches_extension_filters("report.pdf")
        assert not source._matches_extension_filters("video.mp4")

    def test_no_filters_allows_all(self) -> None:
        source = Microsoft365Source(_base_recipe())
        assert source._matches_extension_filters("anything.xyz")


class TestHashGeneration:
    def test_hash_is_deterministic(self) -> None:
        source = Microsoft365Source(_base_recipe())
        h1 = source.generate_hash_id("m365_file_#_drive-1_#_item-1")
        h2 = source.generate_hash_id("m365_file_#_drive-1_#_item-1")
        assert h1 == h2

    def test_different_ids_produce_different_hashes(self) -> None:
        source = Microsoft365Source(_base_recipe())
        h1 = source.generate_hash_id("m365_file_#_drive-1_#_item-1")
        h2 = source.generate_hash_id("m365_file_#_drive-1_#_item-2")
        assert h1 != h2


class TestConfigAccessors:
    def test_default_ecosystems(self) -> None:
        source = Microsoft365Source(_base_recipe())
        assert source._ecosystems() == ["sharepoint_sites"]

    def test_custom_ecosystems(self) -> None:
        recipe = _base_recipe(optional={"scope": {"ecosystems": ["onedrive", "teams_files"]}})
        source = Microsoft365Source(recipe)
        ecosystems = source._ecosystems()
        assert "onedrive" in ecosystems
        assert "teams_files" in ecosystems

    def test_default_page_size(self) -> None:
        source = Microsoft365Source(_base_recipe())
        assert source._page_size() == 200

    def test_custom_page_size(self) -> None:
        recipe = _base_recipe(optional={"connection": {"page_size": 500}})
        source = Microsoft365Source(recipe)
        assert source._page_size() == 500

    def test_max_object_bytes_default(self) -> None:
        source = Microsoft365Source(_base_recipe())
        assert source._max_object_bytes() == 104857600


class TestUserNameExtraction:
    def test_extracts_display_name(self) -> None:
        assert _extract_user_name({"user": {"displayName": "John"}}) == "John"

    def test_extracts_email(self) -> None:
        assert _extract_user_name({"user": {"email": "j@e.com"}}) == "j@e.com"

    def test_returns_none_for_missing(self) -> None:
        assert _extract_user_name(None) is None
        assert _extract_user_name({}) is None


class TestAssetMetadataContract:
    def test_file_metadata_validates(self) -> None:
        source = Microsoft365Source(_base_recipe())
        result = source.metadata_fields(
            "file",
            {
                "drive_name": "Documents",
                "item_path": "/test.pdf",
                "ecosystem": "sharepoint_sites",
                "size_bytes": 1024,
                "mime_type": "application/pdf",
            },
        )
        assert result["asset_kind"] == "file"
        assert result["metadata"]["drive_name"] == "Documents"

    def test_site_metadata_validates(self) -> None:
        source = Microsoft365Source(_base_recipe())
        result = source.metadata_fields(
            "site",
            {
                "site_id": "site-1",
                "site_name": "Test Site",
                "site_url": "https://example.sharepoint.com",
                "drive_count": 3,
            },
        )
        assert result["asset_kind"] == "site"

    def test_drive_metadata_validates(self) -> None:
        source = Microsoft365Source(_base_recipe())
        result = source.metadata_fields(
            "drive",
            {
                "drive_id": "drive-1",
                "drive_name": "Documents",
                "drive_type": "documentLibrary",
            },
        )
        assert result["asset_kind"] == "drive"


class _FakeResponse:
    def __init__(
        self,
        json_data: dict | None = None,
        content: bytes = b"",
        status_code: int = 200,
        headers: dict | None = None,
    ) -> None:
        self._json = json_data or {}
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}

    def json(self) -> dict:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _RoutingSession:
    """Fake requests.Session routing GETs by URL substring.

    Route values are either a _FakeResponse or a list of them (popped per call).
    """

    def __init__(self, routes: dict[str, object]) -> None:
        self.routes = routes
        self.calls: list[tuple[str, dict]] = []

    def get(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((url, dict(kwargs)))
        for fragment, response in self.routes.items():
            if fragment in url:
                if isinstance(response, list):
                    return response.pop(0)
                assert isinstance(response, _FakeResponse)
                return response
        raise AssertionError(f"Unrouted URL: {url}")


def _wire_fake_http(source: Microsoft365Source, session: _RoutingSession) -> None:
    source._session = session  # type: ignore[assignment]
    credential = MagicMock()
    credential.get_token.return_value = MagicMock(token="fake-token")
    source._credential = credential


class TestGraphHttp:
    def test_paged_list_follows_next_link(self) -> None:
        source = Microsoft365Source(_base_recipe())
        page2_url = "https://graph.microsoft.com/v1.0/next-page-xyz"
        session = _RoutingSession(
            {
                "next-page-xyz": _FakeResponse({"value": [{"id": "b"}]}),
                "/items-endpoint": _FakeResponse(
                    {"value": [{"id": "a"}], "@odata.nextLink": page2_url}
                ),
            }
        )
        _wire_fake_http(source, session)

        items = source._graph_paged_list(
            "https://graph.microsoft.com/v1.0/items-endpoint",
            params={"$select": "id"},
        )

        assert [i["id"] for i in items] == ["a", "b"]
        assert len(session.calls) == 2
        # nextLink already embeds query params; they must not be re-sent
        assert session.calls[1][0] == page2_url
        assert session.calls[1][1]["params"] == {}

    def test_graph_get_retries_on_429(self) -> None:
        recipe = _base_recipe(
            optional={"connection": {"rate_limit_delay_seconds": 0.0}},
        )
        source = Microsoft365Source(recipe)
        session = _RoutingSession(
            {
                "/throttled": [
                    _FakeResponse(status_code=429, headers={"Retry-After": "0"}),
                    _FakeResponse({"value": "ok"}),
                ],
            }
        )
        _wire_fake_http(source, session)

        data = source._graph_get("https://graph.microsoft.com/v1.0/throttled")

        assert data == {"value": "ok"}
        assert len(session.calls) == 2

    def test_fetch_item_permissions_normalizes(self) -> None:
        source = Microsoft365Source(_base_recipe())
        session = _RoutingSession(
            {
                "/permissions": _FakeResponse(
                    {
                        "value": [
                            {
                                "roles": ["write"],
                                "grantedToV2": {
                                    "user": {"email": "alice@example.com", "displayName": "Alice"}
                                },
                            },
                            {
                                "roles": ["read"],
                                "link": {"scope": "organization"},
                            },
                        ]
                    }
                ),
            }
        )
        _wire_fake_http(source, session)

        permissions = source._fetch_item_permissions("drive-1", "item-1")

        assert permissions == [
            {"role": "write", "grantee_type": "user", "grantee": "alice@example.com"},
            {"role": "read", "grantee_type": "link", "grantee": "organization"},
        ]

    def test_fetch_item_permissions_returns_none_on_error(self) -> None:
        source = Microsoft365Source(
            _base_recipe(
                optional={"connection": {"rate_limit_delay_seconds": 0.0, "max_retries": 0}}
            )
        )
        session = _RoutingSession(
            {
                "/permissions": _FakeResponse(status_code=403),
            }
        )
        _wire_fake_http(source, session)

        assert source._fetch_item_permissions("drive-1", "item-1") is None


class TestExtractRawEndToEnd:
    def _routes(self) -> dict[str, object]:
        return {
            "/sites/site-1/drives": _FakeResponse(
                {
                    "value": [
                        {
                            "id": "drive-1",
                            "name": "Documents",
                            "driveType": "documentLibrary",
                            "quota": {"total": 1000, "used": 10},
                        }
                    ]
                }
            ),
            "/drives/drive-1/root/children": _FakeResponse(
                {
                    "value": [
                        {"id": "folder-1", "name": "docs", "folder": {}},
                        {
                            "id": "file-1",
                            "name": "report.pdf",
                            "size": 13,
                            "file": {"mimeType": "application/pdf"},
                            "createdDateTime": "2025-01-01T00:00:00Z",
                            "lastModifiedDateTime": "2025-02-01T00:00:00Z",
                            "webUrl": "https://example.sharepoint.com/report.pdf",
                            "eTag": "etag-1",
                        },
                    ]
                }
            ),
            "/drives/drive-1/items/folder-1/children": _FakeResponse(
                {
                    "value": [
                        {
                            "id": "file-2",
                            "name": "notes.txt",
                            "size": 11,
                            "file": {"mimeType": "text/plain"},
                            "createdDateTime": "2025-03-01T00:00:00Z",
                            "lastModifiedDateTime": "2025-03-02T00:00:00Z",
                            "webUrl": "https://example.sharepoint.com/notes.txt",
                        },
                    ]
                }
            ),
            "/drives/drive-1/items/file-1/content": _FakeResponse(content=b"%PDF-1.4 fake"),
            "/drives/drive-1/items/file-2/content": _FakeResponse(content=b"hello world"),
            "/sites/site-1": _FakeResponse({"displayName": "Test Site"}),
            "/sites": _FakeResponse(
                {
                    "value": [
                        {
                            "id": "site-1",
                            "displayName": "Test Site",
                            "webUrl": "https://example.sharepoint.com",
                        }
                    ]
                }
            ),
        }

    async def test_extract_raw_downloads_real_content(self) -> None:
        recipe = _base_recipe(sampling={"strategy": "ALL"})
        source = Microsoft365Source(recipe)
        _wire_fake_http(source, _RoutingSession(self._routes()))

        assets = []
        async for batch in source.extract_raw():
            assets.extend(batch)

        files = {a.name: a for a in assets if a.asset_kind == "file"}
        assert set(files) == {"report.pdf", "notes.txt"}

        report = files["report.pdf"]
        drive_hash = source.generate_hash_id("m365_drive_#_drive-1")
        assert report.links == [drive_hash]
        assert report.metadata["item_path"] == "/report.pdf"
        assert report.created_at.isoformat().startswith("2025-01-01")
        assert report.updated_at.isoformat().startswith("2025-02-01")

        content = await source.fetch_content_bytes(report.hash)
        assert content is not None
        assert content[0] == b"%PDF-1.4 fake"

        notes_content = await source.fetch_content_bytes(files["notes.txt"].hash)
        assert notes_content is not None
        assert notes_content[0] == b"hello world"
