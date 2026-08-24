"""What a notebook imports: ``from classifyre import Asset, ctx``.

This is the whole public surface a connector author sees. It stays small on
purpose -- the adapter in ``sources/custom`` is what turns an ``Asset`` into a
``SingleAssetScanResults``, computes hashes and checksums, resolves links and
validates metadata, so none of that leaks into the notebook.

``Ref`` and the four relationship builders are the other half of the surface.
``Asset.links`` still works and still means "these two are related somehow", but
*somehow* is the problem: an attachment, a foreign key and a derived table are
three different questions, and once they are in the same list nothing can tell
them apart. The builders make the author say which one they mean, and that is
the only place the distinction can come from.

``parse`` is the one addition that earns its place. Reading a PDF, a .docx, an
.eml or a Parquet file is not connector logic, every other source in the system
already delegates it to the same parser, and a notebook that had to reimplement
it would get it wrong. It arrives with the files it operates on: ``ctx.files``
for what was uploaded to the source, ``ctx.folder(...)`` for a folder on a
desktop machine.
"""

from __future__ import annotations

import sys
import types
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

from ..graph.edges import (
    Edge,
    FieldMapping,
    FlowType,
    Ref,
    contains,
    flow,
    references,
    same_as,
    uses,
)
from ..utils.urn import Urn
from .files import DEFAULT_PAGE_SIZE, ParsedContent, pages, parse

MODULE_NAME = "classifyre"

#: Canonical payload types, mirroring the output schema's AssetType. A notebook
#: sets this only when its content is not plain text.
CONTENT_TYPES = ("TXT", "TABLE", "IMAGE", "VIDEO", "AUDIO", "URL", "BINARY", "OTHER")

DEFAULT_KIND = "record"


@dataclass
class Asset:
    """One thing worth scanning.

    ``id`` is the only field that must be stable across runs: it is what ties
    this run's asset to the same asset in the last run, so findings, history and
    the scan cache line up. Everything else can change freely.
    """

    id: str
    name: str = ""
    url: str = ""
    content: str = ""
    kind: str = DEFAULT_KIND
    metadata: dict[str, Any] = field(default_factory=dict)
    links: list[str] = field(default_factory=list)
    #: Canonical payload type, which is what routes detectors. Left unset it
    #: is inferred -- from the MIME type for a file, otherwise text -- so an
    #: author never has to know this enum exists.
    content_type: str | None = None
    #: Raw bytes, for a connector that fetches files rather than text. Set this
    #: and the runtime parses them like any other file source: text extraction,
    #: file metadata, and the binary/image detectors all work.
    content_bytes: bytes | None = None
    #: Content type of ``content_bytes``. Detected from the bytes when omitted.
    mime_type: str | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None
    location: str | None = None
    #: What the *platform* calls this object -- ``snowflake://acct/db/schema/table``,
    #: ``s3://bucket/key``. Optional, and only worth setting for something that
    #: also exists in a system Classifyre scans separately: it is what lets that
    #: other source's lineage point here, and what lets your ``Ref.urn(...)``
    #: point there. Build one with ``urn_for(...)`` so the spelling matches.
    urn: str | None = None

    def __post_init__(self) -> None:
        self.id = str(self.id).strip()
        if not self.id:
            raise ValueError("Asset.id is required and must be a non-empty string")
        if not self.name:
            self.name = self.id
        self.kind = (self.kind or DEFAULT_KIND).strip().lower()
        if self.content_type is not None:
            # Only validate what was actually set: None means "infer it".
            self.content_type = str(self.content_type).strip().upper()
            if self.content_type not in CONTENT_TYPES:
                raise ValueError(
                    f"Asset.content_type must be one of {', '.join(CONTENT_TYPES)}, "
                    f"got {self.content_type!r}"
                )
        if self.metadata is None:
            self.metadata = {}
        if self.links is None:
            self.links = []
        if self.content_bytes is not None and not isinstance(self.content_bytes, bytes):
            raise TypeError(
                "Asset.content_bytes must be bytes (got "
                f"{type(self.content_bytes).__name__}); encode text first"
            )
        self.links = [str(link) for link in self.links if str(link).strip()]


