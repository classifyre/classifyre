from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from ...models.generated_input import DropboxInput, DropboxRequiredOAuth
from ...models.generated_single_asset_scan_results import SingleAssetScanResults
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)

# Dropbox Paper docs (and a few other cloud-native items) carry no downloadable
# bytes. They are exported instead; markdown keeps the text intact for detectors.
_EXPORT_MIME_TYPES = {
    "markdown": "text/markdown",
    "html": "text/html",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
_PREFERRED_EXPORT_FORMATS = ("markdown", "html")

# Dropbox-defined role IDs are stable across teams; only a full team admin can
# be impersonated with as_admin().
_TEAM_ADMIN_ROLE_SUFFIX = "team_admin"


@dataclass(frozen=True)
class DropboxScanTarget:
    """One Dropbox namespace to walk.

    An individual account has exactly one target (the account itself). A
    Business team has one per selected member folder plus one per team folder.
    """

    kind: str = "account"  # account | member_folder | team_folder
    member_id: str | None = None  # team member to impersonate
    member_email: str | None = None
    namespace_id: str | None = None  # path root to apply; None = the home namespace
    label: str = ""

    @property
    def client_key(self) -> tuple[str, str]:
        return (self.member_id or "", self.namespace_id or "")


_ACCOUNT_TARGET = DropboxScanTarget()


@dataclass(frozen=True)
class DropboxObjectRef(ObjectRef):
    """An ObjectRef carrying the Dropbox identity fields.

    ``key`` is the display path (used for naming, extension filters and MIME
    inference); ``file_id`` is the immutable Dropbox ID that survives moves and
    renames, and is what the asset hash is derived from.
    """

    file_id: str = ""
    rev: str | None = None
    is_downloadable: bool = True
    export_format: str | None = None
    preview_url: str | None = None
    target: DropboxScanTarget = _ACCOUNT_TARGET


class DropboxSource(ObjectStorageSourceBase):
    """Scan files stored in a Dropbox account.

    Asset identity is anchored to the Dropbox file ID rather than the path, so
    moving or renaming a file keeps its assets, findings and history intact.
    """

    source_type = "dropbox"
    provider_label = "DROPBOX"
    input_model = DropboxInput

    DEFAULT_MAX_ENTRIES_PER_PAGE = 500

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        # Populated while listing so _external_url() (which only receives the
        # path) can resolve the stable file ID for that path.
        self._ref_by_key: dict[str, DropboxObjectRef] = {}
        self._exported_as_by_key: dict[str, str] = {}
        self._cached_team_client: Any | None = None
        self._client_by_target: dict[tuple[str, str], Any] = {}

    # ── configuration ────────────────────────────────────────────────────

    def _team_option(self, key: str, default: Any = None) -> Any:
        optional = self.config.optional
        team = getattr(optional, "team", None) if optional else None
        if team is not None:
            value = getattr(team, key, None)
            if value is not None:
                return value
        return default

    def _team_enabled(self) -> bool:
        return bool(self._team_option("enabled", False))

    def _team_as_admin(self) -> bool:
        return bool(self._team_option("as_admin", False))

    def _team_member_emails(self) -> set[str]:
        values = self._team_option("member_emails", []) or []
        return {str(value).strip().lower() for value in values if str(value).strip()}

    def _include_member_folders(self) -> bool:
        return bool(self._team_option("include_member_folders", True))

    def _include_team_space(self) -> bool:
        return bool(self._team_option("include_team_space", True))

    def _include_suspended_members(self) -> bool:
        return bool(self._team_option("include_suspended_members", False))

    def _folder_path(self) -> str:
        """Dropbox root is the empty string; sub-folders are '/Foo/Bar'."""
        value = self._scope_option("folder_path", "")
        path = str(value or "").strip().rstrip("/")
        if not path:
            return ""
        return path if path.startswith("/") else f"/{path}"

    def _recursive(self) -> bool:
        value = self._scope_option("recursive", True)
        return bool(value) if isinstance(value, bool) else True

    def _include_mounted_folders(self) -> bool:
        value = self._scope_option("include_mounted_folders", True)
        return bool(value) if isinstance(value, bool) else True

    def _export_non_downloadable(self) -> bool:
        value = self._scope_option("export_non_downloadable", True)
        return bool(value) if isinstance(value, bool) else True

    def _max_keys_per_page(self) -> int:
        value = self._connection_option("max_entries_per_page", self.DEFAULT_MAX_ENTRIES_PER_PAGE)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return self.DEFAULT_MAX_ENTRIES_PER_PAGE
        return min(max(parsed, 1), 2000)

    def _max_retries(self) -> int:
        value = self._connection_option("max_retries", 4)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 4
        return min(max(parsed, 0), 10)

    # ── client ───────────────────────────────────────────────────────────

    def _sdk(self) -> Any:
        return require_module(
            module_name="dropbox",
            source_name="Dropbox",
            uv_groups=["dropbox"],
            detail="Dropbox scanning requires the official Dropbox SDK.",
        )

    def _credential_kwargs(self) -> dict[str, Any]:
        """Constructor kwargs shared by Dropbox and DropboxTeam.

        Both client classes take the same credentials; what differs between an
        individual and a Business scan is the access type granted to the app,
        not the shape of the secret.
        """
        common: dict[str, Any] = {
            "timeout": self._request_timeout_seconds(),
            "max_retries_on_error": self._max_retries(),
            "max_retries_on_rate_limit": self._max_retries(),
            "user_agent": "classifyre",
        }

        required = self.config.required
        if isinstance(required, DropboxRequiredOAuth):
            app_key = str(required.app_key or "").strip()
            app_secret = self._masked_value("app_secret")
            refresh_token = self._masked_value("refresh_token")
            if not app_key or not app_secret or not refresh_token:
                raise ValueError(
                    "Dropbox OAuth authentication requires required.app_key, "
                    "masked.app_secret and masked.refresh_token"
                )
            return {
                "oauth2_refresh_token": refresh_token,
                "app_key": app_key,
                "app_secret": app_secret,
                **common,
            }

        access_token = self._masked_value("access_token")
        if not access_token:
            raise ValueError("Dropbox access token authentication requires masked.access_token")
        return {"oauth2_access_token": access_token, **common}

    def _build_client(self) -> Any:
        return self._sdk().Dropbox(**self._credential_kwargs())

    def _build_team_client(self) -> Any:
        return self._sdk().DropboxTeam(**self._credential_kwargs())

    def _client(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._build_client()
        return self._cached_client

    def _team_client(self) -> Any:
        if self._cached_team_client is None:
            self._cached_team_client = self._build_team_client()
        return self._cached_team_client

    def _client_for(self, target: DropboxScanTarget) -> Any:
        """Resolve the file-operations client for one namespace.

        Individual accounts always use the plain client. Team scans impersonate
        a member (``as_user``) or an administrator (``as_admin``) and, when the
        namespace is not that identity's home folder, pin the path root to it.
        """
        if not self._team_enabled() or not target.member_id:
            return self._client()

        cached = self._client_by_target.get(target.client_key)
        if cached is not None:
            return cached

        team = self._team_client()
        client = (
            team.as_admin(target.member_id)
            if self._team_as_admin()
            else team.as_user(target.member_id)
        )
        if target.namespace_id:
            path_root = self._sdk().common.PathRoot.namespace_id(target.namespace_id)
            client = client.with_path_root(path_root)

        self._client_by_target[target.client_key] = client
        return client

    # ── team discovery ───────────────────────────────────────────────────

    def _team_members(self) -> list[dict[str, Any]]:
        """Active (and optionally suspended) team members matching the filter."""
        team = self._team_client()
        wanted_emails = self._team_member_emails()
        include_suspended = self._include_suspended_members()

        members: list[dict[str, Any]] = []
        result = team.team_members_list_v2(limit=min(self._max_keys_per_page(), 1000))
        while True:
            for entry in result.members or []:
                profile = getattr(entry, "profile", None)
                if profile is None:
                    continue
                status = getattr(profile, "status", None)
                if not self._member_status_allowed(status, include_suspended):
                    continue
                email = str(getattr(profile, "email", "") or "").strip()
                if wanted_emails and email.lower() not in wanted_emails:
                    continue
                members.append(
                    {
                        "team_member_id": str(getattr(profile, "team_member_id", "") or ""),
                        "email": email,
                        "is_team_admin": self._is_team_admin(entry),
                    }
                )

            if not getattr(result, "has_more", False):
                break
            result = team.team_members_list_continue_v2(result.cursor)

        unmatched = wanted_emails - {member["email"].lower() for member in members}
        if unmatched:
            logger.warning(
                "Dropbox team members not found or filtered out: %s", ", ".join(sorted(unmatched))
            )
        return members

    @staticmethod
    def _member_status_allowed(status: Any, include_suspended: bool) -> bool:
        is_active = getattr(status, "is_active", None)
        if callable(is_active) and is_active():
            return True
        is_suspended = getattr(status, "is_suspended", None)
        if include_suspended and callable(is_suspended) and is_suspended():
            return True
        return False

    @staticmethod
    def _is_team_admin(member: Any) -> bool:
        for role in getattr(member, "roles", None) or []:
            role_id = str(getattr(role, "role_id", "") or "")
            if role_id.endswith(_TEAM_ADMIN_ROLE_SUFFIX):
                return True
        return False

    def _team_namespaces(self) -> list[Any]:
        team = self._team_client()
        namespaces: list[Any] = []
        result = team.team_namespaces_list(limit=min(self._max_keys_per_page(), 1000))
        while True:
            namespaces.extend(result.namespaces or [])
            if not getattr(result, "has_more", False):
                break
            result = team.team_namespaces_list_continue(result.cursor)
        return namespaces

    @staticmethod
    def _namespace_kind(namespace: Any) -> str:
        namespace_type = getattr(namespace, "namespace_type", None)
        for name in ("team_folder", "team_member_folder", "shared_folder", "app_folder"):
            predicate = getattr(namespace_type, f"is_{name}", None)
            if callable(predicate) and predicate():
                return name
        return str(getattr(namespace_type, "_tag", "") or "")

    def _root_namespace_id(self, client: Any) -> str | None:
        """The identity's team-space root, or None when the team has no team space."""
        try:
            account = client.users_get_current_account()
        except Exception as exc:
            logger.warning("Failed to resolve Dropbox root namespace: %s", exc)
            return None
        root_info = getattr(account, "root_info", None)
        root_namespace_id = str(getattr(root_info, "root_namespace_id", "") or "")
        home_namespace_id = str(getattr(root_info, "home_namespace_id", "") or "")
        if not root_namespace_id or root_namespace_id == home_namespace_id:
            return None
        return root_namespace_id

    def _scan_targets(self) -> list[DropboxScanTarget]:
        """The namespaces this run walks, in listing order."""
        if not self._team_enabled():
            return [_ACCOUNT_TARGET]

        members = self._team_members()
        if not members:
            raise ValueError(
                "No Dropbox Business team members matched the configured filter. "
                "Check optional.team.member_emails, or that the token has the "
                "'Team member management' scope."
            )

        if self._team_as_admin():
            return self._admin_scan_targets(members)
        return self._member_scan_targets(members)

    def _admin_scan_targets(self, members: list[dict[str, Any]]) -> list[DropboxScanTarget]:
        """Namespace-per-target traversal using one administrator identity.

        ``as_admin`` needs a team admin's member ID and only reaches content
        through an explicit path root, so every namespace is enumerated up front.
        """
        admin = next((member for member in members if member["is_team_admin"]), None)
        if admin is None:
            raise ValueError(
                "optional.team.as_admin requires a team administrator on the team, "
                "but none was found among the selected members. Clear the member "
                "filter or disable as_admin to scan as each member instead."
            )

        selected_ids = {member["team_member_id"] for member in members}
        email_by_id = {member["team_member_id"]: member["email"] for member in members}

        targets: list[DropboxScanTarget] = []
        for namespace in self._team_namespaces():
            kind = self._namespace_kind(namespace)
            namespace_id = str(getattr(namespace, "namespace_id", "") or "")
            name = str(getattr(namespace, "name", "") or "")
            if not namespace_id:
                continue

            if kind == "team_member_folder" and self._include_member_folders():
                owner_id = str(getattr(namespace, "team_member_id", "") or "")
                if owner_id not in selected_ids:
                    continue
                targets.append(
                    DropboxScanTarget(
                        kind="member_folder",
                        member_id=admin["team_member_id"],
                        member_email=email_by_id.get(owner_id) or name,
                        namespace_id=namespace_id,
                        label=name or email_by_id.get(owner_id, namespace_id),
                    )
                )
            elif kind == "team_folder" and self._include_team_space():
                targets.append(
                    DropboxScanTarget(
                        kind="team_folder",
                        member_id=admin["team_member_id"],
                        namespace_id=namespace_id,
                        label=name or namespace_id,
                    )
                )
        return targets

    def _member_scan_targets(self, members: list[dict[str, Any]]) -> list[DropboxScanTarget]:
        """Act as each member in turn, walking their own home namespace."""
        targets: list[DropboxScanTarget] = []
        if self._include_member_folders():
            targets.extend(
                DropboxScanTarget(
                    kind="member_folder",
                    member_id=member["team_member_id"],
                    member_email=member["email"],
                    label=member["email"],
                )
                for member in members
            )

        if self._include_team_space():
            # A member token can only reach team folders through its own team
            # space, so the first selected member opens it for everyone. Files
            # also visible in a member folder dedupe on their Dropbox file ID.
            first = members[0]
            probe = DropboxScanTarget(kind="member_folder", member_id=first["team_member_id"])
            root_namespace_id = self._root_namespace_id(self._client_for(probe))
            if root_namespace_id:
                targets.append(
                    DropboxScanTarget(
                        kind="team_folder",
                        member_id=first["team_member_id"],
                        namespace_id=root_namespace_id,
                        label="Team space",
                    )
                )
            else:
                logger.info("Dropbox team has no separate team space; scanning member folders only")
        return targets

    # ── listing ──────────────────────────────────────────────────────────

    def _list_objects(self) -> Iterator[ObjectRef]:
        for target in self._scan_targets():
            if self._aborted:
                return
            if target.label:
                logger.info("Listing Dropbox %s: %s", target.kind, target.label)
            yield from self._list_target(target)

    def _list_target(self, target: DropboxScanTarget) -> Iterator[ObjectRef]:
        client = self._client_for(target)
        result = client.files_list_folder(
            path=self._folder_path(),
            recursive=self._recursive(),
            limit=self._max_keys_per_page(),
            include_mounted_folders=self._include_mounted_folders(),
            include_non_downloadable_files=self._export_non_downloadable(),
        )

        while True:
            for entry in result.entries or []:
                ref = self._entry_to_ref(entry, target)
                if ref is not None:
                    self._ref_by_key[ref.key] = ref
                    yield ref

            if not getattr(result, "has_more", False):
                break
            result = client.files_list_folder_continue(result.cursor)

    def _entry_to_ref(
        self,
        entry: Any,
        target: DropboxScanTarget = _ACCOUNT_TARGET,
    ) -> DropboxObjectRef | None:
        """Convert a Dropbox list entry into a ref, or None when it is not a
        scannable file (folders, deletions, filtered-out extensions)."""
        file_id = str(getattr(entry, "id", "") or "")
        # Folder and deleted entries have no id/size/rev triple.
        if not file_id or not hasattr(entry, "rev"):
            return None

        key = str(getattr(entry, "path_display", None) or getattr(entry, "name", "") or "")
        if not key:
            return None

        size = int(getattr(entry, "size", 0) or 0)
        is_downloadable = bool(getattr(entry, "is_downloadable", True))
        export_format = self._export_format(entry) if not is_downloadable else None

        if not is_downloadable and export_format is None:
            logger.debug("Skipping non-downloadable Dropbox item without export option: %s", key)
            return None
        # Exportable items report size 0; they still carry text worth scanning.
        if size == 0 and is_downloadable and not self._include_empty_objects():
            return None
        if not self._object_matches_extension_filters(key):
            return None

        return DropboxObjectRef(
            key=key,
            size=size,
            last_modified=self._parse_datetime(getattr(entry, "server_modified", None)),
            etag=str(getattr(entry, "content_hash", "") or "") or None,
            file_id=file_id,
            rev=str(getattr(entry, "rev", "") or "") or None,
            is_downloadable=is_downloadable,
            export_format=export_format,
            preview_url=str(getattr(entry, "preview_url", "") or "") or None,
            target=target,
        )

    def _export_format(self, entry: Any) -> str | None:
        if not self._export_non_downloadable():
            return None
        export_info = getattr(entry, "export_info", None)
        options = [str(option) for option in (getattr(export_info, "export_options", None) or [])]
        for preferred in _PREFERRED_EXPORT_FORMATS:
            if preferred in options:
                return preferred
        export_as = getattr(export_info, "export_as", None)
        if export_as:
            return str(export_as)
        return options[0] if options else "markdown"

    # ── download ─────────────────────────────────────────────────────────

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        max_bytes = self._max_object_bytes()
        dropbox_ref = ref if isinstance(ref, DropboxObjectRef) else None
        # Reuse the identity the file was listed under; another member's client
        # cannot see it.
        client = self._client_for(dropbox_ref.target if dropbox_ref else _ACCOUNT_TARGET)
        # Download by ID so a file moved mid-scan still resolves.
        path = dropbox_ref.file_id if dropbox_ref and dropbox_ref.file_id else ref.key

        if dropbox_ref is not None and not dropbox_ref.is_downloadable:
            export_format = dropbox_ref.export_format or "markdown"
            _export_result, response = client.files_export(path, export_format)
            content_type = _EXPORT_MIME_TYPES.get(export_format, "text/plain")
            self._exported_as_by_key[ref.key] = content_type
        else:
            _metadata, response = client.files_download(path)
            content_type = (response.headers or {}).get("Content-Type") if response else None

        file_bytes = self._read_capped(response, max_bytes)
        if len(file_bytes) > max_bytes:
            file_bytes = file_bytes[:max_bytes]
            logger.warning(
                "Truncated dropbox:%s to %d of %d bytes for content extraction",
                ref.key,
                max_bytes,
                ref.size,
            )
        return file_bytes, content_type

    @staticmethod
    def _read_capped(response: Any, max_bytes: int) -> bytes:
        """Read at most ``max_bytes`` + 1 bytes so oversized files never land in
        memory whole, then close the streamed response."""
        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    break
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    logger.debug("Failed to close Dropbox response body")
        return b"".join(chunks)

    # ── asset shape ──────────────────────────────────────────────────────

    def _external_url(self, key: str) -> str:
        """Identity URL for a file.

        Anchored to the immutable Dropbox file ID so renames and moves keep the
        same asset. Falls back to the path only when the ID is unknown (a ref
        that never came through ``_list_objects``).
        """
        ref = self._ref_by_key.get(key)
        if ref is not None and ref.file_id:
            return f"dropbox://files/{ref.file_id}"
        return f"dropbox://path/{quote(key.lstrip('/'), safe='/')}"

    def _extra_asset_metadata(self, ref: ObjectRef) -> dict[str, Any]:
        dropbox_ref = ref if isinstance(ref, DropboxObjectRef) else self._ref_by_key.get(ref.key)
        metadata: dict[str, Any] = {}
        if dropbox_ref is not None:
            if dropbox_ref.file_id:
                metadata["file_id"] = dropbox_ref.file_id
            if dropbox_ref.rev:
                metadata["rev"] = dropbox_ref.rev
            if dropbox_ref.preview_url:
                metadata["web_url"] = dropbox_ref.preview_url
            target = dropbox_ref.target
            # Only meaningful on a team scan — an individual account has a
            # single namespace and no member to attribute the file to.
            if target.member_id:
                metadata["team_namespace"] = target.kind
                metadata["team_member_id"] = target.member_id
                if target.member_email:
                    metadata["team_member_email"] = target.member_email
        exported_as = self._exported_as_by_key.get(ref.key)
        if exported_as:
            metadata["exported_as"] = exported_as
        return metadata

    # ── lifecycle ────────────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            folder_path = self._folder_path() or "/"
            if self._team_enabled():
                info = self._team_client().team_get_info()
                team_name = str(getattr(info, "name", "") or "") or "the Dropbox Business team"
                members = self._team_members()
                admins = sum(1 for member in members if member["is_team_admin"])
                if self._team_as_admin() and not admins:
                    raise ValueError(
                        "as_admin is enabled but no team administrator was found "
                        "among the selected members"
                    )
                result["status"] = "SUCCESS"
                result["message"] = (
                    f"Connected to {team_name}. "
                    f"{len(members)} member(s) selected for scanning at {folder_path}."
                )
                return result

            account = self._client().users_get_current_account()
            display_name = getattr(getattr(account, "name", None), "display_name", "") or ""
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Connected to Dropbox as {display_name or 'the authenticated account'}. "
                f"Scanning {folder_path}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Dropbox: {exc}"
        return result

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        self._ref_by_key = {}
        self._exported_as_by_key = {}
        async for batch in super().extract_raw():
            yield batch

    def cleanup(self) -> None:
        super().cleanup()
        for client in (self._cached_team_client, *self._client_by_target.values()):
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    logger.debug("Failed to close Dropbox client cleanly")
        self._client_by_target = {}
        self._cached_team_client = None
