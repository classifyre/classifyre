"""MIME detection and text extraction utilities for local file parsing."""

from __future__ import annotations

import logging
import tempfile
import threading
from collections.abc import Generator, Iterator
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .legacy_office import LEGACY_OFFICE_MIME_TYPES as _LEGACY_OFFICE_MIME_TYPES
from .payload import BinarySource, as_binary_io, header, payload_size, read_all

logger = logging.getLogger(__name__)


class TextExtractionCoverageCode(StrEnum):
    """Machine-readable reason detector-visible text could not be produced."""

    ENGINE_UNAVAILABLE = "ENGINE_UNAVAILABLE"
    ZERO_FRAMES = "ZERO_FRAMES"
    FAILED = "FAILED"


class TextExtractionCoverageError(RuntimeError):
    """Extraction failed after source content was fetched successfully."""

    def __init__(
        self,
        message: str,
        *,
        code: TextExtractionCoverageCode = TextExtractionCoverageCode.FAILED,
    ) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class ParsedFile:
    """Result of parsing a local file."""

    mime_type: str
    text_content: str
    is_binary: bool
    file_size_bytes: int = 0
    encoding: str | None = None
    parse_error: str | None = None


@dataclass
class ParsedBytes:
    """Result of parsing in-memory bytes."""

    mime_type: str
    raw_content: str
    text_content: str
    is_binary: bool
    file_size_bytes: int
    parse_error: str | None = None


OCTET_STREAM = "application/octet-stream"

# How much of a payload MIME detection is allowed to look at. Every magic
# signature this recognises lives in the first few bytes; the slack is for the
# text sniffer, which needs a sentence or two to tell JSON from CSV from prose.
_MIME_HEADER_BYTES = 64 * 1024

# Spellings of "I don't know what these bytes are". Only the first is the
# registered type, but object stores are inconsistent: S3-compatible services
# (Backblaze B2 among them) label every upload `binary/octet-stream`. Because
# that is not the IANA spelling, treating it as a *real* content type made it
# win over magic-byte detection and filename inference — so every object served
# that way skipped MIME resolution entirely, matched no branch in extract_text,
# and returned no text AND no error. Assets were then recorded as scanned and
# empty, which is indistinguishable from a genuinely empty file.
_GENERIC_BINARY_MIME_TYPES = frozenset(
    {
        OCTET_STREAM,
        "binary/octet-stream",
        "application/binary",
        "application/unknown",
        "unknown/unknown",
    }
)


# Arrow IPC, in the spellings it arrives under. ``.arrow`` and ``.ipc`` hold the
# random-access *file* layout; ``.feather`` holds either that same layout
# (Feather V2) or the legacy V1 one, which pyarrow still reads. The streaming
# layout is a type of its own because it carries no footer, so it can only be
# read front to back.
ARROW_FILE_MIME_TYPE = "application/vnd.apache.arrow.file"
ARROW_STREAM_MIME_TYPE = "application/vnd.apache.arrow.stream"
ARROW_MIME_TYPES = frozenset({ARROW_FILE_MIME_TYPE, ARROW_STREAM_MIME_TYPE})

# Content types that name a format this module already knows under another
# spelling. Collapsed here for the same reason the generic-binary aliases are:
# one name then reaches every downstream comparison. Arrow has no IANA-registered
# type, so object stores and dataset tools each picked their own.
_MIME_TYPE_ALIASES = {
    "application/x-arrow": ARROW_FILE_MIME_TYPE,
    "application/arrow": ARROW_FILE_MIME_TYPE,
    "application/vnd.apache.arrow": ARROW_FILE_MIME_TYPE,
    "application/x-feather": ARROW_FILE_MIME_TYPE,
    "application/vnd.apache.feather": ARROW_FILE_MIME_TYPE,
}


def _canonical_mime_type(mime_type: str) -> str:
    """Collapse every "unknown bytes" spelling onto the registered one.

    Downstream code compares against ``application/octet-stream`` in a dozen
    places (is_binary, archive handling, detector content-type matching); mapping
    aliases here means none of those have to know the alias list. The same goes
    for formats with several spellings in the wild (see ``_MIME_TYPE_ALIASES``).
    """
    if mime_type in _GENERIC_BINARY_MIME_TYPES:
        return OCTET_STREAM
    return _MIME_TYPE_ALIASES.get(mime_type, mime_type)


_TEXT_RAW_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
}

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
    *ARROW_MIME_TYPES,
}

_MIME_HINTS_BY_EXTENSION = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".parquet": "application/parquet",
    ".arrow": ARROW_FILE_MIME_TYPE,
    ".feather": ARROW_FILE_MIME_TYPE,
    ".ipc": ARROW_FILE_MIME_TYPE,
    ".arrows": ARROW_STREAM_MIME_TYPE,
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".rtf": "application/rtf",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".eml": "message/rfc822",
    ".msg": "application/vnd.ms-outlook",
    ".doc": "application/msword",
    ".xls": "application/vnd.ms-excel",
    ".ppt": "application/vnd.ms-powerpoint",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    # Archives
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
    ".7z": "application/x-7z-compressed",
    ".rar": "application/vnd.rar",
    # Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    # Video
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
}

# Source code and configuration. Every one of these is read as text — the
# extraction path for `text/*` is `_decode_bytes`, so a .py file reaches the
# detectors as exactly the characters it contains, which is what a secret
# scanner needs.
#
# They are here rather than left to content sniffing because sniffing cannot
# tell code apart from data: `from a import b, c, d` is a first line with two
# commas, which is precisely the CSV heuristic, and a minified bundle starting
# with `{` looks like JSON. Either misread turns a source file into a table of
# nonsense columns. The extension is the reliable signal, so it is used.
_CODE_MIME_HINTS_BY_EXTENSION = {
    # Scripting and application languages
    ".py": "text/x-python",
    ".pyi": "text/x-python",
    ".rb": "text/x-ruby",
    ".php": "text/x-php",
    ".pl": "text/x-perl",
    ".lua": "text/x-lua",
    ".r": "text/x-r",
    ".jl": "text/x-julia",
    # JavaScript / TypeScript family
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".jsx": "text/jsx",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".vue": "text/x-vue",
    ".svelte": "text/x-svelte",
    # JVM and .NET
    ".java": "text/x-java",
    ".kt": "text/x-kotlin",
    ".kts": "text/x-kotlin",
    ".scala": "text/x-scala",
    ".groovy": "text/x-groovy",
    ".cs": "text/x-csharp",
    ".fs": "text/x-fsharp",
    ".vb": "text/x-vb",
    # Systems languages
    ".c": "text/x-c",
    ".h": "text/x-c",
    ".cc": "text/x-c++",
    ".cpp": "text/x-c++",
    ".cxx": "text/x-c++",
    ".hpp": "text/x-c++",
    ".hh": "text/x-c++",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".swift": "text/x-swift",
    ".m": "text/x-objectivec",
    ".mm": "text/x-objectivec",
    ".zig": "text/x-zig",
    ".dart": "text/x-dart",
    ".ex": "text/x-elixir",
    ".exs": "text/x-elixir",
    ".erl": "text/x-erlang",
    ".hs": "text/x-haskell",
    ".clj": "text/x-clojure",
    # Shell and automation
    ".sh": "text/x-shellscript",
    ".bash": "text/x-shellscript",
    ".zsh": "text/x-shellscript",
    ".fish": "text/x-shellscript",
    ".ps1": "text/x-powershell",
    ".psm1": "text/x-powershell",
    ".bat": "text/x-msdos-batch",
    ".cmd": "text/x-msdos-batch",
    # Query, schema and interface definitions
    ".sql": "text/x-sql",
    ".graphql": "text/x-graphql",
    ".gql": "text/x-graphql",
    ".proto": "text/x-protobuf",
    ".thrift": "text/x-thrift",
    ".avsc": "application/json",
    # Configuration — where credentials most often end up
    ".yaml": "text/x-yaml",
    ".yml": "text/x-yaml",
    ".toml": "text/x-toml",
    ".ini": "text/x-ini",
    ".cfg": "text/x-ini",
    ".conf": "text/x-ini",
    ".properties": "text/x-properties",
    ".env": "text/x-env",
    ".tf": "text/x-terraform",
    ".tfvars": "text/x-terraform",
    ".hcl": "text/x-hcl",
    ".dockerfile": "text/x-dockerfile",
    ".gradle": "text/x-groovy",
    ".cmake": "text/x-cmake",
    ".mk": "text/x-makefile",
    # Web templates and styles
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sass": "text/x-sass",
    ".less": "text/x-less",
    ".jinja": "text/x-jinja",
    ".j2": "text/x-jinja",
    ".hbs": "text/x-handlebars",
    ".ejs": "text/x-ejs",
    ".erb": "text/x-erb",
    ".twig": "text/x-twig",
    # Notebooks, patches and docs-as-code
    ".ipynb": "application/json",
    ".patch": "text/x-diff",
    ".diff": "text/x-diff",
    ".rst": "text/x-rst",
    ".adoc": "text/x-asciidoc",
    ".tex": "text/x-tex",
}