def urn_for(platform: str, authority: str, *path: str) -> str:
    """The name another system would know this object by.

    ``urn_for("snowflake", "acme", "PROD", "PUBLIC", "ORDERS")``. The point of
    building it here rather than writing the string yourself is that the same
    folding rules apply as when the Snowflake connector names that table --
    capitalisation and default ports differ between tools, and a URN that
    differs by either never matches.

    ``authority`` is the account, host, workspace or bucket; the rest is the
    path within it.
    """
    return str(Urn.of(platform, authority, *path))


@dataclass(frozen=True)
class NotebookFile:
    """One file this source can read, already on local disk.

    The bytes are put there before any notebook code runs -- uploaded files are
    downloaded by the parent process, which is what keeps the notebook away from
    the API credentials that fetched them. By the time a notebook sees this, it
    is an ordinary path.
    """

    name: str
    path: Path
    size_bytes: int = 0
    mime_type: str | None = None

    def read_bytes(self) -> bytes:
        """Every byte, in memory. Prefer ``open()`` or ``pages()`` for a big file."""
        return self.path.read_bytes()

    def read_text(self, encoding: str = "utf-8") -> str:
        return self.path.read_text(encoding=encoding, errors="replace")

    def open(self) -> IO[bytes]:
        """A binary handle. The caller closes it."""
        return self.path.open("rb")

    def parse(self) -> ParsedContent:
        """Detect this file's type and extract its text."""
        return parse(self.path, name=self.name, mime_type=self.mime_type)

    def pages(self, page_size: int = DEFAULT_PAGE_SIZE) -> Iterable[str]:
        """Read this file a page at a time rather than whole."""
        return pages(self.path, name=self.name, mime_type=self.mime_type, page_size=page_size)


