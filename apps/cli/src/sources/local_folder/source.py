from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from ...models.generated_input import LocalFolderInput
from ...utils.file_parser import resolve_mime_type
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)


class LocalFolderSource(ObjectStorageSourceBase):
    """Scans a folder on the filesystem the scan process runs on.

    Reuses the object-storage pipeline: each file becomes an ObjectRef whose key
    is the path relative to the scanned root, so sampling, MIME resolution, text
    extraction, file metadata, and embedded-image child assets all come from
    ObjectStorageSourceBase.
    """

    source_type = "local_folder"
    provider_label = "LOCAL_FOLDER"
    input_model = LocalFolderInput

    DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024

    # The local "ETag" is mtime_ns + size, which a restore from backup or a
    # size-preserving edit under a preserved mtime reproduces exactly. Hash the
    # bytes before trusting the cache; the read is local and cheap next to the
    # parsing, OCR and detection it lets us skip.
    SCAN_CACHE_VERIFY = "content"

    _resolved_root: Path | None = None

    # AUTOMATIC orders files by when they arrived, and the cursor remembers if
    # this folder turned out not to be able to say (see ``_automatic_refs``).
    ORDER_MODE_KEY = "objects_order"
    ORDER_CHURN_KEY = "objects_churn"
    ORDER_BY_MODIFIED = "modified"
    _MAX_ORDER_CHURN = 2

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

            self._changed_at()[key] = max(stat.st_mtime_ns, stat.st_ctime_ns)
            yield ObjectRef(
                key=key,
                size=stat.st_size,
                last_modified=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                # Change signature: mtime+size, so edits produce a new checksum
                # without hashing file bytes during discovery.
                etag=f"{stat.st_mtime_ns:x}-{stat.st_size:x}",
            )

    def _list_objects(self) -> Iterator[ObjectRef]:
        self._changed_at().clear()
        yield from self._walk(self._root(), depth=0)

    # ── AUTOMATIC ordering ───────────────────────────────────────────────
    #
    # A file's modification time travels with it. Drag a folder in with
    # Finder, ``cp -p`` it, unpack an archive, and the new files carry dates
    # from months ago -- by modification time they sort deep inside ground the
    # sweep has already covered, and are never read. What does move when a
    # file lands here is its inode change time, so AUTOMATIC orders by the
    # later of the two: when the file last changed *or arrived*.
    #
    # The change time is only as good as the mount. Some rewrite it for every
    # file each time the folder is mounted (a volume re-owned at pod start, a
    # folder re-copied by an init step), and then every file looks new on
    # every run and the sweep never gets past the top. One such run is
    # indistinguishable from a folder that really was replaced, and is treated
    # as one. A second in a row is not a coincidence: the folder is ordered by
    # modification time from then on, and the sweep starts over on that basis.

    def _changed_at(self) -> dict[str, int]:
        """Per key, the later of mtime and ctime in nanoseconds, from the last walk."""
        changed: dict[str, int] = self.__dict__.setdefault("_changed_ns", {})
        return changed

    def _orders_by_modified(self) -> bool:
        return self._sampling_cursor.get(self.ORDER_MODE_KEY) == self.ORDER_BY_MODIFIED

    def _automatic_rank(self, ref: ObjectRef) -> int:
        if not self._orders_by_modified():
            changed = self._changed_at().get(ref.key)
            if changed is not None:
                return changed // 1000
        return super()._automatic_rank(ref)

    def _automatic_refs(self, refs: list[ObjectRef]) -> list[ObjectRef]:
        if self._orders_by_modified():
            return super()._automatic_refs(refs)

        head_rank = self.automatic_frontier(self.AUTOMATIC_CURSOR_KEY).head_rank
        everything_new = (
            bool(refs)
            and isinstance(head_rank, int)
            and all(self._automatic_rank(ref) > head_rank for ref in refs)
        )
        saved_churn = self._sampling_cursor.get(self.ORDER_CHURN_KEY)
        previous_churn = saved_churn if isinstance(saved_churn, int) else 0
        churn = previous_churn + 1 if everything_new else 0

        if churn >= self._MAX_ORDER_CHURN:
            logger.warning(
                "Every file under %s has looked newly arrived on %d runs in a row, so this "
                "mount rewrites change times and they cannot order the folder. Ordering by "
                "modification time from now on; the sweep starts over.",
                self._root(),
                churn,
            )
            self._sampling_cursor = {
                key: value
                for key, value in self._sampling_cursor.items()
                if key not in {self.AUTOMATIC_CURSOR_KEY, self.ORDER_CHURN_KEY}
            }
            self._sampling_cursor[self.ORDER_MODE_KEY] = self.ORDER_BY_MODIFIED
            window = super()._automatic_refs(refs)
            self._record_cursor_key(self.ORDER_MODE_KEY, self.ORDER_BY_MODIFIED)
            return window

        window = super()._automatic_refs(refs)
        if churn or previous_churn:
            self._record_cursor_key(self.ORDER_CHURN_KEY, churn)
        return window

    def _open_object(self, ref: ObjectRef) -> tuple[Any, str]:
        """Open the file where it already is.

        The one source that needs neither a download nor a spool: the payload is
        a local file, so the parser reads it in place at any size. ``max_file_bytes``
        keeps governing how much is pulled into memory by the *bytes* path
        (binary detectors), not how large a file can be read.
        """
        file_path = self._root() / ref.key
        handle = open(file_path, "rb")
        try:
            mime_type = resolve_mime_type(
                handle,
                declared_mime_type=ref.content_type_hint or "",
                file_name=self._object_file_name(ref),
            )
        except Exception:
            handle.close()
            raise
        return handle, mime_type

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