# Extension-less files that are code by convention. Matched on the whole file
# name, since they have no suffix to look at.
_CODE_MIME_HINTS_BY_FILE_NAME = {
    "dockerfile": "text/x-dockerfile",
    "containerfile": "text/x-dockerfile",
    "makefile": "text/x-makefile",
    "gnumakefile": "text/x-makefile",
    "jenkinsfile": "text/x-groovy",
    "vagrantfile": "text/x-ruby",
    "gemfile": "text/x-ruby",
    "rakefile": "text/x-ruby",
    "brewfile": "text/x-ruby",
    "procfile": "text/x-yaml",
    "cmakelists.txt": "text/x-cmake",
    # A dotfile's leading dot is its stem, not a suffix, so `.env` and its
    # per-environment variants have to be matched by name. Worth the special
    # case: this is the single most common place a live credential is committed.
    ".env": "text/x-env",
    ".npmrc": "text/x-ini",
    ".netrc": "text/x-ini",
    ".gitconfig": "text/x-ini",
    ".editorconfig": "text/x-ini",
    ".gitattributes": "text/plain",
    ".gitignore": "text/plain",
    ".dockerignore": "text/plain",
}

_MIME_HINTS_BY_EXTENSION.update(_CODE_MIME_HINTS_BY_EXTENSION)

# The types the extension may override a content guess with (see
# `normalize_detected_mime_type`).
_CODE_TEXT_MIME_TYPES = frozenset(_CODE_MIME_HINTS_BY_EXTENSION.values()) | frozenset(
    _CODE_MIME_HINTS_BY_FILE_NAME.values()
)

# Content guesses that a code extension is allowed to correct. All of them are
# things the sniffer infers from the first few characters of a text file, which
# is exactly the evidence that cannot distinguish code from data.
_SNIFFED_TEXT_MIME_TYPES = frozenset(
    {
        "text/plain",
        "text/csv",
        "text/tab-separated-values",
        "text/html",
        "application/json",
        "application/xml",
        "text/xml",
    }
)

_DOCLING_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/bmp",
    "image/webp",
}

# Image formats docling can't ingest directly; converted to PNG (first frame
# for animated GIFs) via Pillow before OCR. HEIC/HEIF decode needs pillow-heif.
_OCR_CONVERTIBLE_IMAGE_MIME_TYPES = {
    "image/gif",
    "image/heic",
    "image/heif",
}

_DOCLING_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_DOCLING_EXTENSIONS = {
    ".pdf",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
    ".gif",
    ".heic",
    ".heif",
}

# OpenDocument formats and Outlook .msg are parsed natively by docling (no OCR
# models involved, but the converter lives in the same `ocr` dependency group).
_DOCLING_NATIVE_DOCUMENT_MIME_TYPES = {
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.ms-outlook",
}

# Archive containers: never text-extracted here — object-storage sources expand
# their members into standalone child assets (see utils/archive_extraction.py).
ARCHIVE_MIME_TYPES = frozenset(
    {
        "application/zip",
        "application/x-tar",
        "application/gzip",
        "application/x-7z-compressed",
        "application/vnd.rar",
        "application/x-rar-compressed",
    }
)