class Context:
    """The notebook's window onto its configuration and this run.

    Variables and secrets are reached through methods rather than injected as
    module globals so that a missing key fails with a message naming the key,
    and so secret access has one place to pass through.
    """

    def __init__(
        self,
        *,
        variables: Mapping[str, str] | None = None,
        secrets: Mapping[str, str] | None = None,
        sampling: Mapping[str, Any] | None = None,
        cursor: Mapping[str, Any] | None = None,
        offset: int = 0,
        files_dir: str | Path | None = None,
        folders: Mapping[str, str] | None = None,
        logger: Callable[[str], None] | None = None,
        should_abort: Callable[[], bool] | None = None,
    ) -> None:
        self._variables = dict(variables or {})
        self._secrets = dict(secrets or {})
        self._files_dir = Path(files_dir) if files_dir else None
        self._folders = {str(name): Path(path) for name, path in (folders or {}).items()}
        self._sampling = dict(sampling or {})
        self._cursor = dict(cursor or {})
        self._offset = int(offset or 0)
        self._offset_consumed = False
        self._next_cursor: dict[str, Any] | None = None
        self._logger = logger or print
        self._should_abort = should_abort or (lambda: False)

    # -- configuration -------------------------------------------------------

    def var(self, name: str, default: str | None = None) -> str:
        """A non-secret configured value."""
        if name in self._variables:
            return self._variables[name]
        if default is not None:
            return default
        raise KeyError(
            f"No variable named {name!r}. Configured variables: "
            f"{', '.join(sorted(self._variables)) or '(none)'}"
        )

    def secret(self, name: str, default: str | None = None) -> str:
        """A configured secret. Values are redacted from output and logs."""
        if name in self._secrets:
            return self._secrets[name]
        if default is not None:
            return default
        raise KeyError(
            f"No secret named {name!r}. Configured secrets: "
            f"{', '.join(sorted(self._secrets)) or '(none)'}"
        )

    def has_var(self, name: str) -> bool:
        return name in self._variables

    def has_secret(self, name: str) -> bool:
        return name in self._secrets

    @property
    def variables(self) -> dict[str, str]:
        return dict(self._variables)

    @property
    def secret_names(self) -> list[str]:
        """Names only. Listing values would defeat redaction."""
        return sorted(self._secrets)

    # -- files ---------------------------------------------------------------

    @property
    def files(self) -> list[NotebookFile]:
        """Files uploaded to this source, already downloaded and on local disk.

        Empty is a normal state, not an error -- a connector that talks to an API
        has no files. Order is by name, so a notebook that pairs files with each
        other gets the same pairing every run::

            for file in ctx.files:
                yield Asset(id=file.name, content=file.parse().text)
        """
        if self._files_dir is None or not self._files_dir.is_dir():
            return []
        entries = [entry for entry in self._files_dir.iterdir() if entry.is_file()]
        return [
            NotebookFile(name=entry.name, path=entry, size_bytes=entry.stat().st_size)
            for entry in sorted(entries, key=lambda entry: entry.name)
        ]

    def file(self, name: str) -> NotebookFile:
        """One uploaded file by name."""
        for candidate in self.files:
            if candidate.name == name:
                return candidate
        raise KeyError(
            f"No uploaded file named {name!r}. Files on this source: "
            f"{', '.join(entry.name for entry in self.files) or '(none)'}"
        )

    @property
    def folders(self) -> dict[str, Path]:
        """Folders this source was configured with, by name.

        The paths are resolved on whatever machine runs the scan: this computer
        on desktop, an ephemeral CLI job pod in Kubernetes. In a cluster the
        folder has to be mounted into those pods first (the chart's
        ``api.localFolders``); an unmounted path simply will not exist.
        """
        return dict(self._folders)

    def folder(self, name: str) -> Path:
        """One configured folder by name."""
        if name in self._folders:
            return self._folders[name]
        raise KeyError(
            f"No folder named {name!r}. Configured folders: "
            f"{', '.join(sorted(self._folders)) or '(none)'}"
        )

    # -- this run ------------------------------------------------------------

    @property
    def sampling(self) -> dict[str, Any]:
        """The run's sampling settings (strategy, rows_per_page, ...)."""
        return dict(self._sampling)

    @property
    def strategy(self) -> str:
        return str(self._sampling.get("strategy", "ALL")).upper()

    @property
    def page_size(self) -> int:
        try:
            return int(self._sampling.get("rows_per_page") or 100)
        except (TypeError, ValueError):
            return 100

    @property
    def limit(self) -> int | None:
        """How many assets this run wants, or None for "everything".

        Read it: a notebook that pushes the limit down to its own API -- a
        `LIMIT` clause, a `per_page`, a date filter -- samples at the source
        instead of yielding a million records for the runtime to throw away.
        """
        return None if self.strategy == "ALL" else self.page_size

    @property
    def offset(self) -> int:
        """How many assets this run should skip before the ones it wants.

        Non-zero only under AUTOMATIC, where successive runs walk further into
        the source. By default the runtime skips them for you -- which means
        your ``extract()`` still produces and discards them, and on a large
        source that is most of the work.

        **Reading this takes over that responsibility.** If you touch
        ``ctx.offset``, the runtime stops skipping and assumes you applied it
        yourself, so push it into your own query::

            def extract():
                for row in api.list(offset=ctx.offset, limit=ctx.limit):
                    yield Asset(...)

        Read it before you yield anything.
        """
        self._offset_consumed = True
        return self._offset

    @property
    def offset_consumed(self) -> bool:
        """Whether the notebook took responsibility for applying the offset."""
        return self._offset_consumed

    def set_offset(self, offset: int) -> None:
        """Set the run's skip position. Called by the runtime, not by a notebook."""
        self._offset = int(offset or 0)
        self._offset_consumed = False

    @property
    def cursor(self) -> dict[str, Any]:
        """What the previous run recorded. Empty on the first run."""
        return dict(self._cursor)

    def set_cursor(self, cursor: Mapping[str, Any]) -> None:
        """Record where this run got to, for the next run to resume from.

        Only meaningful under AUTOMATIC sampling; other strategies ignore it.
        """
        self._next_cursor = dict(cursor)

    @property
    def next_cursor(self) -> dict[str, Any] | None:
        return None if self._next_cursor is None else dict(self._next_cursor)

    @property
    def should_abort(self) -> bool:
        """True once the run has been asked to stop.

        Check it in long loops. Python cannot be interrupted from outside, so a
        loop that ignores this is stopped only by the execution timeout.
        """
        return bool(self._should_abort())

    def log(self, *parts: Any) -> None:
        self._logger(" ".join(str(part) for part in parts))

    @staticmethod
    def now() -> datetime:
        return datetime.now(UTC)


