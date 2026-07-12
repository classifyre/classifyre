"""Microsoft 365 source — scan SharePoint sites, OneDrive, and Teams files via Graph API."""

from __future__ import annotations

import logging
import random
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from ...models.generated_input import (
    Microsoft365Ecosystem,
    Microsoft365Input,
    Microsoft365MaskedCertificate,
    Microsoft365MaskedClientSecret,
    Microsoft365MaskedManagedIdentity,
    Microsoft365OptionalConnection,
    Microsoft365OptionalExtraction,
    Microsoft365OptionalScope,
    Microsoft365RequiredCertificate,
    Microsoft365RequiredClientSecret,
    Microsoft365RequiredManagedIdentity,
    SamplingStrategy,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)
from ...utils.file_metadata import extract_file_metadata
from ...utils.file_parser import resolve_mime_type
from ...utils.hashing import hash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/x-ndjson",
}

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

_FILE_EXTENSION_HINTS: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".svg": OutputAssetType.IMAGE,
    ".bmp": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".mkv": OutputAssetType.VIDEO,
    ".avi": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".wav": OutputAssetType.AUDIO,
    ".aac": OutputAssetType.AUDIO,
    ".ogg": OutputAssetType.AUDIO,
    ".pdf": OutputAssetType.BINARY,
    ".docx": OutputAssetType.BINARY,
    ".xlsx": OutputAssetType.TABLE,
    ".pptx": OutputAssetType.BINARY,
    ".parquet": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".xml": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".md": OutputAssetType.TXT,
    ".html": OutputAssetType.TXT,
    ".htm": OutputAssetType.TXT,
}


@dataclass(frozen=True)
class SiteRef:
    site_id: str
    display_name: str
    web_url: str


@dataclass(frozen=True)
class DriveRef:
    drive_id: str
    display_name: str
    drive_type: str
    site_name: str
    quota_total: int | None = None
    quota_used: int | None = None


@dataclass
class DriveItemRef:
    item_id: str
    name: str
    path: str
    size: int
    created: datetime
    last_modified: datetime
    mime_type: str | None
    web_url: str
    etag: str | None
    created_by: str | None
    modified_by: str | None
    drive_id: str
    drive_name: str
    site_name: str
    ecosystem: str


