"""Expand archive containers (zip / tar / gz / 7z / rar) into member files.

Object-storage sources use this to turn each archive member into its own child
asset (with its own hash, MIME type, metadata, and detector pass) instead of
treating the container as an opaque binary blob. See
``ObjectStorageSourceBase._queue_child_archive_assets``.

Safety limits (zip-bomb hardening) are enforced on every backend:

- ``max_members``: hard cap on members yielded per archive
- ``max_member_bytes``: members larger than this (decompressed) are skipped
- ``max_total_bytes``: total decompressed budget; extraction stops when spent
- nesting: members that are themselves archives are yielded as-is but never
  expanded recursively (single-level expansion)

ZIP and TAR (incl. .tar.gz/.tgz via ``r:*``) use the stdlib. 7z uses py7zr
(pure Python). RAR uses rarfile, which needs an external unrar/unar/bsdtar
backend at runtime — every backend failure degrades to "no members" with a
warning, never an exception.
"""

from __future__ import annotations

import io
import logging
import tarfile
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .file_parser import (
    ARCHIVE_MIME_TYPES,
    _normalize_mime_type,
    _require_file_processing,
    resolve_mime_type,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_ARCHIVE_MEMBERS = 200
DEFAULT_MAX_MEMBER_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_TOTAL_MEMBER_BYTES = 100 * 1024 * 1024

_ZIP_ENCRYPTED_FLAG = 0x1


@dataclass(frozen=True)
class ArchiveMember:
    """A single file extracted from inside an archive container."""

    location: str  # member path within the archive, e.g. "docs/report.pdf"
    member_bytes: bytes
    mime_type: str


@dataclass
class _ExtractionBudget:
    """Mutable caps shared by all backends while walking one archive."""

    max_members: int
    max_member_bytes: int
    max_total_bytes: int
    members: int = 0
    total_bytes: int = 0

    def admit(self, location: str, size: int) -> bool:
        """Whether a member of ``size`` bytes may be yielded; updates the totals."""
        if size > self.max_member_bytes:
            logger.info(
                "Skipping archive member %s: %d bytes exceeds per-member cap %d",
                location,
                size,
                self.max_member_bytes,
            )
            return False
        if self.total_bytes + size > self.max_total_bytes:
            logger.warning(
                "Archive extraction budget (%d bytes) spent; skipping %s and the rest",
                self.max_total_bytes,
                location,
            )
            raise _BudgetExhaustedError
        self.members += 1
        self.total_bytes += size
        if self.members > self.max_members:
            logger.warning("Reached max archive members (%d); stopping", self.max_members)
            raise _BudgetExhaustedError
        return True


class _BudgetExhaustedError(Exception):
    """Internal signal: stop walking the archive entirely."""


def is_archive_mime(mime_type: str) -> bool:
    """Return True when the MIME type is an expandable archive container."""
    return _normalize_mime_type(mime_type) in ARCHIVE_MIME_TYPES


def iter_archive_members(
    file_bytes: bytes,
    mime_type: str,
    *,
    file_name: str = "",
    max_members: int = DEFAULT_MAX_ARCHIVE_MEMBERS,
    max_member_bytes: int = DEFAULT_MAX_MEMBER_BYTES,
    max_total_bytes: int = DEFAULT_MAX_TOTAL_MEMBER_BYTES,
) -> Iterator[ArchiveMember]:
    """Yield the member files of an archive, bounded by the safety caps.

    Directories, encrypted entries, oversized members, and unreadable entries
    are skipped with a log line. Any backend failure yields nothing.
    """
    if not file_bytes:
        return
    normalized = _normalize_mime_type(mime_type)
    budget = _ExtractionBudget(
        max_members=max_members,
        max_member_bytes=max_member_bytes,
        max_total_bytes=max_total_bytes,
    )
    try:
        if normalized == "application/zip":
            yield from _iter_zip_members(file_bytes, budget)
        elif normalized == "application/x-tar":
            yield from _iter_tar_members(file_bytes, budget)
        elif normalized == "application/gzip":
            yield from _iter_gzip_members(file_bytes, budget, file_name)
        elif normalized == "application/x-7z-compressed":
            yield from _iter_7z_members(file_bytes, budget)
        elif normalized in ("application/vnd.rar", "application/x-rar-compressed"):
            yield from _iter_rar_members(file_bytes, budget)
    except _BudgetExhaustedError:
        return
    except Exception as exc:
        logger.warning("Archive extraction failed for %s (%s): %s", file_name, normalized, exc)


def _member(location: str, data: bytes) -> ArchiveMember:
    return ArchiveMember(
        location=location,
        member_bytes=data,
        mime_type=resolve_mime_type(data, file_name=location),
    )


def _iter_zip_members(file_bytes: bytes, budget: _ExtractionBudget) -> Iterator[ArchiveMember]:
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.flag_bits & _ZIP_ENCRYPTED_FLAG:
                logger.info("Skipping encrypted zip member %s", info.filename)
                continue
            if not budget.admit(info.filename, info.file_size):
                continue
            try:
                with archive.open(info) as handle:
                    # +1 over the cap catches headers that understate the real
                    # decompressed size (classic zip-bomb trick).
                    data = handle.read(budget.max_member_bytes + 1)
            except Exception as exc:
                logger.warning("Failed to read zip member %s: %s", info.filename, exc)
                continue
            if len(data) > budget.max_member_bytes:
                logger.warning(
                    "Skipping zip member %s: decompressed size exceeds declared size",
                    info.filename,
                )
                continue
            if data:
                yield _member(info.filename, data)


def _iter_tar_members(file_bytes: bytes, budget: _ExtractionBudget) -> Iterator[ArchiveMember]:
    with tarfile.open(fileobj=io.BytesIO(file_bytes), mode="r:*") as archive:
        for info in archive:
            if not info.isfile():
                continue
            if not budget.admit(info.name, info.size):
                continue
            handle = archive.extractfile(info)
            if handle is None:
                continue
            with handle:
                data = handle.read(budget.max_member_bytes + 1)
            if len(data) > budget.max_member_bytes:
                logger.warning("Skipping tar member %s: larger than declared", info.name)
                continue
            if data:
                yield _member(info.name, data)


def _iter_gzip_members(
    file_bytes: bytes,
    budget: _ExtractionBudget,
    file_name: str,
) -> Iterator[ArchiveMember]:
    """A .gz file is either a compressed tarball or a single compressed file."""
    try:
        yield from _iter_tar_members(file_bytes, budget)
        return
    except _BudgetExhaustedError:
        raise
    except tarfile.ReadError:
        pass  # not a tarball — decompress as a single member

    import gzip

    with gzip.GzipFile(fileobj=io.BytesIO(file_bytes)) as handle:
        data = handle.read(budget.max_member_bytes + 1)
    if len(data) > budget.max_member_bytes:
        logger.info("Skipping gzip content: exceeds per-member cap")
        return
    location = Path(file_name).stem or "content"
    if data and budget.admit(location, len(data)):
        yield _member(location, data)


def _iter_7z_members(file_bytes: bytes, budget: _ExtractionBudget) -> Iterator[ArchiveMember]:
    import tempfile

    py7zr = _require_file_processing("py7zr")

    with py7zr.SevenZipFile(io.BytesIO(file_bytes)) as archive:  # type: ignore[attr-defined]
        admitted: list[str] = []
        try:
            for info in archive.list():
                if info.is_directory:
                    continue
                if budget.admit(info.filename, info.uncompressed):
                    admitted.append(info.filename)
        except _BudgetExhaustedError:
            pass  # extract what was admitted before the budget ran out
        if not admitted:
            return
        # py7zr 1.x has no in-memory read API; extract the admitted members to a
        # temp dir and read them back.
        with tempfile.TemporaryDirectory(prefix="classifyre-7z-") as temp_dir:
            archive.extract(path=temp_dir, targets=admitted)
            root = Path(temp_dir).resolve()
            for name in admitted:
                member_path = (root / name).resolve()
                if not member_path.is_relative_to(root):
                    logger.warning("Skipping 7z member %s: escapes extraction dir", name)
                    continue
                if not member_path.is_file():
                    continue
                data = member_path.read_bytes()
                if len(data) > budget.max_member_bytes:
                    logger.warning("Skipping 7z member %s: larger than declared", name)
                    continue
                if data:
                    yield _member(name, data)


def _iter_rar_members(file_bytes: bytes, budget: _ExtractionBudget) -> Iterator[ArchiveMember]:
    rarfile = _require_file_processing("rarfile")

    with rarfile.RarFile(io.BytesIO(file_bytes)) as archive:  # type: ignore[attr-defined]
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.needs_password():
                logger.info("Skipping encrypted rar member %s", info.filename)
                continue
            if not budget.admit(info.filename, info.file_size):
                continue
            try:
                with archive.open(info) as handle:
                    data = handle.read(budget.max_member_bytes + 1)
            except Exception as exc:
                # Typically "unrar backend not installed" — degrade quietly.
                logger.warning("Failed to read rar member %s: %s", info.filename, exc)
                continue
            if len(data) > budget.max_member_bytes:
                logger.warning("Skipping rar member %s: larger than declared", info.filename)
                continue
            if data:
                yield _member(info.filename, data)