def build_module(context: Context) -> types.ModuleType:
    """The synthetic ``classifyre`` module the notebook imports."""
    module = types.ModuleType(MODULE_NAME)
    module.__doc__ = "Runtime helpers available to a Classifyre custom connector."
    module.Asset = Asset  # type: ignore[attr-defined]
    module.Ref = Ref  # type: ignore[attr-defined]
    module.FieldMapping = FieldMapping  # type: ignore[attr-defined]
    module.FlowType = FlowType  # type: ignore[attr-defined]
    module.flow = flow  # type: ignore[attr-defined]
    module.contains = contains  # type: ignore[attr-defined]
    module.references = references  # type: ignore[attr-defined]
    module.same_as = same_as  # type: ignore[attr-defined]
    module.uses = uses  # type: ignore[attr-defined]
    module.urn_for = urn_for  # type: ignore[attr-defined]
    module.Context = Context  # type: ignore[attr-defined]
    module.NotebookFile = NotebookFile  # type: ignore[attr-defined]
    module.ParsedContent = ParsedContent  # type: ignore[attr-defined]
    module.ctx = context  # type: ignore[attr-defined]
    module.parse = parse  # type: ignore[attr-defined]
    module.pages = pages  # type: ignore[attr-defined]
    module.__all__ = [  # type: ignore[attr-defined]
        "Asset",
        "Context",
        "FieldMapping",
        "FlowType",
        "NotebookFile",
        "ParsedContent",
        "Ref",
        "contains",
        "ctx",
        "flow",
        "pages",
        "parse",
        "references",
        "same_as",
        "urn_for",
        "uses",
    ]
    return module


def install(context: Context) -> types.ModuleType:
    """Register ``classifyre`` in ``sys.modules`` so the import statement works."""
    module = build_module(context)
    sys.modules[MODULE_NAME] = module
    return module


def namespace(context: Context) -> dict[str, Any]:
    """Globals for the assembled module.

    ``Asset``, ``ctx`` and ``parse`` are pre-bound as well as importable, so a
    notebook that forgets the import line still runs -- the import is
    documentation, not a hurdle.
    """
    install(context)
    return {
        "__name__": "classifyre_notebook",
        "__builtins__": __builtins__,
        "Asset": Asset,
        "Ref": Ref,
        "FieldMapping": FieldMapping,
        "FlowType": FlowType,
        "flow": flow,
        "contains": contains,
        "references": references,
        "same_as": same_as,
        "uses": uses,
        "urn_for": urn_for,
        "ctx": context,
        "parse": parse,
        "pages": pages,
    }


def iter_assets(value: Any) -> Iterable[Asset]:
    """Normalize whatever ``extract()`` returned into Assets.

    A generator, a list, or a single asset are all reasonable things to write,
    and a dict is what someone reaches for before finding ``Asset``.
    """
    if value is None:
        return
    if isinstance(value, Asset | dict):
        value = [value]
    for item in value:
        if isinstance(item, Asset):
            yield item
        elif isinstance(item, Mapping):
            yield Asset(**item)
        else:
            raise TypeError(
                "extract() must yield Asset objects (or dicts of Asset fields), "
                f"got {type(item).__name__}"
            )


def iter_relationships(value: Any) -> Iterable[Edge]:
    """Normalize whatever ``relationships()`` returned into Edges.

    Only the builders are accepted. A raw dict is *not*, deliberately: the whole
    value of this function is that the author had to choose between ``flow``,
    ``contains``, ``references`` and ``same_as``, and letting a dict through
    would put the class back into free text.
    """
    if value is None:
        return
    if isinstance(value, Edge):
        value = [value]
    for item in value:
        if isinstance(item, Edge):
            yield item
        else:
            raise TypeError(
                "relationships() must yield edges built with flow(), contains(), "
                "references(), same_as() or uses() -- got "
                f"{type(item).__name__}. These are not interchangeable: only "
                "flow() is lineage, and only it answers 'what breaks if this changes'."
            )