class Microsoft365Source(BaseSource):
    source_type = "microsoft_365"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = Microsoft365Input.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._graph_client: Any = None
        self._credential: Any = None
        self._session: Any = None

        self._seen_hashes: set[str] = set()
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._bytes_cache: dict[str, bytes] = {}
        self._mime_cache: dict[str, str] = {}
        self._hash_to_url: dict[str, str] = {}

        self._validate_auth_configuration()

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, Microsoft365RequiredClientSecret):
            if not isinstance(masked, Microsoft365MaskedClientSecret):
                raise ValueError("CLIENT_SECRET auth requires masked.client_secret")
        elif isinstance(required, Microsoft365RequiredCertificate):
            if not isinstance(masked, Microsoft365MaskedCertificate):
                raise ValueError("CERTIFICATE auth requires masked.certificate_pem")
        elif isinstance(required, Microsoft365RequiredManagedIdentity):
            if not isinstance(masked, Microsoft365MaskedManagedIdentity):
                raise ValueError("MANAGED_IDENTITY auth requires empty masked credentials")

    # -- Config accessors --

    def _scope(self) -> Microsoft365OptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return Microsoft365OptionalScope()

    def _connection(self) -> Microsoft365OptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return Microsoft365OptionalConnection()

    def _extraction(self) -> Microsoft365OptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return Microsoft365OptionalExtraction()

    def _ecosystems(self) -> list[str]:
        scope = self._scope()
        if scope.ecosystems:
            return [e.value if hasattr(e, "value") else str(e) for e in scope.ecosystems]
        return [Microsoft365Ecosystem.sharepoint_sites.value]

    def _page_size(self) -> int:
        return int(self._connection().page_size or 200)

    def _max_object_bytes(self) -> int:
        return int(self._scope().max_object_bytes or 104857600)

    def _max_retries(self) -> int:
        return int(self._connection().max_retries or 3)

    def _rate_limit_delay(self) -> float:
        return float(self._connection().rate_limit_delay_seconds or 1.0)

    def _timeout_seconds(self) -> int:
        return int(self._connection().request_timeout_seconds or 30)

    # -- Graph client --

    def _build_credential(self) -> Any:
        identity = require_module(
            "azure.identity",
            "Microsoft 365",
            ["microsoft-graph"],
            detail="Azure Identity is required for Microsoft 365 authentication.",
        )
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, Microsoft365RequiredClientSecret):
            assert isinstance(masked, Microsoft365MaskedClientSecret)
            return identity.ClientSecretCredential(
                tenant_id=required.tenant_id,
                client_id=required.client_id,
                client_secret=masked.client_secret,
            )
        elif isinstance(required, Microsoft365RequiredCertificate):
            assert isinstance(masked, Microsoft365MaskedCertificate)
            pem_bytes = masked.certificate_pem.encode("utf-8")
            password_bytes = (
                masked.certificate_password.encode("utf-8") if masked.certificate_password else None
            )
            return identity.CertificateCredential(
                tenant_id=required.tenant_id,
                client_id=required.client_id,
                certificate_data=pem_bytes,
                password=password_bytes,
            )
        else:
            assert isinstance(required, Microsoft365RequiredManagedIdentity)
            kwargs: dict[str, Any] = {}
            if required.client_id:
                kwargs["client_id"] = required.client_id
            return identity.ManagedIdentityCredential(**kwargs)

    def _get_session(self) -> Any:
        if self._session is not None:
            return self._session

        import requests

        self._credential = self._build_credential()
        self._session = requests.Session()
        return self._session

    def _get_access_token(self) -> str:
        if self._credential is None:
            self._credential = self._build_credential()
        token = self._credential.get_token("https://graph.microsoft.com/.default")
        return token.token

    def _graph_get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        session = self._get_session()
        token = self._get_access_token()
        headers = {"Authorization": f"Bearer {token}"}

        for attempt in range(self._max_retries() + 1):
            try:
                response = session.get(
                    url,
                    headers=headers,
                    params=params,
                    timeout=self._timeout_seconds(),
                )
                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", self._rate_limit_delay()))
                    delay = retry_after * (2**attempt)
                    logger.warning(
                        "Graph API throttled (429), retrying in %ds (attempt %d/%d)",
                        delay,
                        attempt + 1,
                        self._max_retries(),
                    )
                    time.sleep(delay)
                    continue
                response.raise_for_status()
                return response.json()
            except Exception:
                if attempt >= self._max_retries():
                    raise
                delay = self._rate_limit_delay() * (2**attempt)
                logger.warning(
                    "Graph API request failed, retrying in %.1fs (attempt %d/%d)",
                    delay,
                    attempt + 1,
                    self._max_retries(),
                )
                time.sleep(delay)
        return {}

    def _graph_download(self, url: str) -> bytes:
        session = self._get_session()
        token = self._get_access_token()
        headers = {"Authorization": f"Bearer {token}"}

        for attempt in range(self._max_retries() + 1):
            try:
                response = session.get(
                    url,
                    headers=headers,
                    timeout=self._timeout_seconds(),
                    allow_redirects=True,
                )
                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", self._rate_limit_delay()))
                    delay = retry_after * (2**attempt)
                    logger.warning("Graph API throttled on download, retrying in %ds", delay)
                    time.sleep(delay)
                    continue
                response.raise_for_status()
                return response.content
            except Exception:
                if attempt >= self._max_retries():
                    raise
                time.sleep(self._rate_limit_delay() * (2**attempt))
        return b""

    def _graph_paged_list(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        max_items: int | None = None,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        request_params = dict(params or {})
        if "$top" not in request_params:
            request_params["$top"] = str(self._page_size())

        next_url: str | None = url
        while next_url:
            if self._aborted:
                break
            if max_items and len(items) >= max_items:
                break

            data = self._graph_get(next_url, params=request_params)
            page_items = data.get("value", [])
            items.extend(page_items)
            next_url = data.get("@odata.nextLink")
            request_params = {}

        if max_items:
            return items[:max_items]
        return items

    # -- Discovery --

    def _fetch_item_permissions(self, drive_id: str, item_id: str) -> list[dict[str, Any]] | None:
        """Fetch sharing permissions for a drive item, normalized to
        {role, grantee_type, grantee} entries. Returns None on failure so a
        permission-read error never blocks ingestion of the item itself."""
        url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{item_id}/permissions"
        try:
            raw = self._graph_paged_list(url)
        except Exception as exc:
            logger.warning(
                "Failed to fetch permissions for item %s in drive %s: %s",
                item_id,
                drive_id,
                exc,
            )
            return None

        normalized: list[dict[str, Any]] = []
        for perm in raw:
            roles = perm.get("roles") or []
            role = roles[0] if roles else "unknown"
            grantees = []
            granted = perm.get("grantedToV2") or perm.get("grantedTo") or {}
            if granted:
                grantees.append(granted)
            grantees.extend(perm.get("grantedToIdentitiesV2") or [])
            if not grantees and perm.get("link"):
                link = perm["link"]
                normalized.append(
                    {
                        "role": role,
                        "grantee_type": "link",
                        "grantee": link.get("scope", "unknown"),
                    }
                )
                continue
            for grantee_obj in grantees:
                for grantee_type in ("user", "group", "application", "siteUser", "device"):
                    identity = grantee_obj.get(grantee_type)
                    if identity:
                        normalized.append(
                            {
                                "role": role,
                                "grantee_type": grantee_type,
                                "grantee": identity.get("email")
                                or identity.get("displayName")
                                or identity.get("id", "unknown"),
                            }
                        )
                        break
        return normalized

    def _discover_sites(self) -> list[SiteRef]:
        site_filter = self._scope().site_filter or []
        data = self._graph_paged_list(
            "https://graph.microsoft.com/v1.0/sites",
            params={"search": "*", "$select": "id,displayName,webUrl"},
        )
        sites = []
        for item in data:
            site = SiteRef(
                site_id=item.get("id", ""),
                display_name=item.get("displayName", ""),
                web_url=item.get("webUrl", ""),
            )
            if site_filter:
                if not any(
                    f.lower() in site.web_url.lower() or f.lower() in site.display_name.lower()
                    for f in site_filter
                ):
                    continue
            sites.append(site)

        logger.info("Discovered %d SharePoint sites", len(sites))
        return sites

    def _discover_drives(self, site_id: str) -> list[DriveRef]:
        drive_filter = self._scope().drive_filter or []
        data = self._graph_paged_list(
            f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives",
            params={"$select": "id,name,driveType,quota"},
        )
        site_data = self._graph_get(
            f"https://graph.microsoft.com/v1.0/sites/{site_id}",
            params={"$select": "displayName"},
        )
        site_name = site_data.get("displayName", "")

        drives = []
        for item in data:
            drive = DriveRef(
                drive_id=item.get("id", ""),
                display_name=item.get("name", ""),
                drive_type=item.get("driveType", ""),
                site_name=site_name,
                quota_total=item.get("quota", {}).get("total"),
                quota_used=item.get("quota", {}).get("used"),
            )
            if drive_filter:
                if not any(
                    f.lower() in drive.display_name.lower() or f == drive.drive_id
                    for f in drive_filter
                ):
                    continue
            drives.append(drive)

        logger.info("Discovered %d drives in site '%s'", len(drives), site_name)
        return drives

    def _discover_onedrive_drives(self) -> list[DriveRef]:
        data = self._graph_paged_list(
            "https://graph.microsoft.com/v1.0/users",
            params={"$select": "id,displayName", "$top": "999"},
        )
        drives = []
        drive_filter = self._scope().drive_filter or []
        for user in data:
            if self._aborted:
                break
            try:
                drive_data = self._graph_get(
                    f"https://graph.microsoft.com/v1.0/users/{user['id']}/drive",
                    params={"$select": "id,name,driveType,quota"},
                )
                drive = DriveRef(
                    drive_id=drive_data.get("id", ""),
                    display_name=drive_data.get("name", f"{user.get('displayName', '')} OneDrive"),
                    drive_type=drive_data.get("driveType", "personal"),
                    site_name=user.get("displayName", ""),
                    quota_total=drive_data.get("quota", {}).get("total"),
                    quota_used=drive_data.get("quota", {}).get("used"),
                )
                if drive_filter and not any(
                    f.lower() in drive.display_name.lower() or f == drive.drive_id
                    for f in drive_filter
                ):
                    continue
                drives.append(drive)
            except Exception as exc:
                logger.debug("Could not access drive for user %s: %s", user.get("id"), exc)
        logger.info("Discovered %d OneDrive drives", len(drives))
        return drives

    def _discover_teams_drives(self) -> list[DriveRef]:
        data = self._graph_paged_list(
            "https://graph.microsoft.com/v1.0/groups",
            params={
                "$filter": "resourceProvisioningOptions/Any(x:x eq 'Team')",
                "$select": "id,displayName",
            },
        )
        drives = []
        drive_filter = self._scope().drive_filter or []
        for group in data:
            if self._aborted:
                break
            try:
                drive_data = self._graph_get(
                    f"https://graph.microsoft.com/v1.0/groups/{group['id']}/drive",
                    params={"$select": "id,name,driveType,quota"},
                )
                drive = DriveRef(
                    drive_id=drive_data.get("id", ""),
                    display_name=drive_data.get("name", f"{group.get('displayName', '')} Files"),
                    drive_type=drive_data.get("driveType", "documentLibrary"),
                    site_name=group.get("displayName", ""),
                    quota_total=drive_data.get("quota", {}).get("total"),
                    quota_used=drive_data.get("quota", {}).get("used"),
                )
                if drive_filter and not any(
                    f.lower() in drive.display_name.lower() or f == drive.drive_id
                    for f in drive_filter
                ):
                    continue
                drives.append(drive)
            except Exception as exc:
                logger.debug("Could not access drive for team %s: %s", group.get("id"), exc)
        logger.info("Discovered %d Teams drives", len(drives))
        return drives

    # -- Drive item iteration --

    def _iter_drive_items(
        self,
        drive_ref: DriveRef,
        ecosystem: str,
    ) -> list[DriveItemRef]:
        path_prefix = (self._scope().path_prefix or "").strip().rstrip("/")
        if path_prefix:
            root_url = (
                f"https://graph.microsoft.com/v1.0/drives/{drive_ref.drive_id}"
                f"/root:/{path_prefix.lstrip('/')}:/children"
            )
        else:
            root_url = f"https://graph.microsoft.com/v1.0/drives/{drive_ref.drive_id}/root/children"

        items: list[DriveItemRef] = []
        self._recurse_folder(
            drive_ref=drive_ref,
            url=root_url,
            parent_path=path_prefix or "/",
            ecosystem=ecosystem,
            items=items,
        )
        return items

    def _recurse_folder(
        self,
        drive_ref: DriveRef,
        url: str,
        parent_path: str,
        ecosystem: str,
        items: list[DriveItemRef],
    ) -> None:
        page_items = self._graph_paged_list(
            url,
            params={
                "$select": "id,name,size,createdDateTime,lastModifiedDateTime,file,folder,webUrl,eTag,createdBy,lastModifiedBy"
            },
        )
        for item in page_items:
            if self._aborted:
                return

            item_name = item.get("name", "")
            item_path = f"{parent_path}/{item_name}".replace("//", "/")

            if "folder" in item:
                folder_url = (
                    f"https://graph.microsoft.com/v1.0/drives/{drive_ref.drive_id}"
                    f"/items/{item['id']}/children"
                )
                self._recurse_folder(
                    drive_ref=drive_ref,
                    url=folder_url,
                    parent_path=item_path,
                    ecosystem=ecosystem,
                    items=items,
                )
                continue

            if "file" not in item:
                continue

            size = int(item.get("size", 0))
            if size > self._max_object_bytes():
                logger.debug("Skipping %s — %d bytes exceeds limit", item_path, size)
                continue

            if not self._matches_extension_filters(item_name):
                continue

            mime_type = item.get("file", {}).get("mimeType")
            created_by = _extract_user_name(item.get("createdBy"))
            modified_by = _extract_user_name(item.get("lastModifiedBy"))

            items.append(
                DriveItemRef(
                    item_id=item.get("id", ""),
                    name=item_name,
                    path=item_path,
                    size=size,
                    created=self._parse_graph_datetime(
                        item.get("createdDateTime") or item.get("lastModifiedDateTime")
                    ),
                    last_modified=self._parse_graph_datetime(item.get("lastModifiedDateTime")),
                    mime_type=mime_type,
                    web_url=item.get("webUrl", ""),
                    etag=item.get("eTag"),
                    created_by=created_by,
                    modified_by=modified_by,
                    drive_id=drive_ref.drive_id,
                    drive_name=drive_ref.display_name,
                    site_name=drive_ref.site_name,
                    ecosystem=ecosystem,
                )
            )

    def _matches_extension_filters(self, filename: str) -> bool:
        scope = self._scope()
        ext = PurePosixPath(filename).suffix.lower()

        include = scope.include_extensions
        if include:
            normalized_include = [
                e.lower() if e.startswith(".") else f".{e.lower()}" for e in include
            ]
            if ext not in normalized_include:
                return False

        exclude = scope.exclude_extensions
        if exclude:
            normalized_exclude = [
                e.lower() if e.startswith(".") else f".{e.lower()}" for e in exclude
            ]
            if ext in normalized_exclude:
                return False

        return True

    # -- Sampling --

    def _apply_sampling(
        self, items: list[DriveItemRef], *, cursor_key: str = "drive_items"
    ) -> list[DriveItemRef]:
        strategy = self.config.sampling.strategy
        limit = int(self.config.sampling.rows_per_page or 100)

        if strategy == SamplingStrategy.ALL:
            return items

        if strategy == SamplingStrategy.AUTOMATIC:
            # Newest-first stable order; per-drive window advances each run and wraps.
            items.sort(key=lambda ref: (ref.last_modified, ref.item_id), reverse=True)
            return self.automatic_window(items, key=cursor_key)

        if strategy == SamplingStrategy.RANDOM:
            if limit >= len(items):
                return items
            generator = random.Random(0)
            indexes = sorted(generator.sample(range(len(items)), k=limit))
            return [items[i] for i in indexes]

        items.sort(key=lambda ref: ref.last_modified, reverse=True)
        return items[:limit]

    # -- Asset construction --

    def _asset_type_from_mime_or_key(self, mime_type: str | None, key: str) -> OutputAssetType:
        normalized_mime = (mime_type or "").split(";", maxsplit=1)[0].strip().lower()
        extension = PurePosixPath(key).suffix.lower()

        if normalized_mime in _TABULAR_MIME_TYPES:
            return OutputAssetType.TABLE
        if normalized_mime.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized_mime.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized_mime.startswith("audio/"):
            return OutputAssetType.AUDIO
        if normalized_mime.startswith("text/") or normalized_mime in _TEXT_MIME_TYPES:
            return OutputAssetType.TXT

        if extension in _FILE_EXTENSION_HINTS:
            return _FILE_EXTENSION_HINTS[extension]

        if normalized_mime and normalized_mime != "application/octet-stream":
            return OutputAssetType.BINARY

        return OutputAssetType.OTHER

    def _drive_item_to_asset(
        self,
        ref: DriveItemRef,
        drive_hash: str,
    ) -> SingleAssetScanResults:
        raw_id = f"m365_file_#_{ref.drive_id}_#_{ref.item_id}"
        asset_hash = self.generate_hash_id(raw_id)
        self._seen_hashes.add(asset_hash)

        file_bytes: bytes | None = None
        parse_error: str | None = None
        mime_type = ref.mime_type or "application/octet-stream"

        if not self._discovery_only:
            try:
                download_url = (
                    f"https://graph.microsoft.com/v1.0/drives/{ref.drive_id}"
                    f"/items/{ref.item_id}/content"
                )
                file_bytes = self._graph_download(download_url)
                mime_type = resolve_mime_type(
                    file_bytes,
                    declared_mime_type=ref.mime_type,
                    file_name=ref.name,
                )
            except Exception as exc:
                parse_error = f"Download failed: {exc}"
                logger.warning("Failed to download %s: %s", ref.path, exc)

        if file_bytes:
            self._bytes_cache[asset_hash] = file_bytes
            self._mime_cache[asset_hash] = mime_type
            if ref.web_url:
                self._bytes_cache[ref.web_url] = file_bytes

        asset_type = self._asset_type_from_mime_or_key(mime_type, ref.name)

        file_meta = extract_file_metadata(file_bytes or b"", mime_type, file_name=ref.name)
        metadata: dict[str, Any] = {
            "drive_name": ref.drive_name,
            "item_path": ref.path,
            "ecosystem": ref.ecosystem,
            "size_bytes": ref.size,
            "mime_type": mime_type,
        }
        if ref.site_name:
            metadata["site_name"] = ref.site_name
        if ref.web_url:
            metadata["web_url"] = ref.web_url
        if ref.etag:
            metadata["etag"] = ref.etag
        if ref.created_by:
            metadata["created_by"] = ref.created_by
        if ref.modified_by:
            metadata["modified_by"] = ref.modified_by
        if parse_error:
            metadata["parse_error"] = parse_error

        if self._extraction().include_permissions:
            permissions = self._fetch_item_permissions(ref.drive_id, ref.item_id)
            if permissions is not None:
                metadata["permissions"] = permissions

        for key, value in file_meta.items():
            if value is not None and key not in metadata:
                metadata[key] = value

        if ref.web_url:
            self._hash_to_url[asset_hash] = ref.web_url

        checksum_data = {
            "drive_id": ref.drive_id,
            "item_id": ref.item_id,
            "size": ref.size,
            "last_modified": ref.last_modified.isoformat(),
            "etag": ref.etag or "",
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_data),
            name=ref.name,
            external_url=ref.web_url or f"graph://drives/{ref.drive_id}/items/{ref.item_id}",
            links=[drive_hash],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=ref.created,
            updated_at=ref.last_modified,
            runner_id=self.runner_id,
            **self.metadata_fields("file", metadata),
        )

    def _site_to_asset(self, site: SiteRef, drive_count: int) -> SingleAssetScanResults:
        raw_id = f"m365_site_#_{site.site_id}"
        asset_hash = self.generate_hash_id(raw_id)
        self._seen_hashes.add(asset_hash)

        metadata = {
            "site_id": site.site_id,
            "site_name": site.display_name,
            "site_url": site.web_url,
            "drive_count": drive_count,
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=site.display_name,
            external_url=site.web_url,
            links=[],
            asset_type=OutputAssetType.OTHER,
            source_id=self.source_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            runner_id=self.runner_id,
            **self.metadata_fields("site", metadata),
        )

    def _drive_to_asset(
        self,
        drive: DriveRef,
        site_hash: str | None,
    ) -> SingleAssetScanResults:
        raw_id = f"m365_drive_#_{drive.drive_id}"
        asset_hash = self.generate_hash_id(raw_id)
        self._seen_hashes.add(asset_hash)

        metadata: dict[str, Any] = {
            "drive_id": drive.drive_id,
            "drive_name": drive.display_name,
            "drive_type": drive.drive_type,
        }
        if drive.site_name:
            metadata["site_name"] = drive.site_name
        if drive.quota_total is not None:
            metadata["quota_total"] = drive.quota_total
        if drive.quota_used is not None:
            metadata["quota_used"] = drive.quota_used

        links = [site_hash] if site_hash else []

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=drive.display_name,
            external_url=f"graph://drives/{drive.drive_id}",
            links=links,
            asset_type=OutputAssetType.OTHER,
            source_id=self.source_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            runner_id=self.runner_id,
            **self.metadata_fields("drive", metadata),
        )

    # -- Main extraction --

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        ecosystems = self._ecosystems()
        batch: list[SingleAssetScanResults] = []
        extraction = self._extraction()
        include_sites = bool(extraction.include_site_metadata)
        include_drives = bool(extraction.include_drive_metadata)

        all_drives: list[tuple[DriveRef, str, str | None]] = []

        if Microsoft365Ecosystem.sharepoint_sites.value in ecosystems:
            sites = self._discover_sites()
            for site in sites:
                if self._aborted:
                    return

                drives = self._discover_drives(site.site_id)
                site_hash: str | None = None
                if include_sites:
                    site_asset = self._site_to_asset(site, len(drives))
                    site_hash = site_asset.hash
                    batch.append(site_asset)

                for drive in drives:
                    if include_drives:
                        drive_asset = self._drive_to_asset(drive, site_hash)
                        all_drives.append(
                            (drive, Microsoft365Ecosystem.sharepoint_sites.value, drive_asset.hash)
                        )
                        batch.append(drive_asset)
                    else:
                        drive_raw_id = f"m365_drive_#_{drive.drive_id}"
                        drive_hash = self.generate_hash_id(drive_raw_id)
                        all_drives.append(
                            (drive, Microsoft365Ecosystem.sharepoint_sites.value, drive_hash)
                        )

                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

        if Microsoft365Ecosystem.onedrive.value in ecosystems:
            drives = self._discover_onedrive_drives()
            for drive in drives:
                if self._aborted:
                    return
                if include_drives:
                    drive_asset = self._drive_to_asset(drive, None)
                    all_drives.append(
                        (drive, Microsoft365Ecosystem.onedrive.value, drive_asset.hash)
                    )
                    batch.append(drive_asset)
                else:
                    drive_raw_id = f"m365_drive_#_{drive.drive_id}"
                    drive_hash = self.generate_hash_id(drive_raw_id)
                    all_drives.append((drive, Microsoft365Ecosystem.onedrive.value, drive_hash))

        if Microsoft365Ecosystem.teams_files.value in ecosystems:
            drives = self._discover_teams_drives()
            for drive in drives:
                if self._aborted:
                    return
                if include_drives:
                    drive_asset = self._drive_to_asset(drive, None)
                    all_drives.append(
                        (drive, Microsoft365Ecosystem.teams_files.value, drive_asset.hash)
                    )
                    batch.append(drive_asset)
                else:
                    drive_raw_id = f"m365_drive_#_{drive.drive_id}"
                    drive_hash = self.generate_hash_id(drive_raw_id)
                    all_drives.append((drive, Microsoft365Ecosystem.teams_files.value, drive_hash))

        if len(batch) >= self.BATCH_SIZE:
            yield batch
            batch = []

        for drive_ref, ecosystem, drive_hash in all_drives:
            if self._aborted:
                return

            items = self._iter_drive_items(drive_ref, ecosystem)
            sampled = self._apply_sampling(items, cursor_key=f"drive_items:{drive_ref.drive_id}")

            logger.info(
                "Processing %d/%d items from drive '%s' (%s)",
                len(sampled),
                len(items),
                drive_ref.display_name,
                ecosystem,
            )

            for item_ref in sampled:
                if self._aborted:
                    return

                asset = self._drive_item_to_asset(item_ref, drive_hash or "")
                batch.append(asset)

                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

        if batch:
            yield batch

    # -- Required interface methods --

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id("MICROSOFT_365", asset_id)

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": "MICROSOFT_365",
        }
        try:
            data = self._graph_get(
                "https://graph.microsoft.com/v1.0/sites",
                params={"search": "*", "$top": "1", "$select": "id,displayName"},
            )
            sites = data.get("value", [])
            result["status"] = "SUCCESS"
            if sites:
                result["message"] = (
                    f"Connected to Microsoft Graph API. Found site: {sites[0].get('displayName', 'unknown')}"
                )
            else:
                result["message"] = "Connected to Microsoft Graph API. No sites accessible."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Microsoft Graph API: {exc}"
        return result

    def abort(self) -> None:
        self._aborted = True

    def cleanup(self) -> None:
        if self._session is not None:
            self._session.close()
            self._session = None
        self._bytes_cache.clear()
        self._mime_cache.clear()
        self._content_cache.clear()

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._bytes_cache.pop(asset_hash, None)
        self._mime_cache.pop(asset_hash, None)
        self._content_cache.pop(asset_hash, None)
        url = self._hash_to_url.get(asset_hash)
        if url:
            self._bytes_cache.pop(url, None)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        if asset_id in self._content_cache:
            return self._content_cache[asset_id]

        file_bytes = self._bytes_cache.get(asset_id)
        if not file_bytes:
            return None

        mime = self._mime_cache.get(asset_id, "application/octet-stream")
        parsed = self.parse_asset_bytes(file_bytes, declared_mime_type=mime)
        result = (parsed.raw_content, parsed.text_content)
        self._content_cache[asset_id] = result
        return result

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        file_bytes = self._bytes_cache.get(asset_id)
        if not file_bytes:
            return None
        mime = self._mime_cache.get(asset_id, "application/octet-stream")
        return file_bytes, mime

    # -- Utilities --

    @staticmethod
    def _parse_graph_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)
        if isinstance(value, str) and value.strip():
            normalized = value.strip().replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=UTC)
                return parsed.astimezone(UTC)
            except ValueError:
                pass
        return datetime.now(UTC)


def _extract_user_name(user_obj: Any) -> str | None:
    if not user_obj or not isinstance(user_obj, dict):
        return None
    user = user_obj.get("user", {})
    if isinstance(user, dict):
        return user.get("displayName") or user.get("email")
    return None
