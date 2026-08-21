"""Reading and parsing files from a notebook.

A connector that fetches files should not have to know how to read a PDF, an
.eml, a .docx or a Parquet file -- every other source in this system delegates
that to ``src/utils/file_parser.py``, and a notebook has more reason to than
most. So the parser is exposed rather than reimplemented: ``parse()`` is a thin
adapter over ``file_parser.parse_file`` / ``parse_bytes``, and ``pages()`` over
its streaming path.

Two deliberate choices:

* The result is a small ``ParsedContent`` of our own rather than the parser's
  ``ParsedFile`` / ``ParsedBytes``. Those two differ (``encoding`` on one,
  ``raw_content`` on the other) and are internal shapes free to change; a
  notebook that is someone's saved work should not break when they do.
* ``file_parser`` is imported inside the functions. Importing it pulls the
  ``file-processing`` group in at first use, and a notebook that never touches a
  file should never pay for that.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # the parser and its heavy dependencies stay a runtime import
    from ..utils.file_parser import ParsedBytes, ParsedFile

logger = logging.getLogger(__name__)

#: Text pages are read in this many lines, tabular payloads in this many rows.
DEFAULT_PAGE_SIZE = 100


@dataclass
class ParsedContent:
    """What one file turned out to be.

    ``error`` is populated rather than raised: a corrupt attachment in the
    middle of a long scan should cost that one asset, not the run.
    """

    #: Detected content type, e.g. ``application/pdf``.
    mime_type: str
    #: Extracted text, ready to hand to ``Asset(content=...)``. Empty when the
    #: payload has no text in it, or when ``error`` is set.
    text: str
    #: Whether the payload is binary rather than plain text.
    is_binary: bool
    size_bytes: int
    #: Why extraction produced nothing, when it did not. ``None`` on success.
    error: str | None = None

    def __bool__(self) -> bool:
        return self.error is None


def local_folders(recipe: dict[str, Any]) -> dict[str, str]:
    """The desktop-only folders a source declared, as ``{name: path}``.

    Read straight from the recipe rather than handed over separately: unlike an
    uploaded file there is nothing to fetch, only a path the notebook may open.
    Both the scan runner and the authoring CLI read it here so that ``ctx.folder``
    means the same thing in the editor and in a real run.
    """
    optional = recipe.get("optional") if isinstance(recipe, dict) else None
    declared = optional.get("local_folders") if isinstance(optional, dict) else None
    if not isinstance(declared, list):
        return {}
    folders: dict[str, str] = {}
    for entry in declared:
        if isinstance(entry, dict) and entry.get("name") and entry.get("path"):
            folders[str(entry["name"])] = str(entry["path"])
    return folders


def _as_source(source: Any) -> Any:
    """Unwrap the things a notebook is likely to pass.

    ``ctx.file(...)`` hands back a ``NotebookFile``; accepting it directly saves
    every caller from writing ``.path``.
    """
    path = getattr(source, "path", None)
    return path if isinstance(path, Path) else source


def _name_of(source: Any, name: str) -> str:
    if name:
        return name
    if isinstance(source, str | Path):
        return Path(source).name
    return str(getattr(source, "name", "") or "")


def parse(source: Any, *, name: str = "", mime_type: str | None = None) -> ParsedContent:
    """Detect a payload's type and extract its text.

    Accepts a path, raw bytes, an open binary file, or a ``NotebookFile`` from
    ``ctx.files``. ``mime_type`` is a hint: it is trusted over sniffing when the
    caller already knows, which matters for a payload downloaded from an API
    that declared one.

        for file in ctx.files:
            parsed = parse(file)
            yield Asset(id=file.name, content=parsed.text, content_bytes=file.read_bytes())
    """
    from ..utils.file_parser import TextExtractionCoverageError, parse_bytes, parse_file

    resolved = _as_source(source)
    file_name = _name_of(resolved, name)

    # `ParsedFile` and `ParsedBytes` are separate shapes that happen to share
    # the four fields below; the union is what lets both land on ParsedContent.
    result: ParsedFile | ParsedBytes
    try:
        if isinstance(resolved, str | Path):
            result = parse_file(Path(resolved))
        else:
            result = parse_bytes(resolved, declared_mime_type=mime_type, file_name=file_name)
    except (OSError, TextExtractionCoverageError, ValueError) as exc:
        logger.warning("Could not parse %s: %s", file_name or "payload", exc)
        return ParsedContent(
            mime_type=mime_type or "application/octet-stream",
            text="",
            is_binary=True,
            size_bytes=0,
            error=str(exc),
        )

    return ParsedContent(
        mime_type=result.mime_type,
        text=result.text_content or "",
        is_binary=bool(result.is_binary),
        size_bytes=int(result.file_size_bytes or 0),
        error=result.parse_error,
    )


def pages(
    source: Any,
    *,
    name: str = "",
    mime_type: str | None = None,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> Iterator[str]:
    """Read a payload in pages instead of all at once.

    For a Parquet file or a large CSV, ``parse()`` materialises the whole thing
    as one string. This yields rows (tabular) or lines (everything else) a page
    at a time, so a multi-gigabyte dump can become many assets without ever
    being held whole.

        for index, page in enumerate(pages(ctx.file("dump.parquet"))):
            yield Asset(id=f"dump-{index}", content=page, kind="table")
    """
    from ..utils.file_parser import iter_file_pages, resolve_mime_type

    resolved = _as_source(source)
    file_name = _name_of(resolved, name)

    handle = None
    try:
        if isinstance(resolved, str | Path):
            handle = Path(resolved).open("rb")
            payload: Any = handle
        else:
            payload = resolved

        resolved_mime = resolve_mime_type(
            payload, declared_mime_type=mime_type, file_name=file_name
        )
        yield from iter_file_pages(
            payload, resolved_mime, batch_size=page_size, file_name=file_name
        )
    finally:
        if handle is not None:
            handle.close()
