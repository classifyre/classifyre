from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from fnmatch import fnmatch
from typing import Any
from urllib.parse import quote

import requests

from ...models.generated_input import HuggingFaceInput
from ...models.generated_single_asset_scan_results import SingleAssetScanResults
from ..dependencies import require_module
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)

DEFAULT_HUB_ENDPOINT = "https://huggingface.co"

# Repo-type prefix used in both the Hub's web URLs and the hf:// URI scheme.
# Models live at the root of the namespace; datasets and spaces are prefixed.
_REPO_TYPE_URL_PREFIX = {
    "model": "",
    "dataset": "datasets/",
    "space": "spaces/",
}

_DOWNLOAD_CHUNK_BYTES = 256 * 1024


@dataclass(frozen=True)
class HuggingFaceObjectRef(ObjectRef):
    """A file in a Hub repository tree.

    ``key`` is the repo-relative path. ``etag`` carries the strongest available
    content digest — the Git LFS SHA-256 for LFS-backed files (the large data
    files), otherwise the Git blob OID — which is what lets the scan cache trust
    an unchanged checksum without re-reading the bytes.
    """

    blob_id: str | None = None
    lfs_sha256: str | None = None


class HuggingFaceSource(ObjectStorageSourceBase):
    """Scan files inside a Hugging Face Hub repository.

    The repository is never cloned and no file is written to the Hub cache. The
    file tree is listed first so every file becomes an asset with its size and
    content digest, then each selected file is streamed one at a time, capped at
    ``optional.connection.max_object_bytes``, and handed to the shared file
    parser — so parquet, csv, images, documents, audio and archives all reach
    detectors through the same path as any other file source.
    """

    source_type = "hugging_face"
    provider_label = "HUGGING_FACE"
    input_model = HuggingFaceInput

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        # Populated while listing so _external_url() and _extra_asset_metadata()
        # (which only receive the path / a bare ObjectRef) can resolve the Hub
        # identity fields for that path.
        self._ref_by_key: dict[str, HuggingFaceObjectRef] = {}
        self._cached_session: requests.Session | None = None
        self._cached_revision: str | None = None

    # ── configuration ────────────────────────────────────────────────────

    def _repo_id(self) -> str:
        repo_id = str(self.config.required.repo_id or "").strip().strip("/")
        if not repo_id:
            raise ValueError("Hugging Face scanning requires required.repo_id (namespace/name)")
        return repo_id

    def _repo_type(self) -> str:
        value = self.config.required.repo_type
        repo_type = str(getattr(value, "value", value) or "dataset").strip().lower()
        if repo_type not in _REPO_TYPE_URL_PREFIX:
            raise ValueError(
                f"Unsupported Hugging Face repo_type '{repo_type}'. "
                f"Expected one of: {', '.join(sorted(_REPO_TYPE_URL_PREFIX))}."
            )
        return repo_type

    def _token(self) -> str:
        """The configured access token.

        Always read from the recipe's masked block and passed explicitly to every
        Hub call, so a ``HF_TOKEN`` environment variable or a cached CLI login on
        the runner can never silently authenticate a scan.
        """
        token = self._masked_value("token")
        if not token:
            raise ValueError(
                "Hugging Face scanning requires masked.token — a user access token "
                "(hf_...) with read permission on the repository."
            )
        return token

    def _endpoint(self) -> str:
        value = self._connection_option("endpoint", DEFAULT_HUB_ENDPOINT)
        endpoint = str(value or DEFAULT_HUB_ENDPOINT).strip().rstrip("/")
        return endpoint or DEFAULT_HUB_ENDPOINT

    def _configured_revision(self) -> str | None:
        return self._string_or_none(self._scope_option("revision"))

    def _paths(self) -> list[str | None]:
        """Repo folders to list, or ``[None]`` to list the whole repository."""
        values = self._scope_option("paths", []) or []
        paths = [
            cleaned
            for value in values
            if isinstance(value, str) and (cleaned := value.strip().strip("/"))
        ]
        # Preserve order, drop duplicates. Overlapping folders are also deduped
        # later by file path, so listing data/ and data/train is harmless.
        deduped = list(dict.fromkeys(paths))
        return list(deduped) if deduped else [None]

    def _glob_patterns(self, key: str) -> list[str]:
        """Normalize the configured globs the way the Hub's own filters do.

        A bare directory (``data/``) is expanded to ``data/*``, and a leading
        ``**/`` is also matched without the prefix so ``**/*.csv`` catches a
        root-level ``train.csv`` (``fnmatch``'s ``*`` already spans ``/``).
        """
        values = self._scope_option(key, []) or []
        patterns: list[str] = []
        for value in values:
            if not isinstance(value, str):
                continue
            pattern = value.strip()
            if not pattern:
                continue
            if pattern.endswith("/"):
                pattern = f"{pattern}*"
            patterns.append(pattern)
            if pattern.startswith("**/"):
                patterns.append(pattern[3:])
        return list(dict.fromkeys(patterns))

    def _include_last_commit(self) -> bool:
        return bool(self._scope_option("include_last_commit", False))

    def _max_retries(self) -> int:
        value = self._connection_option("max_retries", 3)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 3
        return min(max(parsed, 0), 10)

    def _matches_patterns(self, path: str) -> bool:
        allow_patterns = self._glob_patterns("allow_patterns")
        ignore_patterns = self._glob_patterns("ignore_patterns")

        if allow_patterns and not any(fnmatch(path, pattern) for pattern in allow_patterns):
            return False
        if ignore_patterns and any(fnmatch(path, pattern) for pattern in ignore_patterns):
            return False
        return True

    # ── client ───────────────────────────────────────────────────────────

    def _hub(self) -> Any:
        return require_module(
            module_name="huggingface_hub",
            source_name="Hugging Face",
            uv_groups=["hugging-face"],
            detail="Hugging Face scanning requires the official huggingface_hub client.",
        )

    def _api(self) -> Any:
        if self._cached_client is None:
            self._cached_client = self._hub().HfApi(
                endpoint=self._endpoint(),
                token=self._token(),
            )
        return self._cached_client

    def _session(self) -> requests.Session:
        """A retrying session for streaming file bytes.

        File content is streamed from the Hub's ``resolve`` URL rather than
        fetched with ``hf_hub_download``, which would write a full copy of every
        file into the Hub cache directory. Streaming keeps the peak cost per file
        bounded by ``max_object_bytes`` in memory and nothing on disk.
        """
        if self._cached_session is None:
            session = requests.Session()
            retries = self._max_retries()
            if retries:
                from requests.adapters import HTTPAdapter
                from urllib3.util.retry import Retry

                adapter = HTTPAdapter(
                    max_retries=Retry(
                        total=retries,
                        backoff_factor=0.5,
                        status_forcelist=(429, 500, 502, 503, 504),
                        allowed_methods=frozenset({"GET"}),
                    )
                )
                session.mount("https://", adapter)
                session.mount("http://", adapter)
            self._cached_session = session
        return self._cached_session

    def _revision(self) -> str:
        """The commit SHA this scan reads.

        Resolving the configured branch/tag once and pinning every download to
        that SHA keeps a scan self-consistent when the repository is committed to
        mid-run: the bytes always match the tree that was listed.
        """
        if self._cached_revision is not None:
            return self._cached_revision

        configured = self._configured_revision()
        try:
            info = self._api().repo_info(
                repo_id=self._repo_id(),
                repo_type=self._repo_type(),
                revision=configured,
                token=self._token(),
            )
            resolved = self._string_or_none(getattr(info, "sha", None))
        except Exception as exc:
            logger.warning(
                "Could not resolve Hugging Face revision for %s: %s", self._repo_id(), exc
            )
            resolved = None

        self._cached_revision = resolved or configured or "main"
        return self._cached_revision

    def _repo_last_modified(self) -> datetime:
        """Repository-level last-modified, used when per-file commit dates are off."""
        try:
            info = self._api().repo_info(
                repo_id=self._repo_id(),
                repo_type=self._repo_type(),
                revision=self._configured_revision(),
                token=self._token(),
            )
        except Exception:
            return datetime.now(UTC)
        return self._parse_datetime(
            getattr(info, "last_modified", None) or getattr(info, "lastModified", None)
        )

    # ── listing ──────────────────────────────────────────────────────────

    @staticmethod
    def _is_file_entry(entry: Any) -> bool:
        """Whether a tree entry is a file rather than a folder.

        The Hub returns ``type: file|directory`` and the client wraps entries in
        ``RepoFile``/``RepoFolder``; which of those signals is present varies by
        client version, so all of them are accepted.
        """
        entry_type = getattr(entry, "type", None)
        if isinstance(entry_type, str):
            return entry_type == "file"
        if type(entry).__name__ == "RepoFile":
            return True
        if type(entry).__name__ == "RepoFolder" or hasattr(entry, "tree_id"):
            return False
        return hasattr(entry, "size")

    def _list_objects(self) -> Iterator[ObjectRef]:
        api = self._api()
        repo_id = self._repo_id()
        repo_type = self._repo_type()
        revision = self._configured_revision()
        expand = self._include_last_commit()
        fallback_modified = self._repo_last_modified()
        seen: set[str] = set()

        for path_in_repo in self._paths():
            if self._aborted:
                return

            entries = api.list_repo_tree(
                repo_id=repo_id,
                path_in_repo=path_in_repo,
                recursive=True,
                expand=expand,
                revision=revision,
                repo_type=repo_type,
                token=self._token(),
            )

            for entry in entries:
                if self._aborted:
                    return
                if not self._is_file_entry(entry):
                    continue

                ref = self._entry_to_ref(entry, fallback_modified)
                if ref is None or ref.key in seen:
                    continue
                seen.add(ref.key)
                self._ref_by_key[ref.key] = ref
                yield ref

    def _entry_to_ref(
        self,
        entry: Any,
        fallback_modified: datetime,
    ) -> HuggingFaceObjectRef | None:
        """Convert a tree entry into a ref, or None when it is filtered out."""
        path = str(getattr(entry, "path", "") or "").strip().lstrip("/")
        if not path:
            return None

        if not self._matches_patterns(path):
            return None
        if not self._object_matches_extension_filters(path):
            return None

        lfs = getattr(entry, "lfs", None)
        lfs_sha256 = self._string_or_none(getattr(lfs, "sha256", None))
        blob_id = self._string_or_none(getattr(entry, "blob_id", None))

        # LFS pointers report the pointer file's size on the entry itself; the
        # real payload size lives in the LFS metadata.
        size = self._as_int(getattr(lfs, "size", None)) or self._as_int(
            getattr(entry, "size", None)
        )
        if not size and not self._include_empty_objects():
            return None

        last_commit = getattr(entry, "last_commit", None)
        last_modified = (
            self._parse_datetime(getattr(last_commit, "date", None))
            if last_commit is not None
            else fallback_modified
        )

        return HuggingFaceObjectRef(
            key=path,
            size=size,
            last_modified=last_modified,
            # The strongest content digest available: a change here means the
            # bytes changed, which is what the scan cache relies on.
            etag=lfs_sha256 or blob_id,
            blob_id=blob_id,
            lfs_sha256=lfs_sha256,
        )

    @staticmethod
    def _as_int(value: Any) -> int:
        try:
            return int(value) if value is not None else 0
        except (TypeError, ValueError):
            return 0

    # ── download ─────────────────────────────────────────────────────────

    def _resolve_url(self, key: str) -> str:
        return str(
            self._hub().hf_hub_url(
                repo_id=self._repo_id(),
                filename=key,
                repo_type=self._repo_type(),
                revision=self._revision(),
                endpoint=self._endpoint(),
            )
        )

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        max_bytes = self._max_object_bytes()
        url = self._resolve_url(ref.key)

        # requests drops the Authorization header when the resolve URL redirects
        # to the pre-signed CDN host, which is exactly what the Hub expects.
        response = self._session().get(
            url,
            headers={
                "Authorization": f"Bearer {self._token()}",
                "User-Agent": "classifyre",
            },
            stream=True,
            timeout=self._request_timeout_seconds(),
            allow_redirects=True,
        )
        response.raise_for_status()
        content_type = response.headers.get("Content-Type") if response.headers else None

        file_bytes = self._read_capped(response, max_bytes)
        if len(file_bytes) > max_bytes:
            file_bytes = file_bytes[:max_bytes]
            logger.warning(
                "Truncated hugging_face:%s to %d of %d bytes for content extraction",
                ref.key,
                max_bytes,
                ref.size,
            )
        return file_bytes, content_type

    @staticmethod
    def _read_capped(response: Any, max_bytes: int) -> bytes:
        """Read at most ``max_bytes`` + 1 bytes, then drop the connection.

        Stopping mid-stream is what keeps a multi-gigabyte LFS shard from ever
        being fully transferred, let alone held in memory.
        """
        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=_DOWNLOAD_CHUNK_BYTES):
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
                    logger.debug("Failed to close Hugging Face response body")
        return b"".join(chunks)

    # ── asset shape ──────────────────────────────────────────────────────

    def _repo_url_path(self) -> str:
        return f"{_REPO_TYPE_URL_PREFIX[self._repo_type()]}{self._repo_id()}"

    def _external_url(self, key: str) -> str:
        """Identity URI for a file.

        Deliberately excludes the revision: a new commit that leaves a file
        untouched must not fork its asset, and a commit that changes the bytes is
        already caught by the digest in the checksum.

        The repo type is always spelled out, including for models — the Hub's own
        ``hf://`` scheme leaves models unprefixed, but that would make a model
        and a same-named dataset collide on one asset identity.
        """
        repo_type = self._repo_type()
        prefix = _REPO_TYPE_URL_PREFIX[repo_type] or f"{repo_type}s/"
        return f"hf://{prefix}{self._repo_id()}/{quote(key.lstrip('/'), safe='/')}"

    def _web_url(self, key: str) -> str:
        return (
            f"{self._endpoint()}/{self._repo_url_path()}/blob/"
            f"{self._revision()}/{quote(key.lstrip('/'), safe='/')}"
        )

    def _extra_asset_metadata(self, ref: ObjectRef) -> dict[str, Any]:
        hf_ref = ref if isinstance(ref, HuggingFaceObjectRef) else self._ref_by_key.get(ref.key)
        metadata: dict[str, Any] = {
            "repo_id": self._repo_id(),
            "repo_type": self._repo_type(),
            "revision": self._revision(),
            "web_url": self._web_url(ref.key),
        }
        if hf_ref is not None:
            if hf_ref.blob_id:
                metadata["blob_id"] = hf_ref.blob_id
            if hf_ref.lfs_sha256:
                metadata["lfs_sha256"] = hf_ref.lfs_sha256
        return metadata

    # ── lifecycle ────────────────────────────────────────────────────────

    def _explain_failure(self, exc: Exception) -> str:
        """Turn the Hub's auth and access errors into something actionable."""
        text = str(exc)
        name = type(exc).__name__
        repo_id = self._repo_id()

        if "GatedRepo" in name or "gated" in text.lower():
            return (
                f"access to {repo_id} is gated. Accept the repository's terms on the Hub "
                "with the account that owns this token, then retry."
            )
        if "RepositoryNotFound" in name or "401" in text or "404" in text:
            return (
                f"{repo_id} was not found, or the token cannot read it. Check the "
                "repo_id and repo_type, and that the token has read permission on "
                "this repository (fine-grained tokens must list it explicitly)."
            )
        if "RevisionNotFound" in name:
            configured = self._configured_revision() or "the default branch"
            return f"revision {configured} does not exist in {repo_id}."
        return text

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            repo_id = self._repo_id()
            repo_type = self._repo_type()
            self._api().repo_info(
                repo_id=repo_id,
                repo_type=repo_type,
                revision=self._configured_revision(),
                token=self._token(),
            )

            matched = 0
            for _ref in self._list_objects():
                matched += 1
                if matched >= 100:
                    break

            result["status"] = "SUCCESS"
            result["message"] = (
                f"Connected to Hugging Face {repo_type} {repo_id} at revision "
                f"{self._revision()[:12]}. Found {'100+' if matched >= 100 else matched} "
                "file(s) in current scope."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Hugging Face: {self._explain_failure(exc)}"
        return result

    def cleanup(self) -> None:
        super().cleanup()
        session = self._cached_session
        self._cached_session = None
        if session is not None:
            try:
                session.close()
            except Exception:
                logger.debug("Failed to close Hugging Face session cleanly")

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        self._ref_by_key = {}
        async for batch in super().extract_raw():
            yield batch
