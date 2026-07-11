from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from ...models.generated_input import LocalFolderInput
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)


class LocalFolderSource(ObjectStorageSourceBase):
    """Scans a folder on the local filesystem (desktop application deployments).

    Reuses the object-storage pipeline: each file becomes an ObjectRef whose key
    is the path relative to the scanned root, so sampling, MIME resolution, text
    extraction, file metadata, and embedded-image child assets all come from
    ObjectStorageSourceBase.
    """

    source_type = "local_folder"
    provider_label = "LOCAL_FOLDER"
    input_model = LocalFolderInput

    DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024

    _resolved_root: Path | None = None

    def _root(self) -> Path:
        if self._resolved_root is not None:
            return self._resolved_root
        raw = str(self.config.required.path).strip()
        if not raw:
            raise ValueError("required.path must be set")
        root = Path(raw).expanduser()
        if not root.is_absolute():
            raise ValueError(f"required.path must be an absolute path, got: {raw}")
        if not root.exists():
            raise ValueError(f"Folder does not exist: {root}")
        if not root.is_dir():
            raise ValueError(f"Path is not a folder: {root}")
        self._resolved_root = root.resolve()
        return self._resolved_root

    def _traversal_option(self, key: str, default: Any = None) -> Any:
        optional = self.config.optional
        traversal = getattr(optional, "traversal", None) if optional else None
        if traversal is not None:
            value = getattr(traversal, key, None)
            if value is not None:
                return value
        return default

    def _follow_symlinks(self) -> bool:
        return bool(self._traversal_option("follow_symlinks", False))

    def _include_hidden(self) -> bool:
        return bool(self._traversal_option("include_hidden", False))

    def _max_depth(self) -> int | None:
        value = self._traversal_option("max_depth")
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _max_file_bytes(self) -> int:
        value = self._traversal_option("max_file_bytes", self.DEFAULT_MAX_FILE_BYTES)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return self.DEFAULT_MAX_FILE_BYTES
        return max(parsed, 1024)

    def _is_hidden(self, name: str) -> bool:
        return name.startswith(".")

    def _walk(self, directory: Path, depth: int) -> Iterator[ObjectRef]:
        max_depth = self._max_depth()
        follow_symlinks = self._follow_symlinks()
        include_hidden = self._include_hidden()

        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as exc:
            logger.warning("Skipping unreadable directory %s: %s", directory, exc)
            return

        for entry in entries:
            if not include_hidden and self._is_hidden(entry.name):
                continue
            try:
                if entry.is_dir(follow_symlinks=follow_symlinks):
                    if max_depth is None or depth < max_depth:
                        yield from self._walk(Path(entry.path), depth + 1)
                    continue
                if not entry.is_file(follow_symlinks=follow_symlinks):
                    continue
                stat = entry.stat(follow_symlinks=follow_symlinks)
            except OSError as exc:
                logger.warning("Skipping unreadable entry %s: %s", entry.path, exc)
                continue

            key = Path(entry.path).relative_to(self._root()).as_posix()
            if not self._object_matches_extension_filters(key):
                continue
            prefix = self._prefix()
            if prefix and not key.startswith(prefix):
                continue
            if stat.st_size == 0 and not self._include_empty_objects():
                continue

            yield ObjectRef(
                key=key,
                size=stat.st_size,
                last_modified=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                # Change signature: mtime+size, so edits produce a new checksum
                # without hashing file bytes during discovery.
                etag=f"{stat.st_mtime_ns:x}-{stat.st_size:x}",
            )

    def _list_objects(self) -> Iterator[ObjectRef]:
        yield from self._walk(self._root(), depth=0)

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        file_path = self._root() / ref.key
        max_bytes = self._max_file_bytes()
        with open(file_path, "rb") as handle:
            file_bytes = handle.read(max_bytes)
        if ref.size > max_bytes:
            logger.info(
                "Truncated %s to %d of %d bytes for content extraction",
                file_path,
                max_bytes,
                ref.size,
            )
        return file_bytes, None

    def _external_url(self, key: str) -> str:
        absolute = (self._root() / key).as_posix()
        return f"file://{quote(absolute)}"