# ZIP-container document formats: a bare `PK\x03\x04` signature is refined by
# peeking at the archive contents (see _refine_zip_mime).
_OOXML_MIME_BY_PREFIX = (
    ("word/", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("xl/", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("ppt/", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
)
_ZIP_CONTAINER_MIME_TYPES = frozenset(
    {mime for _, mime in _OOXML_MIME_BY_PREFIX}
    | {
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
    }
)

# OLE Compound File (magic D0CF11E0): legacy Office and Outlook .msg all share
# it, so the concrete format comes from the file extension.
_CFB_MIME_TYPES = frozenset(
    {
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.ms-outlook",
    }
)


class _DoclingState:
    """Mutable singleton state for the Docling DocumentConverter.

    Stored as object attributes so functions can mutate state without `global`
    statements (which ruff PLW0603 disallows). Initializing the converter is
    expensive (loads ML models), so it happens exactly once per process.
    """

    def __init__(self) -> None:
        self.converter: object = None
        self.error: str | None = None
        self.attempted: bool = False
        # Allow one retry when a MissingSourceDependencyError indicates the uv
        # sync itself failed (transient: network blip, registry timeout). A
        # genuine broken package fails on the retry too and is cached then.
        self.install_retry_remaining: int = 1


_docling_state = _DoclingState()
_docling_lock = threading.Lock()
# Limits concurrent converter.convert() calls to prevent OOM. The docling
# StandardPdfPipeline alone holds ~1 GB of model weights; additional working
# memory per in-flight conversion can push the process over the 4 GiB K8s
# limit when two conversions run simultaneously.
_docling_conversion_sem = threading.Semaphore(1)


def _get_docling_converter() -> tuple[object, str | None]:
    """Return a cached DocumentConverter, initializing it on the first call."""
    # Fast-path: only skip the lock once initialization is settled (converter
    # ready or permanently failed).  Checking `attempted` alone is not enough —
    # `attempted` is set before the install+init finishes, so threads that reach
    # here while another thread holds the lock would return (None, None) and
    # emit a spurious "unavailable" warning instead of waiting.
    if _docling_state.converter is not None or _docling_state.error is not None:
        return _docling_state.converter, _docling_state.error
    with _docling_lock:
        if _docling_state.attempted:
            return _docling_state.converter, _docling_state.error
        _docling_state.attempted = True
        try:
            import os

            from ..sources.dependencies import require_module

            # docling's AcceleratorOptions defaults to device="auto", which
            # resolves to MPS on Apple Silicon — where the layout model crashes
            # ("Cannot convert a MPS Tensor to float64"), silently producing
            # zero text for every scanned image and PDF. Default to CPU (the
            # same choice WhisperConfig makes); AcceleratorOptions reads the
            # DOCLING_DEVICE env var at construction, so an explicit setting
            # still overrides this.
            os.environ.setdefault("DOCLING_DEVICE", "cpu")

            converter_module = require_module(
                "docling.document_converter",
                "file parser OCR",
                ["ocr"],
                detail="OCR extraction requires the Docling optional dependency.",
            )
            _docling_state.converter = converter_module.DocumentConverter()
        except Exception as exc:
            from ..sources.dependencies import MissingSourceDependencyError

            if (
                isinstance(exc, MissingSourceDependencyError)
                and _docling_state.install_retry_remaining > 0
            ):
                # The uv sync may have failed transiently (network blip, registry
                # timeout). Reset so the next call retries once; on second failure
                # the error is cached permanently regardless of exception type.
                _docling_state.install_retry_remaining -= 1
                _docling_state.attempted = False
                logger.warning(
                    "OCR dependency install failed (may be transient); will retry once: %s", exc
                )
            else:
                _docling_state.error = str(exc)
    return _docling_state.converter, _docling_state.error


def _reset_docling_singleton() -> None:
    """Reset the cached Docling converter. Intended for test isolation only."""
    with _docling_lock:
        _docling_state.converter = None
        _docling_state.error = None
        _docling_state.attempted = False
        _docling_state.install_retry_remaining = 1


def _require_file_processing(module_name: str) -> object:
    """Import an optional file-parsing dependency, auto-installing on first miss.

    The CLI image ships only default dependencies; file-parsing libraries
    (pdfplumber, python-docx, openpyxl, pyarrow, filetype, chardet) live in the
    optional ``file-processing`` uv group and are installed on demand at runtime
    (mirrors how detectors pull their own groups). Raises MissingDependencyError
    if the group cannot be installed; callers already treat that as a parse
    failure / fall back gracefully.
    """
    from ..detectors.dependencies import require_module

    return require_module(module_name, "file parser", ["file-processing"])


def normalize_mime_type(mime_type: str | None) -> str:
    """Strip parameters, lower-case, and collapse "unknown bytes" aliases.

    The single place MIME strings are normalized. Sources must use this rather
    than an inline ``split(";")[0].strip().lower()``: that idiom looks equivalent
    but skips the alias collapsing, which is exactly how `binary/octet-stream`
    from S3-compatible stores slipped through as a real content type.
    """
    if not mime_type:
        return ""
    return _canonical_mime_type(str(mime_type).split(";", 1)[0].strip().lower())


# Internal alias kept so the many call sites in this module stay unchanged.
_normalize_mime_type = normalize_mime_type


def _file_extension(file_name: str) -> str:
    if not file_name:
        return ""
    path = urlsplit(file_name).path
    value = path if path else file_name
    return Path(value).suffix.lower()


def _base_file_name(file_name: str) -> str:
    if not file_name:
        return ""
    path = urlsplit(file_name).path or file_name
    return Path(path).name.lower()


def infer_mime_type_from_file_name(file_name: str) -> str:
    """Infer MIME type from file name or URL path extension.

    Falls back to the whole file name for the code files that carry no
    extension at all — a Dockerfile or a Makefile is still source, and a
    repository is full of them.
    """
    extension = _file_extension(file_name)
    if extension:
        hint = _MIME_HINTS_BY_EXTENSION.get(extension)
        if hint:
            return hint
    base_name = _base_file_name(file_name)
    by_name = _CODE_MIME_HINTS_BY_FILE_NAME.get(base_name)
    if by_name:
        return by_name
    # .env.local, .env.production, … all hold the same kind of thing.
    if base_name.startswith(".env"):
        return "text/x-env"
    return "application/octet-stream"


# Public view of the tabular set. A payload in it has a row axis, which is what
# lets a sampling strategy address "the next 100 rows" of it (see
# ``pipeline.payload_window``).
TABULAR_MIME_TYPES = frozenset(_TABULAR_MIME_TYPES)


def is_tabular_mime_type(mime_type: str | None) -> bool:
    """Whether this payload has a row axis a sampling window can address."""
    return _normalize_mime_type(mime_type) in TABULAR_MIME_TYPES


def tabular_mime_type_for_name(file_name: str) -> str | None:
    """The tabular MIME type a file name implies, or None if it implies none.

    Name-only, so a caller can tell whether an asset is row-shaped without
    downloading it — which is what the scan cache needs before it decides to
    skip an asset it would otherwise never fetch.
    """
    inferred = infer_mime_type_from_file_name(file_name)
    return inferred if inferred in TABULAR_MIME_TYPES else None


def normalize_detected_mime_type(detected_mime_type: str, file_name: str) -> str:
    """
    Normalize detected MIME with filename-based fallbacks.

    Keeps parser behavior stable for sources that declare generic or plain-text
    content-types for tabular files.
    """
    mime = _normalize_mime_type(detected_mime_type)
    inferred_mime = infer_mime_type_from_file_name(file_name)

    if not mime or mime == OCTET_STREAM:
        return inferred_mime

    if mime == "text/plain" and inferred_mime in _TABULAR_MIME_TYPES:
        return inferred_mime

    # Source code, where the name is better evidence than the contents. Content
    # sniffing reads the first few characters, and by that measure a Python
    # module whose first line is `from a import b, c, d` is a CSV and a minified
    # bundle beginning with `{` is JSON. Both misreadings send the file down a
    # record-oriented reader that produces garbage columns instead of the code.
    if mime in _SNIFFED_TEXT_MIME_TYPES and inferred_mime in _CODE_TEXT_MIME_TYPES:
        return inferred_mime

    # OLE Compound Files (.doc/.xls/.ppt/.msg) share one magic signature; the
    # extension picks the concrete format. Same for a truncated OOXML/ODF zip
    # whose container structure could not be inspected.
    if mime == "application/x-ole-storage" and inferred_mime in _CFB_MIME_TYPES:
        return inferred_mime
    if mime == "application/zip" and inferred_mime in _ZIP_CONTAINER_MIME_TYPES:
        return inferred_mime

    return mime


def _is_text_like_mime_type(mime_type: str) -> bool:
    normalized_mime = _normalize_mime_type(mime_type)
    return normalized_mime.startswith("text/") or normalized_mime in _TEXT_RAW_MIME_TYPES


def _detect_magic_mime_type(
    file_bytes: bytes, zip_source: BinarySource | None = None
) -> str | None:
    signatures: tuple[tuple[bytes, str], ...] = (
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"%PDF-", "application/pdf"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"{\\rtf", "application/rtf"),
        (b"\x1f\x8b", "application/gzip"),
        (b"7z\xbc\xaf\x27\x1c", "application/x-7z-compressed"),
        (b"Rar!\x1a\x07", "application/vnd.rar"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/x-ole-storage"),
        # Arrow IPC file layout, and the legacy Feather V1 layout it replaced.
        # Both answer to the same MIME type; the reader dispatches on the magic
        # again because only one of them is random-access. The streaming layout
        # has no magic at all, so it is recognised by name alone.
        (b"ARROW1\x00\x00", ARROW_FILE_MIME_TYPE),
        (b"FEA1", ARROW_FILE_MIME_TYPE),
    )

    for signature, mime_type in signatures:
        if file_bytes.startswith(signature):
            return mime_type

    if file_bytes.startswith(b"PK\x03\x04"):
        return _refine_zip_mime(zip_source if zip_source is not None else file_bytes)

    # POSIX tar: "ustar" magic at offset 257 (no leading signature).
    if len(file_bytes) > 262 and file_bytes[257:262] == b"ustar":
        return "application/x-tar"

    return None


def _refine_zip_mime(source: BinarySource) -> str:
    """Distinguish document formats that are ZIP containers from real archives.

    ODF files carry an uncompressed ``mimetype`` entry; OOXML files carry
    ``[Content_Types].xml`` plus a format-specific folder (word/, xl/, ppt/).
    Anything else (or an unreadable/truncated zip) stays ``application/zip``.
    """
    import zipfile

    try:
        with zipfile.ZipFile(as_binary_io(source)) as archive:
            names = set(archive.namelist())
            if "mimetype" in names:
                declared = archive.read("mimetype").decode("ascii", errors="replace").strip()
                if declared.startswith("application/vnd.oasis.opendocument"):
                    return declared
            if "[Content_Types].xml" in names:
                for prefix, mime_type in _OOXML_MIME_BY_PREFIX:
                    if any(name.startswith(prefix) for name in names):
                        return mime_type
    except Exception as exc:
        logger.debug("ZIP MIME refinement failed: %s", exc)
    return "application/zip"


def _null_bytes_look_interleaved(sample: bytes, unit: int) -> bool:
    """
    Whether the null bytes sit where a fixed-width encoding would put them.

    This is the structural signal that separates real UTF-16/32 from binary
    that merely happens to contain a null. Text in a fixed-width encoding pads
    every character to `unit` bytes, so for any script whose code points fit in
    the low byte the padding lands at the SAME offset within every unit, and it
    is common: roughly half the bytes for UTF-16 Latin text, three quarters for
    UTF-32. Binary with an incidental null shows neither property.
    """
    if len(sample) < unit * 2:
        return False
    nulls = sample.count(0)
    # Well under what padding produces, so the nulls are incidental.
    if nulls * unit < len(sample) * 0.5:
        return False
    offsets = {i % unit for i, byte in enumerate(sample) if byte == 0}
    # Padding occupies fixed positions; scattered nulls are not padding.
    return len(offsets) < unit


def _is_null_byte_unicode_text(file_bytes: bytes) -> bool:
    """UTF-16/32 text interleaves null bytes with every character — still text."""
    # \xff\xfe prefixes both UTF-16 LE and UTF-32 LE BOMs.
    if file_bytes.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff")):
        return True
    try:
        chardet = _require_file_processing("chardet")

        detected = chardet.detect(file_bytes[:4096])  # type: ignore[attr-defined]
        encoding = (detected.get("encoding") or "").lower()
        if not encoding.startswith(("utf-16", "utf-32")):
            return False
        # Almost any even byte sequence decodes as *valid* UTF-16 code units,
        # so a successful decode is not enough — the result must read as text.
        unit = 4 if encoding.startswith("utf-32") else 2
        sample = file_bytes[:4096]
        sample = sample[: len(sample) - len(sample) % unit]
        decoded = sample.decode(encoding)
        if not decoded:
            return False
        # Printability alone is not enough either, and this is where short
        # binary payloads got through: chardet calls b"\x00\x01\x02\x03binary"
        # utf-16-le with 0.95 confidence, it decodes to CJK code points, and
        # every one of those is `isprintable()`. So the payload was reported as
        # text/plain and the parser tried to read it as text. Require the nulls
        # to sit where an encoding's padding would actually put them.
        if not _null_bytes_look_interleaved(sample, unit):
            return False
        printable = sum(1 for ch in decoded if ch.isprintable() or ch.isspace())
        return printable / len(decoded) >= 0.9
    except Exception:
        return False


def _sniff_text_mime(file_bytes: bytes) -> str:
    """Fallback MIME detection for text formats not handled by filetype."""
    # Check for null bytes → binary (unless it's null-byte-bearing Unicode text)
    if b"\x00" in file_bytes[:8192] and not _is_null_byte_unicode_text(file_bytes):
        return "application/octet-stream"

    # Try to decode a sample for text-based sniffing
    sample = ""
    try:
        chardet = _require_file_processing("chardet")

        detected = chardet.detect(file_bytes[:4096])  # type: ignore[attr-defined]
        encoding = detected.get("encoding") or "utf-8"
        sample = file_bytes[:4096].decode(encoding, errors="replace")
    except Exception:
        try:
            sample = file_bytes[:4096].decode("utf-8", errors="replace")
        except Exception:
            return "application/octet-stream"

    stripped = sample.lstrip()

    if stripped.startswith("{") or stripped.startswith("["):
        return "application/json"
    if stripped.startswith("<?xml"):
        return "application/xml"
    if stripped.lower().startswith("<!doctype html") or stripped.lower().startswith("<html"):
        return "text/html"

    # CSV heuristic: first non-empty line has multiple commas
    first_line = stripped.split("\n")[0] if "\n" in stripped else stripped
    if first_line.count(",") >= 2:
        return "text/csv"

    return "text/plain"


def detect_mime_type(source: BinarySource) -> str:
    """
    Detect MIME type from a payload.

    Uses magic-byte detection first (filetype library), then falls back to
    text-based sniffing for formats that filetype doesn't cover.

    Only a bounded prefix is read. Format identity lives in the first few bytes
    of every format this recognises, so detection must never be the step that
    pulls a multi-gigabyte object into memory. The one exception is a ZIP
    signature, whose refinement needs the archive's directory at the far end —
    and that is done through the handle, not a copy.
    """
    prefix = header(source, _MIME_HEADER_BYTES)
    if not prefix:
        return "application/octet-stream"

    magic_mime_type = _detect_magic_mime_type(prefix, source)
    if magic_mime_type:
        return magic_mime_type

    try:
        filetype = _require_file_processing("filetype")

        kind = filetype.guess(prefix)  # type: ignore[attr-defined]
        if kind is not None:
            return str(kind.mime)
    except Exception as e:
        logger.debug(f"filetype detection failed: {e}")

    return _sniff_text_mime(prefix)


def _supports_docling_ocr(mime_type: str, file_name: str) -> bool:
    normalized = _normalize_mime_type(mime_type)
    if normalized in _DOCLING_IMAGE_MIME_TYPES:
        return True
    if normalized in _OCR_CONVERTIBLE_IMAGE_MIME_TYPES:
        return True
    if normalized in _DOCLING_MIME_TYPES:
        return True
    return _file_extension(file_name) in _DOCLING_EXTENSIONS


# Images this small on either axis hold no legible text: tracking pixels, spacer
# images, favicons, Notion page icons. Handing one to docling loads the ~1 GB OCR
# pipeline and spends seconds to return zero characters, and a source that emits
# hundreds of them (every Notion page can carry an icon and a cover) drives the
# worker into an OOMKill. Dimensions are read straight from the format header —
# no decode, no Pillow dependency.
_MIN_OCR_IMAGE_PIXELS = 32

# Byte-size floor used only when the dimensions cannot be read (JPEG, WebP, HEIC).
# Deliberately low: a large image of mostly one colour compresses to a few hundred
# bytes and may still carry a line of text, so this must not stand in for the
# dimension check.
_MIN_OCR_IMAGE_BYTES = 256


def _image_dimensions(file_bytes: bytes, mime_type: str) -> tuple[int, int] | None:
    """Read pixel dimensions from an image header, or None if not derivable."""
    try:
        if mime_type == "image/png" and len(file_bytes) >= 24:
            # IHDR is always the first chunk: width and height are big-endian
            # uint32 at offsets 16 and 20.
            return (
                int.from_bytes(file_bytes[16:20], "big"),
                int.from_bytes(file_bytes[20:24], "big"),
            )
        if mime_type == "image/gif" and len(file_bytes) >= 10:
            return (
                int.from_bytes(file_bytes[6:8], "little"),
                int.from_bytes(file_bytes[8:10], "little"),
            )
        if mime_type == "image/bmp" and len(file_bytes) >= 26:
            return (
                int.from_bytes(file_bytes[18:22], "little"),
                int.from_bytes(file_bytes[22:26], "little"),
            )
    except Exception as exc:
        logger.debug("Image dimension read failed for %s: %s", mime_type, exc)
    return None


def _ocr_skip_reason(file_bytes: bytes, mime_type: str) -> str | None:
    """Return why OCR should be skipped for this image, or None to proceed."""
    normalized = _normalize_mime_type(mime_type)
    if not normalized.startswith("image/"):
        return None

    dimensions = _image_dimensions(file_bytes, normalized)
    if dimensions is not None:
        # Dimensions are authoritative when available: byte size says nothing
        # about legibility, since a mostly-uniform 1000x1000 scan can compress
        # smaller than a noisy thumbnail.
        width, height = dimensions
        if 0 < min(width, height) < _MIN_OCR_IMAGE_PIXELS:
            return f"image is {width}x{height} (< {_MIN_OCR_IMAGE_PIXELS}px on one axis)"
        return None

    if len(file_bytes) < _MIN_OCR_IMAGE_BYTES:
        return f"image is {len(file_bytes)} bytes with unreadable dimensions"

    return None


def _convert_image_to_png(file_bytes: bytes, mime_type: str) -> tuple[bytes | None, str | None]:
    """Convert a GIF (first frame) or HEIC/HEIF image to PNG bytes for OCR."""
    import io

    try:
        if mime_type in ("image/heic", "image/heif"):
            pillow_heif = _require_file_processing("pillow_heif")
            pillow_heif.register_heif_opener()  # type: ignore[attr-defined]
        image_module = _require_file_processing("PIL.Image")
        with image_module.open(io.BytesIO(file_bytes)) as image:  # type: ignore[attr-defined]
            image.seek(0)  # first frame of animated GIFs
            frame = image.convert("RGB")
        output = io.BytesIO()
        frame.save(output, format="PNG")
        return output.getvalue(), None
    except Exception as exc:
        return None, f"Image conversion to PNG failed: {exc}"


# PDFs with fewer extracted chars than this are likely scanned/image-only and
# need the full docling OCR pipeline.  Most text-layer PDFs yield hundreds of
# chars; a threshold of 50 is conservative enough to never skip real content.
_MIN_NATIVE_PDF_CHARS = 50


def _extract_pdf_text(source: BinarySource) -> tuple[str, str | None]:
    """Extract text from a PDF using pdfplumber (no ML models required).

    Driven from a handle: pdfplumber reads the cross-reference table and then the
    pages it is asked for, so a spooled PDF is paged in from disk rather than
    copied into the heap.
    """
    try:
        pdfplumber = _require_file_processing("pdfplumber")

        with pdfplumber.open(as_binary_io(source)) as pdf:  # type: ignore[attr-defined]
            pages = []
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text:
                    pages.append(text)
        return "\n\n".join(pages), None
    except Exception as e:
        return "", f"PDF extraction failed: {e}"


def _temp_file_name(file_name: str, mime_type: str) -> str:
    extension = _file_extension(file_name)
    if extension:
        return f"input{extension}"

    for suffix, candidate_mime in _MIME_HINTS_BY_EXTENSION.items():
        if candidate_mime == mime_type:
            return f"input{suffix}"

    if mime_type.startswith("image/"):
        suffix = mime_type.split("/", maxsplit=1)[1].replace("jpeg", "jpg")
        return f"input.{suffix}"

    return "input.bin"


def _extract_docling_markdown(
    file_bytes: bytes,
    *,
    mime_type: str,
    file_name: str,
) -> tuple[str, str | None]:
    converter, error = _get_docling_converter()
    if error:
        return "", error
    if converter is None:
        return "", "Docling converter unavailable"

    temp_fname = _temp_file_name(file_name, mime_type)
    try:
        with tempfile.TemporaryDirectory(prefix="classifyre-docling-") as temp_dir:
            temp_path = Path(temp_dir) / temp_fname
            temp_path.write_bytes(file_bytes)
            with _docling_conversion_sem:
                result = converter.convert(temp_path)  # type: ignore[union-attr]
            text = result.document.export_to_markdown().strip()
            page_count = len(result.document.pages) if hasattr(result.document, "pages") else None
            logger.info(
                "OCR extracted %d chars from %s (%s%s)",
                len(text),
                file_name or mime_type,
                mime_type,
                f", {page_count} pages" if page_count else "",
            )
            return text, None
    except Exception as exc:
        return "", f"Docling extraction failed: {exc}"


def extract_text(
    source: BinarySource,
    mime_type: str,
    *,
    file_name: str = "",
) -> tuple[str, str | None]:
    """
    Extract plain text from a payload based on MIME type.

    ``source`` is the file's bytes or a seekable handle over them. The formats
    that dominate large corpora — PDF, DOCX, XLSX, ODF, ZIP — are read straight
    from the handle, so a payload that was spooled to disk is paged in by the OS
    instead of being copied into the heap; that is what lets a source lift its
    size cap. The remaining formats (media, images, legacy Office) are read whole
    because their extractors write the payload to a temp file anyway or are
    bounded by nature.

    Returns:
        (text_content, error_message_or_None)
    """
    # Materialized only by the branches that cannot work from a handle, and at
    # most once. Everything above this line — and every ``as_binary_io(source)``
    # below — leaves a spooled payload on disk where it belongs.
    resident: list[bytes | None] = [None]

    def file_bytes() -> bytes:
        if resident[0] is None:
            resident[0] = read_all(source)
        return resident[0]

    ocr_error: str | None = None
    ocr_skip_reason = (
        _ocr_skip_reason(file_bytes(), mime_type)
        if _normalize_mime_type(mime_type).startswith("image/")
        else None
    )
    if ocr_skip_reason:
        logger.debug(
            "Skipping OCR for %s: %s",
            file_name or mime_type,
            ocr_skip_reason,
        )
    if not ocr_skip_reason and _supports_docling_ocr(mime_type, file_name):
        # PDFs: try cheap native text extraction first.  Only hand off to the
        # heavy docling pipeline when the native path yields too little text,
        # which indicates a scanned or image-only PDF that genuinely needs OCR.
        # This avoids loading the ~1 GB StandardPdfPipeline for the majority of
        # PDFs that already carry a text layer.
        if mime_type == "application/pdf":
            cheap_text, cheap_error = _extract_pdf_text(source)
            if len(cheap_text.strip()) >= _MIN_NATIVE_PDF_CHARS:
                logger.info(
                    "OCR extracted %d chars from %s (%s, native text layer)",
                    len(cheap_text.strip()),
                    file_name or mime_type,
                    mime_type,
                )
                return cheap_text, cheap_error
        # Images, PPTX, and sparse/scanned PDFs: use docling. DOCX/XLSX/HTML
        # take their inexpensive native text paths; embedded images are emitted
        # separately as IMAGE assets by sources that materialize containers.
        # GIF/HEIC/HEIF are converted to PNG first — docling can't read them.
        ocr_bytes: bytes | None = file_bytes()
        ocr_mime = mime_type
        ocr_name = file_name
        if _normalize_mime_type(mime_type) in _OCR_CONVERTIBLE_IMAGE_MIME_TYPES:
            ocr_bytes, conversion_error = _convert_image_to_png(file_bytes(), mime_type)
            ocr_mime = "image/png"
            ocr_name = "converted.png"
            if conversion_error:
                logger.warning(
                    "Image conversion failed for %s: %s", file_name or mime_type, conversion_error
                )
                ocr_error = conversion_error
        if ocr_bytes is not None:
            text, error = _extract_docling_markdown(
                ocr_bytes,
                mime_type=ocr_mime,
                file_name=ocr_name,
            )
            if text:
                return text, None
            if error:
                logger.warning("OCR extraction failed for %s: %s", file_name or mime_type, error)
                ocr_error = error

    # Media processing is based on detected content type, never source config.
    if mime_type.startswith("audio/"):
        from .transcription import transcribe_media

        text, error = transcribe_media(
            file_bytes(),
            mime_type=mime_type,
            file_name=file_name,
        )
        if error:
            logger.warning("Transcription failed for %s: %s", file_name or mime_type, error)
        return text, error

    if mime_type.startswith("video/"):
        from .transcription import transcribe_media
        from .video_processing import extract_video_ocr

        transcript, transcript_error = transcribe_media(
            file_bytes(),
            mime_type=mime_type,
            file_name=file_name,
        )
        visual_text, visual_error = extract_video_ocr(file_bytes(), file_name=file_name)
        sections: list[str] = []
        if transcript:
            sections.append(f"[Transcript]\n{transcript}")
        if visual_text:
            sections.append(visual_text)
        errors = [error for error in (transcript_error, visual_error) if error]
        for error in errors:
            logger.warning("Video extraction failed for %s: %s", file_name or mime_type, error)
        return "\n\n".join(sections), "; ".join(errors) or None

    # Unsupported image formats have no native text path; supported images were
    # already handled by the automatic OCR branch above.
    if mime_type.startswith("image/"):
        return "", ocr_error

    # PDF
    if mime_type == "application/pdf":
        native_text, native_error = _extract_pdf_text(source)
        return native_text, native_error or ocr_error

    # DOCX
    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            docx = _require_file_processing("docx")

            doc = docx.Document(as_binary_io(source))  # type: ignore[attr-defined]
            parts: list[str] = []
            for para in doc.paragraphs:
                if para.text.strip():
                    parts.append(para.text)
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            parts.append(cell.text)
            return "\n".join(parts), None
        except Exception as e:
            return "", f"DOCX extraction failed: {e}"

    # XLSX
    if mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        try:
            openpyxl = _require_file_processing("openpyxl")

            wb = openpyxl.load_workbook(  # type: ignore[attr-defined]
                as_binary_io(source), read_only=True, data_only=True
            )
            rows: list[str] = []
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(c.strip() for c in cells):
                        rows.append("\t".join(cells))
            return "\n".join(rows), None
        except Exception as e:
            return "", f"XLSX extraction failed: {e}"

    # ODF (odt/ods/odp) and Outlook .msg — docling parses these natively.
    if mime_type in _DOCLING_NATIVE_DOCUMENT_MIME_TYPES:
        return _extract_docling_markdown(
            file_bytes(),
            mime_type=mime_type,
            file_name=file_name,
        )

    # EML — stdlib email parser (headers + body; no heavy dependencies).
    if mime_type == "message/rfc822":
        return _extract_eml_text(file_bytes())

    # RTF (before the generic text/* branch: text/rtf must not pass through raw)
    if mime_type in ("application/rtf", "text/rtf"):
        try:
            striprtf = _require_file_processing("striprtf.striprtf")

            return striprtf.rtf_to_text(_decode_bytes(file_bytes())), None  # type: ignore[attr-defined]
        except Exception as e:
            return "", f"RTF extraction failed: {e}"

    # Legacy Office (.doc/.xls/.ppt): LibreOffice → OOXML → native extraction.
    if mime_type in _LEGACY_OFFICE_MIME_TYPES:
        return _extract_legacy_office_text(file_bytes(), mime_type, file_name=file_name)

    # Archive containers carry no text of their own; object-storage sources
    # expand their members into standalone child assets instead.
    if mime_type in ARCHIVE_MIME_TYPES:
        return "", None

    # HTML / XHTML
    if mime_type in ("text/html", "application/xhtml+xml"):
        try:
            from .content_extraction import html_to_text

            text = _decode_bytes(file_bytes())
            return html_to_text(text), None
        except Exception as e:
            return "", f"HTML extraction failed: {e}"

    # XML — parsed securely with defusedxml (falls back to raw decoded text)
    if mime_type in ("application/xml", "text/xml"):
        return _extract_xml_text(file_bytes())

    # JSON — decode as-is
    if mime_type == "application/json":
        return _decode_bytes(file_bytes()), None

    # Plain text, CSV, Markdown, and other text/* types
    if mime_type.startswith("text/"):
        return _decode_bytes(file_bytes()), None

    # Parquet — stream row-by-row (never read_table the whole file into memory)
    # and reuse the page iterator so file columns get placeholders, not raw bytes.
    if mime_type in ("application/parquet", "application/vnd.apache.parquet"):
        try:
            pages = _iter_parquet_pages(source, batch_size=1000, include_column_names=True)
            return "\n".join(pages), None
        except Exception as e:
            return "", f"Parquet extraction failed: {e}"

    # Arrow IPC / Feather — same treatment as Parquet: rows are streamed one
    # batch at a time and file-bearing columns render as placeholders.
    if mime_type in ARROW_MIME_TYPES:
        try:
            pages = _iter_arrow_pages(source, batch_size=1000, include_column_names=True)
            return "\n".join(pages), None
        except Exception as e:
            return "", f"Arrow extraction failed: {e}"

    # Unknown / binary
    return "", ocr_error


def _extract_eml_text(file_bytes: bytes) -> tuple[str, str | None]:
    """Extract headers, body text, and attachment names from an RFC-822 email."""
    import email
    import email.policy

    try:
        message = email.message_from_bytes(file_bytes, policy=email.policy.default)

        sections: list[str] = []
        for header in ("From", "To", "Cc", "Subject", "Date"):
            value = message.get(header)
            if value:
                sections.append(f"{header}: {value}")

        body = message.get_body(preferencelist=("plain", "html"))  # type: ignore[attr-defined]
        if body is not None:
            content = str(body.get_content())
            if body.get_content_type() == "text/html":
                from .content_extraction import html_to_text

                content = html_to_text(content)
            if content.strip():
                sections.append("")
                sections.append(content.strip())

        for attachment in message.iter_attachments():  # type: ignore[attr-defined]
            file_name = attachment.get_filename()
            if file_name:
                sections.append(f"[Attachment: {file_name} ({attachment.get_content_type()})]")

        return "\n".join(sections), None
    except Exception as e:
        return "", f"EML extraction failed: {e}"


def _extract_xml_text(file_bytes: bytes) -> tuple[str, str | None]:
    """Extract text securely from XML using defusedxml (XXE / entity-expansion safe).

    Emits one ``tag: text`` line per element plus ``tag@attribute: value`` lines
    so detectors keep the element context. Malformed XML (or a missing
    defusedxml) falls back to the raw decoded text, matching the old behavior.
    """
    decoded = _decode_bytes(file_bytes)
    try:
        defused_et = _require_file_processing("defusedxml.ElementTree")

        root = defused_et.fromstring(decoded)  # type: ignore[attr-defined]
    except Exception as exc:
        logger.debug("Secure XML parse failed; falling back to raw text: %s", exc)
        return decoded, None

    def _local_name(name: str) -> str:
        return name.rsplit("}", 1)[-1]

    lines: list[str] = []
    for element in root.iter():
        tag = _local_name(str(element.tag))
        for attribute, value in element.attrib.items():
            lines.append(f"{tag}@{_local_name(attribute)}: {value}")
        text = (element.text or "").strip()
        if text:
            lines.append(f"{tag}: {text}")
    return "\n".join(lines), None


def _extract_legacy_office_text(
    file_bytes: bytes,
    mime_type: str,
    *,
    file_name: str,
) -> tuple[str, str | None]:
    """Convert .doc/.xls/.ppt via LibreOffice, then run the modern extractor."""
    from .legacy_office import convert_legacy_office

    converted, target_mime, error = convert_legacy_office(file_bytes, mime_type)
    if converted is None:
        return "", error
    suffix = next(
        (ext for ext, mime in _MIME_HINTS_BY_EXTENSION.items() if mime == target_mime), ""
    )
    converted_name = f"{Path(file_name).stem or 'converted'}{suffix}"
    return extract_text(converted, target_mime, file_name=converted_name)


def _detect_encoding(sample: bytes) -> str:
    """The encoding to read a text payload as, sniffed from a prefix."""
    try:
        chardet = _require_file_processing("chardet")

        detected = chardet.detect(sample[:65536])  # type: ignore[attr-defined]
        return str(detected.get("encoding") or "utf-8")
    except Exception:
        return "utf-8"


def _decode_bytes(file_bytes: bytes) -> str:
    """Decode bytes to str using chardet for encoding detection."""
    try:
        decoded = file_bytes.decode(_detect_encoding(file_bytes), errors="replace")
    except Exception:
        decoded = file_bytes.decode("utf-8", errors="replace")
    # Postgres TEXT columns reject NUL outright; any that survive decoding
    # (binary content that slipped past mime detection) must not reach storage.
    return decoded.replace("\x00", "")


def is_readable_text(raw: bytes) -> bool:
    """Whether bytes decode to something a text detector could actually read.

    A successful UTF-8 decode is not the test: ``b"\\x01\\x02\\x03"`` decodes
    cleanly and reads as nothing. What matters is whether the result is mostly
    printable, which is what separates a UTF-8 document stored in a BLOB from a
    packed float array stored in the same column type.
    """
    sample = raw[:4096]
    if not sample:
        return False
    if b"\x00" in sample:
        # UTF-16/32 interleaves a NUL with every character and is still text.
        return _is_null_byte_unicode_text(sample)
    decoded = sample.decode("utf-8", errors="replace")
    printable = sum(1 for char in decoded if char.isprintable() or char.isspace())
    return printable / len(decoded) >= 0.9


def render_bytes_cell(raw: bytes) -> str:
    """Render a byte-valued field as detector-visible text.

    Sources hand rows and documents to text detectors as strings, so every
    byte-valued field has to become one. The two obvious ways are both wrong:
    ``str(value)`` emits a Python repr — ``b'{"email": ...}'``, with the prefix,
    escaped quotes and ``\\n`` spelled out — and a flat ``<N bytes>`` summary drops
    the content entirely, so text stored in a BLOB is never scanned by anything.

    This decodes what is readable and summarizes only what isn't.
    """
    if is_readable_text(raw):
        return _decode_bytes(raw)
    return f"<{len(raw)} bytes>"


def json_safe_default(value: Any) -> Any:
    """``json.dumps(default=...)`` that keeps byte fields readable.

    ``default=str`` is the usual choice and it is how a BSON ``Binary`` holding a
    JSON document reached the detectors as a doubly-escaped repr string.
    """
    if isinstance(value, bytes | bytearray | memoryview):
        return render_bytes_cell(bytes(value))
    return str(value)


def resolve_mime_type(
    source: BinarySource,
    *,
    declared_mime_type: str | None = None,
    file_name: str = "",
) -> str:
    """
    Resolve effective MIME type from declared hint, magic-byte detection, and file extension.

    Kept separate from full parsing so callers can detect format cheaply without
    paying for text extraction (e.g. when content will be streamed in pages later).
    """
    declared_mime = _normalize_mime_type(declared_mime_type)
    detected_mime = _normalize_mime_type(detect_mime_type(source))
    inferred_mime = infer_mime_type_from_file_name(file_name)

    if declared_mime and declared_mime != OCTET_STREAM:
        mime_type = declared_mime
    elif detected_mime and detected_mime != OCTET_STREAM:
        mime_type = detected_mime
    elif inferred_mime and inferred_mime != OCTET_STREAM:
        mime_type = inferred_mime
    else:
        mime_type = declared_mime or detected_mime or inferred_mime or OCTET_STREAM

    mime_type = normalize_detected_mime_type(mime_type, file_name)
    if mime_type == OCTET_STREAM and inferred_mime != OCTET_STREAM:
        mime_type = inferred_mime

    # A text-like claim (declared upload header or file extension) must survive
    # content inspection: a binary renamed to .txt otherwise decodes to
    # control-character garbage that poisons every text consumer downstream.
    if (
        payload_size(source) != 0
        and detected_mime == OCTET_STREAM
        and (mime_type.startswith("text/") or mime_type in ("application/json", "application/xml"))
    ):
        return OCTET_STREAM

    return mime_type


def parse_bytes(
    source: BinarySource,
    *,
    declared_mime_type: str | None = None,
    file_name: str = "",
) -> ParsedBytes:
    """
    Parse a payload in one shot: resolve MIME type and extract raw/text content.

    Used by file evaluation and any caller that needs a complete ParsedBytes at
    once. Object-storage sources prefer resolve_mime_type() + iter_file_pages(),
    which stream instead of building the whole text in memory.
    """
    file_size_bytes = payload_size(source) or 0
    mime_type = resolve_mime_type(
        source, declared_mime_type=declared_mime_type, file_name=file_name
    )

    text_content, parse_error = extract_text(
        source,
        mime_type,
        file_name=file_name,
    )
    raw_content = _decode_bytes(read_all(source)) if _is_text_like_mime_type(mime_type) else ""

    if mime_type in {"text/html", "application/xhtml+xml"} and raw_content and not text_content:
        from .content_extraction import html_to_text

        text_content = html_to_text(raw_content)

    is_binary = (
        mime_type.startswith(("image/", "audio/", "video/"))
        or mime_type == "application/octet-stream"
        or mime_type in ARCHIVE_MIME_TYPES
    )

    return ParsedBytes(
        mime_type=mime_type,
        raw_content=raw_content,
        text_content=text_content,
        is_binary=is_binary,
        file_size_bytes=file_size_bytes,
        parse_error=parse_error,
    )


def iter_file_pages(
    file_bytes: BinarySource,
    mime_type: str,
    batch_size: int = 100,
    include_column_names: bool = True,
    *,
    file_name: str = "",
    start_row: int = 0,
    max_rows: int | None = None,
) -> Generator[str, None, None]:
    """
    Iterate over file content in pages of up to batch_size rows or lines.

    Parquet / Arrow IPC / CSV / TSV → yields batch_size *rows* per page with
    labelled columns.
    All other extractable types (PDF, DOCX, TXT, JSON, XML, XLSX, …) → extracts the
    full text once via extract_text(), then yields batch_size *lines* per page.
    Audio/video → transcript lines; video also yields distinct-frame OCR.
    Unknown binary types → yield nothing.

    New file formats only need to be added to extract_text() — not here.

    ``start_row``/``max_rows`` bound the sweep to one window of a tabular payload
    (see ``pipeline.payload_window``). They are pushed down into the reader where
    the format allows it — a Parquet sweep resuming at row 4,000,000 skips whole
    row groups without decoding them — and only ever restrict the output, so a
    caller that leaves them at their defaults sees exactly the previous behaviour.
    They are ignored for payloads with no row axis, which have no window to apply.

    ``file_bytes`` may also be a seekable binary handle. The row-oriented readers
    (Parquet, CSV/TSV) then read through it, so the payload never has to be held
    in memory to be paged; the remaining formats extract whole text and only
    borrow the handle to get at their bytes.
    """
    normalized = _normalize_mime_type(mime_type)

    if normalized in ("application/parquet", "application/vnd.apache.parquet"):
        yield from _iter_parquet_pages(
            file_bytes,
            batch_size,
            include_column_names,
            start_row=start_row,
            max_rows=max_rows,
        )
    elif normalized in ARROW_MIME_TYPES:
        yield from _iter_arrow_pages(
            file_bytes,
            batch_size,
            include_column_names,
            start_row=start_row,
            max_rows=max_rows,
        )
    elif normalized in ("text/csv", "text/tab-separated-values"):
        yield from _iter_csv_pages(
            file_bytes,
            include_column_names,
            start_row=start_row,
            max_rows=max_rows,
        )
    elif normalized.startswith("audio/"):
        # Stream transcript pages directly from the chunked transcription pipeline
        # so the detector receives text as each ~10-min audio chunk completes
        # instead of waiting for the full file and buffering the entire transcript.
        # The payload itself is materialized: the transcriber writes it to a temp
        # file for ffmpeg either way.
        from .transcription import iter_transcription_pages

        yield from iter_transcription_pages(
            read_all(file_bytes),
            mime_type=normalized,
            file_name=file_name,
            segments_per_page=batch_size,
        )
    elif normalized.startswith("video/"):
        from .transcription import iter_transcription_pages
        from .video_processing import (
            VideoOCREngineUnavailableError,
            VideoOCRZeroFramesError,
            iter_video_ocr_segments,
        )

        media_bytes = read_all(file_bytes)
        try:
            yield from iter_transcription_pages(
                media_bytes,
                mime_type=normalized,
                file_name=file_name,
                segments_per_page=batch_size,
            )
        except Exception as exc:
            logger.warning("Video transcription failed for %s: %s", file_name or mime_type, exc)
        try:
            yield from iter_video_ocr_segments(media_bytes, file_name=file_name)
        except Exception as exc:
            code = TextExtractionCoverageCode.FAILED
            if isinstance(exc, VideoOCREngineUnavailableError):
                code = TextExtractionCoverageCode.ENGINE_UNAVAILABLE
            elif isinstance(exc, VideoOCRZeroFramesError):
                code = TextExtractionCoverageCode.ZERO_FRAMES
            raise TextExtractionCoverageError(
                f"Video OCR coverage failed for {file_name or mime_type}: {exc}",
                code=code,
            ) from exc
    else:
        text, error = extract_text(
            file_bytes,
            normalized,
            file_name=file_name,
        )
        if error:
            logger.warning("Text extraction error (%s): %s", mime_type, error)
            if not text:
                normalized_error = error.casefold()
                unavailable = "unavailable" in normalized_error or "dependency" in normalized_error
                raise TextExtractionCoverageError(
                    f"Text extraction coverage failed for {file_name or mime_type}: {error}",
                    code=(
                        TextExtractionCoverageCode.ENGINE_UNAVAILABLE
                        if unavailable
                        else TextExtractionCoverageCode.FAILED
                    ),
                )
        if text:
            yield from _iter_text_lines(
                text,
                batch_size,
                start_row=start_row,
                max_rows=max_rows,
            )


def _iter_text_lines(
    text: str,
    batch_size: int,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
) -> Generator[str, None, None]:
    """Yield non-empty text in chunks of batch_size lines.

    This is the row axis for tabular formats that reach the detectors as text
    rather than as records — a spreadsheet extracts to one line per row — so the
    payload window addresses it in lines.
    """
    lines = text.splitlines(keepends=True)
    begin = max(0, start_row)
    end = len(lines) if max_rows is None else min(len(lines), begin + max(0, max_rows))
    for start in range(begin, end, batch_size):
        chunk = "".join(lines[start : min(start + batch_size, end)])
        if chunk.strip():
            yield chunk


_PARQUET_MAGIC = b"PAR1"


def count_tabular_rows(source: bytes | Any, mime_type: str) -> int | None:
    """Total rows in a tabular payload, but only when it is free to ask.

    Parquet stores the count in its footer. CSV does not, and counting it would
    mean a full pass — so this returns None there and the caller uses a strategy
    that needs no total (reservoir sampling). None means "unknown", never "zero".

    Arrow IPC is in the CSV camp despite having a footer: that footer records
    where each record batch *starts*, not how many rows it holds, so the only way
    to total them is to read every batch. Paying a full pass to plan a bounded
    one is exactly the trade this function exists to avoid.

    ``source`` may be a seekable file object instead of bytes, in which case only
    the footer is read — the whole point of the range-reading path.
    """
    normalized = _normalize_mime_type(mime_type)
    if normalized not in ("application/parquet", "application/vnd.apache.parquet"):
        return None
    is_bytes = isinstance(source, bytes | bytearray)
    if is_bytes and (len(source) < 8 or bytes(source[-4:]) != _PARQUET_MAGIC):
        return None
    try:
        import io

        pq = _require_file_processing("pyarrow.parquet")
        handle = io.BytesIO(source) if is_bytes else source
        count = int(pq.ParquetFile(handle).metadata.num_rows)  # type: ignore[attr-defined]
    except Exception as exc:
        logger.debug("Parquet row count unavailable: %s", exc)
        return None
    if not is_bytes:
        # pyarrow leaves the handle wherever the footer read ended; the page
        # iterator opens it again from the top.
        try:
            source.seek(0)
        except Exception:  # pragma: no cover - a non-seekable handle never got here
            pass
    return count


def _parquet_row_group_span(
    pf: Any,
    start_row: int,
    max_rows: int | None,
) -> tuple[list[int] | None, int]:
    """Map a row window onto (the row groups holding it, rows to drop up front).

    Parquet keeps per-row-group counts in the footer, so a window can be turned
    into the exact set of groups that carries it. Both ends matter: naming the
    groups is what stops pyarrow from buffering *every* group before handing back
    the first batch, which over a range-reading handle means transferring the
    whole object to read a hundred rows.

    Returns ``(None, start_row)`` when the metadata is unreadable — a
    decode-and-drop, but never a wrong answer — and ``([], 0)`` when the window
    starts at or past the end of the file.
    """
    try:
        metadata = pf.metadata
        num_groups = int(metadata.num_row_groups)
    except Exception:
        return None, start_row

    end = None if max_rows is None else start_row + max(0, max_rows)
    groups: list[int] = []
    drop = 0
    consumed = 0
    for index in range(num_groups):
        try:
            rows = int(metadata.row_group(index).num_rows)
        except Exception:
            return None, start_row
        group_start, consumed = consumed, consumed + rows
        if consumed <= start_row:
            continue
        if end is not None and group_start >= end:
            break
        if not groups:
            drop = start_row - group_start
        groups.append(index)
    return groups, max(0, drop)


def _iter_parquet_pages(
    source: bytes | Any,
    batch_size: int,
    include_column_names: bool,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
) -> Generator[str, None, None]:
    """Yield one page per row of a Parquet payload.

    ``source`` is either the file's bytes or a seekable binary file object. The
    file-object form is what lets a source read a multi-gigabyte object through
    HTTP range requests: pyarrow seeks to the footer, then to the row groups the
    window actually needs, and nothing else is ever transferred.

    A payload that cannot be read raises ``TextExtractionCoverageError`` rather
    than yielding nothing. Yielding nothing is indistinguishable from an empty
    file, and the AUTOMATIC sampling cursor would bank that as "this payload has
    been read end to end" — retiring the asset from every future scan on the
    strength of a failed download.
    """
    # Parquet files begin AND end with the 4-byte magic "PAR1".  If the footer
    # is missing the bytes were truncated mid-download; pyarrow's C++ thread
    # pool will hang indefinitely trying to read schema metadata that isn't
    # there, locking all worker threads on a futex.  Bail out early instead.
    if isinstance(source, bytes | bytearray) and (
        len(source) < 8 or bytes(source[-4:]) != _PARQUET_MAGIC
    ):
        raise TextExtractionCoverageError(
            f"Parquet payload is truncated or not a Parquet file "
            f"(footer magic missing, {len(source)} bytes read). A file larger than "
            f"the configured object-size cap cannot be row-scanned: raise "
            f"optional.connection.max_object_bytes for this source.",
            code=TextExtractionCoverageCode.FAILED,
        )

    try:
        import io

        pq = _require_file_processing("pyarrow.parquet")

        # ParquetFile + iter_batches() reads one row-group at a time instead of
        # loading the whole table into memory, and surfaces schema errors early
        # (before reading any data) so a bad file can't lock the C++ thread pool.
        pf = pq.ParquetFile(  # type: ignore[attr-defined]
            io.BytesIO(source) if isinstance(source, bytes | bytearray) else source
        )

        # Columns whose cells hold bytes are classified once here and rendered by
        # _format_record_row, which never lets them reach str().
        from .embedded_files import detect_parquet_payload_columns

        begin = max(0, start_row)
        groups, drop_in_group = _parquet_row_group_span(pf, begin, max_rows)
        if groups is not None and not groups:
            # The window starts at or past the last row: nothing to read.
            return

        # Sampled from the first group this window reads, so classifying the
        # columns costs no transfer of its own on a range-reading handle.
        payload_columns = detect_parquet_payload_columns(
            pf, sample_row_group=groups[0] if groups else None
        )

        try:
            total_groups = int(pf.metadata.num_row_groups)
        except Exception:
            total_groups = 0
        reads_everything = groups is None or (
            drop_in_group == 0 and len(groups) == total_groups and max_rows is None
        )

        batches = (
            pf.iter_batches(batch_size=batch_size)
            if reads_everything
            else pf.iter_batches(batch_size=batch_size, row_groups=groups)
        )

        # Row numbering stays absolute across runs: a finding reported on
        # "row_4000001" means the same row whichever window found it.
        abs_row = begin
        skipped = 0
        emitted = 0
        for batch in batches:
            for local_idx in range(batch.num_rows):
                if skipped < drop_in_group:
                    skipped += 1
                    continue
                if max_rows is not None and emitted >= max_rows:
                    return
                page = _format_record_row(
                    batch,
                    local_idx,
                    abs_row,
                    payload_columns,
                    include_column_names,
                )
                abs_row += 1
                emitted += 1
                yield page
    except TextExtractionCoverageError:
        raise
    except GeneratorExit:
        # The consumer stopped early (it had its fill of rows). Not a failure.
        raise
    except Exception as exc:
        # A decode that dies part-way through has delivered *some* of the window
        # and none of the rest, which must not read as "the file ends here".
        raise TextExtractionCoverageError(
            f"Parquet page iteration failed after {emitted} row(s): {exc}",
            code=TextExtractionCoverageCode.FAILED,
        ) from exc


def _format_record_row(
    batch: Any,
    local_index: int,
    abs_row: int,
    payload_columns: dict[str, Any],
    include_column_names: bool,
) -> str:
    """Render one row of an Arrow record batch as a detector-visible page.

    Shared by the Parquet and Arrow IPC readers because both hand back Arrow
    record batches, and a row must read identically whichever container it came
    out of — the row text is what a finding quotes, so a difference here would
    make the same data look like two different findings.

    Columns whose cells hold bytes never reach ``str()``: that renders a Python
    repr, so a column of JSON documents would arrive at the detectors as
    ``b'{"email": ...}'`` with escaped quotes. Whole files (HuggingFace
    Image/Audio structs, file-byte columns) render as a placeholder and are
    scanned separately as child assets; text carried as bytes is decoded into the
    row it belongs to; anything else is summarized rather than spelled out.
    """
    from .embedded_files import CONTENT_FILE, CONTENT_TEXT, extract_embedded_bytes

    lines: list[str] = [f"row_{abs_row + 1}:"]
    for col_i, col in enumerate(batch.schema.names):
        cell = batch.column(col_i)[local_index].as_py()
        if col in payload_columns:
            payload_column = payload_columns[col]
            raw = extract_embedded_bytes(cell, payload_column.kind)
            if payload_column.content == CONTENT_TEXT:
                cell_str = _decode_bytes(raw) if raw else ""
            elif payload_column.content == CONTENT_FILE:
                cell_str = _format_embedded_placeholder(raw, payload_column.mime_hint)
            else:
                cell_str = _format_embedded_placeholder(raw, OCTET_STREAM)
        else:
            cell_str = "" if cell is None else str(cell)
        first, *rest = cell_str.splitlines() or [""]
        lines.append(f"  {col}: {first}" if include_column_names else f"  {first}")
        lines.extend(f"    {c}" for c in rest)
    lines.append("")
    return "\n".join(lines)


_ARROW_FILE_MAGIC = b"ARROW1"
_FEATHER_V1_MAGIC = b"FEA1"

# Rows per batch when a payload's own batching cannot be reused (Feather V1,
# which is read as one table). The IPC layouts keep the batches their writer
# chose, so nothing rebatches them.
_ARROW_DEFAULT_BATCH_ROWS = 1000


def open_arrow_batches(
    source: BinarySource,
    *,
    batch_rows: int = _ARROW_DEFAULT_BATCH_ROWS,
) -> tuple[Any, Iterator[Any]]:
    """Open an Arrow payload as ``(schema, record-batch iterator)``.

    Three layouts share the ``.arrow`` / ``.feather`` / ``.ipc`` extensions and
    are told apart by their magic, not their name:

    * **IPC file** (``ARROW1``) — the common one, and the only random-access
      layout: its footer indexes the record batches, so opening it costs a few
      hundred bytes and each batch is fetched on demand. Over a range-reading
      handle that means a multi-gigabyte object is never downloaded whole.
    * **Feather V1** (``FEA1``) — the legacy layout pyarrow still reads, but only
      as a whole table, so this one is resident while it is walked.
    * **IPC stream** (no magic) — batches back to back with no index; read front
      to back, one batch at a time.

    The iterator is lazy in every case except Feather V1, so a caller that stops
    early stops the reading too.
    """
    prefix = header(source, len(_ARROW_FILE_MAGIC))
    handle = as_binary_io(source)

    if prefix.startswith(_ARROW_FILE_MAGIC):
        ipc = _require_file_processing("pyarrow.ipc")
        reader = ipc.open_file(handle)  # type: ignore[attr-defined]

        def _file_batches() -> Iterator[Any]:
            for index in range(reader.num_record_batches):
                yield reader.get_batch(index)

        return reader.schema, _file_batches()

    if prefix.startswith(_FEATHER_V1_MAGIC):
        import warnings

        feather = _require_file_processing("pyarrow.feather")
        # ``read_table`` is the only reader that still understands V1, and pyarrow
        # has it under a deprecation notice pointing at the IPC readers — which
        # cannot read V1 at all. Warning once per legacy file would be noise in a
        # scan log; when pyarrow does drop it, this raises and the caller reports
        # the payload as unreadable rather than as empty.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            table = feather.read_table(handle)  # type: ignore[attr-defined]
        return table.schema, iter(table.to_batches(max_chunksize=max(1, batch_rows)))

    ipc = _require_file_processing("pyarrow.ipc")
    stream = ipc.open_stream(handle)  # type: ignore[attr-defined]
    return stream.schema, iter(stream)


def _arrow_truncation_error(source: BinarySource) -> TextExtractionCoverageError | None:
    """The error for an Arrow payload whose closing magic is missing, else None.

    Same reasoning as the Parquet guard: a payload cut short by an object-size
    cap has lost the index at its end, and reading it as "no rows" is
    indistinguishable from an empty file — which the AUTOMATIC cursor banks as a
    completed sweep, retiring the asset from every future scan. Only checkable on
    resident bytes; a handle is a range reader that was never truncated. The
    streaming layout closes with no magic, so a truncated stream is caught later,
    when a batch fails to decode.
    """
    if not isinstance(source, bytes | bytearray):
        return None
    head = bytes(source[: len(_ARROW_FILE_MAGIC)])
    tail = bytes(source[-len(_ARROW_FILE_MAGIC) :])
    if head.startswith(_ARROW_FILE_MAGIC):
        # 8-byte header (magic + padding), footer length, and the closing magic.
        complete = len(source) >= 18 and tail == _ARROW_FILE_MAGIC
    elif head.startswith(_FEATHER_V1_MAGIC):
        complete = len(source) >= 8 and tail.endswith(_FEATHER_V1_MAGIC)
    else:
        return None
    if complete:
        return None
    return TextExtractionCoverageError(
        f"Arrow payload is truncated (closing magic missing, {len(source)} bytes read). "
        f"A file larger than the configured object-size cap cannot be row-scanned: "
        f"raise optional.connection.max_object_bytes for this source.",
        code=TextExtractionCoverageCode.FAILED,
    )


def _iter_arrow_pages(
    source: BinarySource,
    batch_size: int,
    include_column_names: bool,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
) -> Generator[str, None, None]:
    """Yield one page per row of an Arrow IPC / Feather payload.

    The Parquet reader's twin, row for row: absolute row numbering, the same
    placeholder rendering for columns that hold whole files, and the same refusal
    to report a failed read as an empty payload.

    One difference is worth knowing about. Parquet's footer carries per-row-group
    row counts, so a window starting deep in a file names the groups it needs and
    transfers nothing else. Arrow's footer indexes batches by offset only, so
    reaching row 4,000,000 means walking the batches before it. They are read but
    never formatted, which is where the cost of a row actually is; over a
    range-reading handle, though, those batches are transferred.
    """
    truncation = _arrow_truncation_error(source)
    if truncation is not None:
        raise truncation

    begin = max(0, start_row)
    emitted = 0
    try:
        from .embedded_files import EmbeddedColumn, detect_payload_columns

        schema, batches = open_arrow_batches(source, batch_rows=max(1, batch_size))

        # Classified from the first batch this window actually reads, so the
        # sample costs no reading of its own — the same bargain the Parquet
        # reader strikes by sampling the first row group of its span.
        payload_columns: dict[str, EmbeddedColumn] | None = None

        abs_row = 0
        for batch in batches:
            rows = batch.num_rows
            if abs_row + rows <= begin:
                # Wholly before the window: skipped without formatting a row.
                abs_row += rows
                continue
            if payload_columns is None:
                payload_columns = detect_payload_columns(schema, batch)
            for local_index in range(rows):
                if abs_row < begin:
                    abs_row += 1
                    continue
                if max_rows is not None and emitted >= max_rows:
                    return
                page = _format_record_row(
                    batch,
                    local_index,
                    abs_row,
                    payload_columns,
                    include_column_names,
                )
                abs_row += 1
                emitted += 1
                yield page
            if max_rows is not None and emitted >= max_rows:
                # The window closed exactly on a batch boundary; stop before
                # pulling the next batch off the wire to discover the same thing.
                return
    except TextExtractionCoverageError:
        raise
    except GeneratorExit:
        # The consumer stopped early (it had its fill of rows). Not a failure.
        raise
    except Exception as exc:
        # A decode that dies part-way through has delivered *some* of the window
        # and none of the rest, which must not read as "the file ends here".
        raise TextExtractionCoverageError(
            f"Arrow page iteration failed after {emitted} row(s): {exc}",
            code=TextExtractionCoverageCode.FAILED,
        ) from exc


def _iter_csv_pages(
    source: BinarySource,
    include_column_names: bool,
    *,
    start_row: int = 0,
    max_rows: int | None = None,
) -> Generator[str, None, None]:
    """Yield one page per CSV row, reading the payload incrementally.

    Decoded through a ``TextIOWrapper`` rather than into a string: a CSV is the
    one big format with no index, so the whole file is unavoidably *read* — but
    only a row at a time needs to be *held*. Decoding it whole cost the file's
    size in bytes plus its size again as text plus a list of every line, which is
    what made a multi-gigabyte CSV impossible rather than merely slow.
    """
    import csv
    import io

    handle = as_binary_io(source)
    encoding = _detect_encoding(header(source, 65536)) or "utf-8"
    stream = io.TextIOWrapper(handle, encoding=encoding, errors="replace", newline="")
    emitted = 0
    try:
        reader = csv.DictReader(stream)
        headers = list(reader.fieldnames or [])

        begin = max(0, start_row)
        total_seen = 0

        for row in reader:
            total_seen += 1
            if total_seen <= begin:
                # Skipped rows are never formatted. Parsing them is unavoidable
                # (CSV has no index), but formatting is the expensive half.
                continue
            if max_rows is not None and emitted >= max_rows:
                return
            emitted += 1
            yield _format_tabular_page([dict(row)], headers, total_seen, include_column_names)
    except GeneratorExit:
        raise
    except Exception as exc:
        # Same reasoning as the Parquet reader: a half-read window that reports
        # success is banked by the sampling cursor as a completed sweep.
        raise TextExtractionCoverageError(
            f"CSV page iteration failed after {emitted} row(s): {exc}",
            code=TextExtractionCoverageCode.FAILED,
        ) from exc
    finally:
        # Detach rather than close: the handle belongs to the caller, who may
        # still need it (the same payload is read again for row counts and
        # embedded files). A closed TextIOWrapper would take it down with it.
        try:
            stream.detach()
        except Exception:  # pragma: no cover - already detached or closed
            pass


def _format_embedded_placeholder(raw: bytes | None, mime_hint: str = "") -> str:
    """Compact stand-in for a cell holding a whole file, so its bytes never hit text detectors.

    The label names what the column holds, since that is the only trace of it left
    in the row text once the child asset carries the content.
    """
    if mime_hint.startswith("image/"):
        label = "image"
    elif not mime_hint or mime_hint == OCTET_STREAM:
        label = "binary"
    else:
        label = mime_hint
    if not raw:
        return f"<{label}>"
    size = len(raw)
    if size >= 1024 * 1024:
        human = f"{size / 1024 / 1024:.1f} MB"
    elif size >= 1024:
        human = f"{size / 1024:.0f} KB"
    else:
        human = f"{size} B"
    return f"<{label}: {human}>"


def _format_tabular_page(
    rows: list[dict[str, str]],
    headers: list[str],
    abs_row_start: int,
    include_column_names: bool,
) -> str:
    lines: list[str] = []
    for i, row in enumerate(rows):
        lines.append(f"row_{abs_row_start + i}:")
        for col in headers:
            first, *rest = (row.get(col) or "").splitlines() or [""]
            lines.append(f"  {col}: {first}" if include_column_names else f"  {first}")
            lines.extend(f"    {c}" for c in rest)
        lines.append("")
    return "\n".join(lines)


def parse_file(file_path: Path) -> ParsedFile:
    """
    Parse a local file: detect MIME type and extract text.

    Args:
        file_path: Path to the file on disk.

    Returns:
        ParsedFile with mime_type, text_content, is_binary, etc.

    Raises:
        FileNotFoundError: If file_path does not exist.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    file_bytes = file_path.read_bytes()
    parsed = parse_bytes(file_bytes, file_name=file_path.name)

    encoding: str | None = None
    if not parsed.is_binary and parsed.text_content:
        try:
            chardet = _require_file_processing("chardet")

            detected = chardet.detect(file_bytes[:65536])  # type: ignore[attr-defined]
            encoding = detected.get("encoding")
        except Exception:
            pass

    return ParsedFile(
        mime_type=parsed.mime_type,
        text_content=parsed.text_content,
        is_binary=parsed.is_binary,
        file_size_bytes=parsed.file_size_bytes,
        encoding=encoding,
        parse_error=parsed.parse_error,
    )
