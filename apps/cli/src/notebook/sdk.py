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
for what was uploaded to the source, ``ctx.folder(...)`` for a folder mounted
into the machine that runs the scan.
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
    ContainmentType,
    Edge,
    FieldMapping,
    FieldTransform,
    FlowType,
    Method,
    Ref,
    ReferenceType,
    UsageType,
    contains,
    flow,
    references,
    same_as,
    uses,
)
from ..utils.urn import Urn
from .cohort import CohortItem, normalize_bands, select_cohort
from .files import DEFAULT_PAGE_SIZE, ParsedContent, pages, parse

MODULE_NAME = "classifyre"

#: Canonical payload types, mirroring the output schema's AssetType. A notebook
#: sets this only when its content is not plain text.
CONTENT_TYPES = ("TXT", "TABLE", "IMAGE", "VIDEO", "AUDIO", "URL", "BINARY", "OTHER")

DEFAULT_KIND = "record"

#: Most severe first. A tag's severity is bounded by its detector's, so this is
#: also the order the bound is applied in.
TAG_SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO")


@dataclass(frozen=True)
class Tag:
    """A tag value that carries its own severity.

    ``tags={"insolvencies_yoy": "+34%"}`` gives every asset the Tag detector's
    own severity. That is right when the fact itself is the finding, and wrong
    when the *degree* is: an early-warning rule reading "HIGH at +30%, MEDIUM at
    +20%" needed two detectors with duplicated descriptions, and every inquiry
    and case had to name both keys (GENESIS field report P9). Written instead
    as::

        Asset(tags={"insolvencies_yoy": Tag("+34%", severity="HIGH")})

    one detector covers the rule and the finding carries the band.

    The detector's configured severity is the ceiling, never the default: a
    connector can say "this instance matters less than usual" but cannot
    promote its own findings past what the operator who created the detector
    allowed. A severity above the ceiling is lowered to it and reported as a
    scan warning rather than silently applied or dropped.
    """

    value: str
    severity: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", str(self.value).strip())
        raw = self.severity
        if raw is None:
            return
        normalized = str(raw).strip().upper()
        if normalized not in TAG_SEVERITIES:
            raise ValueError(
                f"Tag severity must be one of {', '.join(TAG_SEVERITIES)}, got {raw!r}"
            )
        object.__setattr__(self, "severity", normalized)


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
    #: Facts this connector already knows, keyed by the *key of a Tag detector*:
    #: ``tags={"cardholder_data": "primary-account-numbers"}``. Each entry becomes
    #: a finding on this asset with that detector's label and severity. Use it
    #: when the source system already has the answer and running a classifier
    #: over the content could only re-derive it less reliably. A key with no
    #: matching Tag detector is reported as a scan warning and skipped.
    #:
    #: A value may also be a :class:`Tag`, which carries a severity for that one
    #: assertion: ``tags={"insolvencies_yoy": Tag("+34%", severity="HIGH")}``.
    tags: dict[str, str] = field(default_factory=dict)
    #: Per-tag severity overrides, keyed exactly like ``tags``. Filled in from
    #: any :class:`Tag` values above rather than written directly, so ``tags``
    #: keeps its plain ``{key: value}`` shape for everything that already reads
    #: it. Bounded by each detector's own severity when the finding is built.
    tag_severities: dict[str, str] = field(default_factory=dict)
    #: ``False`` records the asset without extracting or scanning its content:
    #: ``Asset(id=..., metadata={...}, extract=False, reference_reason="...")``.
    #: Use it for an artefact whose existence and metadata matter but whose
    #: parsing would cost more than it is worth -- a 27-page filing that takes
    #: 17 minutes to convert. The asset is complete, searchable by metadata,
    #: takes part in lineage, and still gets its ``tags`` findings; it simply
    #: does not go through text extraction or the content detectors. Passing
    #: ``content_bytes`` too is allowed and fills in size, MIME type and page
    #: count, but the bytes are not kept.
    extract: bool = True
    #: Why this asset was recorded without extraction, shown on the asset and
    #: stored as ``metadata["content_reference"]``. Only with ``extract=False``.
    reference_reason: str | None = None
    #: The ``ctx.cohort()`` item this asset was produced for. Records which band
    #: chose it (``metadata["_cohort"]``), which is how the platform measures
    #: each band's yield. Never part of the asset's checksum.
    cohort: CohortItem | None = None

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
        self.tags, self.tag_severities = _normalize_tags(self.tags)
        if self.cohort is not None:
            if not isinstance(self.cohort, CohortItem):
                raise TypeError("Asset.cohort must be an item from ctx.cohort()")
            self.metadata = {
                **self.metadata,
                "_cohort": {
                    "name": self.cohort.cohort,
                    "band": self.cohort.band,
                    "key": self.cohort.key,
                },
            }
        if not isinstance(self.extract, bool):
            raise TypeError(f"Asset.extract must be True or False (got {self.extract!r})")
        reason = str(self.reference_reason).strip() if self.reference_reason is not None else ""
        self.reference_reason = reason or None
        if self.extract:
            if self.reference_reason is not None:
                raise ValueError("Asset.reference_reason only applies with extract=False")
        elif self.content:
            # Content that is never scanned would be silently dropped.
            raise ValueError(
                "Asset.content is not scanned when extract=False; put what you "
                "know about the asset in metadata, or leave extract=True"
            )


def _normalize_tags(value: Any) -> tuple[dict[str, str], dict[str, str]]:
    """Accept the two shapes an author reasonably writes, reject the rest.

    A dict is the ordinary case. A sequence of pairs is accepted because it is
    what someone reaches for to assert two values under one key, and silently
    keeping only the last one would be worse than supporting it.

    Returns the values and, separately, the severities any :class:`Tag` entries
    asked for. Splitting them keeps ``Asset.tags`` a plain ``{key: value}`` map
    for the adapter, the checksum and every reader that predates severities.
    """
    if not value:
        return {}, {}
    if isinstance(value, Mapping):
        items: Iterable[Any] = value.items()
    elif isinstance(value, str | bytes):
        raise TypeError(
            "Asset.tags must be a dict of {detector key: value}, e.g. "
            'tags={"cardholder_data": "primary-account-numbers"} -- got a string'
        )
    else:
        try:
            items = list(value)
        except TypeError:
            raise TypeError(
                f"Asset.tags must be a dict of {{detector key: value}} (got {type(value).__name__})"
            ) from None

    tags: dict[str, str] = {}
    severities: dict[str, str] = {}
    for item in items:
        if isinstance(item, Mapping):
            pair: Any = (item.get("key"), item.get("value"))
        else:
            pair = item
        try:
            key, tag_value = pair
        except (TypeError, ValueError):
            raise TypeError(
                f"Asset.tags entries must be (detector key, value) pairs; got {item!r}"
            ) from None
        key = str(key or "").strip()
        severity: str | None = None
        if isinstance(tag_value, Tag):
            severity = tag_value.severity
            tag_value = tag_value.value
        tag_value = str("" if tag_value is None else tag_value).strip()
        if not key or not tag_value:
            continue
        # Several values under one key are joined rather than dropped: two
        # assertions about the same asset are both true, and keeping the last
        # one silently would lose the other.
        existing = tags.get(key)
        tags[key] = f"{existing}, {tag_value}" if existing else tag_value
        if severity is None:
            continue
        # Joined values share one finding, so they share one severity: the most
        # severe of the two, because lowering it would understate a fact the
        # connector asserted.
        current = severities.get(key)
        if current is None or TAG_SEVERITIES.index(severity) < TAG_SEVERITIES.index(current):
            severities[key] = severity
    return tags, severities


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
class QueriedAsset:
    """An asset already in the namespace, as ``ctx.query_assets()`` returns it."""

    #: The platform's id for the asset.
    asset_hash: str
    #: The id the writing connector gave it (``Asset.id``), when it had one.
    external_id: str | None
    name: str
    kind: str
    url: str
    #: Only the keys you asked for with ``select``.
    metadata: dict[str, Any]


@dataclass(frozen=True)
class AssetQueryPage:
    """One page of ``ctx.query_assets()``. Pass ``next_cursor`` back for the next."""

    items: list[QueriedAsset]
    #: None once there is nothing more to read.
    next_cursor: str | None
    #: Queries this run has left; each call counts, whatever its size.
    calls_remaining: int


class AssetQueryError(RuntimeError):
    """``ctx.query_assets()`` was refused; the message says why and what to change."""


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
        query_assets: Callable[[dict[str, Any]], Any] | None = None,
        cohort_weights: Mapping[str, Mapping[str, float]] | None = None,
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
        self._partial_coverage: bool = False
        self._partial_coverage_reason: str = ""
        self._logger = logger or print
        self._should_abort = should_abort or (lambda: False)
        # Wired only for a scan: the runtime relays the call through the parent
        # process, which holds the credentials the notebook never sees.
        self._query_assets = query_assets
        # Band weights the platform measured for each named cohort, when the
        # source leaves the split to it. Absent: the notebook's declared bands.
        self._cohort_weights = {
            str(name): dict(weights) for name, weights in (cohort_weights or {}).items()
        }
        self._cohort_state: dict[str, Any] = {}
        self._cohort_stats: dict[str, Any] = {}

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

        The paths are resolved on whatever machine runs the scan: inside the
        all-in-one container, or an ephemeral CLI job pod in Kubernetes. Either
        way the folder has to be mounted there first (a bind mount, or the
        chart's ``api.localFolders``); an unmounted path simply will not exist.
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

        Honoured under every sampling strategy. It used to be kept only under
        AUTOMATIC, which meant a connector that wanted run-to-run state had to
        adopt a sampling strategy chosen for something else entirely -- and one
        that changes deletion semantics, since under AUTOMATIC an absent asset
        no longer implies a deleted one. Worse, the discard was silent: the call
        succeeded, the notebook believed it had saved state, and the next run
        started from nothing.
        """
        self._next_cursor = dict(cursor)

    @property
    def next_cursor(self) -> dict[str, Any] | None:
        if not self._cohort_state:
            return None if self._next_cursor is None else dict(self._next_cursor)
        # A cohort's position is kept in the same cursor, beside whatever the
        # notebook stores -- or, when it stores nothing this run, beside what
        # the previous run left, which would otherwise be dropped.
        base = self._next_cursor if self._next_cursor is not None else self._cursor
        stored = base.get("cohort")
        previous: dict[str, Any] = stored if isinstance(stored, dict) else {}
        return {**base, "cohort": {**previous, **self._cohort_state}}

    @property
    def cohort_stats(self) -> dict[str, Any]:
        """Per cohort, per band: keys visited this run and whether the band ran out."""
        return {name: dict(stats) for name, stats in self._cohort_stats.items()}

    def cohort(
        self,
        name: str,
        universe: Iterable[Any],
        *,
        bands: Mapping[str, float] | None = None,
        size: int,
        min_share: float | None = None,
    ) -> list[CohortItem]:
        """This run's slice of a large ordered universe, resumable across runs.

        ::

            for item in ctx.cohort("register", all_company_numbers,
                                   bands={"newest": 60, "oldest": 30, "random": 10},
                                   size=1200):
                yield Asset(id=item.key, ..., cohort=item)

        ``universe`` is every key the connector could visit; it is sorted, so
        ``newest`` means the end of that order. ``newest`` walks down from it,
        ``oldest`` walks up from the start, ``random`` samples the whole
        universe with no cursor. Each directional band resumes after the last
        key it visited, so a universe republished at a different length keeps
        its place, and wraps once it reaches the end.

        ``bands`` is your split. When the source's cohort weights are set to
        ``auto``, the platform replaces it with a split measured from what each
        band actually yielded, never giving a band less than ``min_share`` (and
        never less than 10%). Pass ``cohort=item`` to each Asset so that
        measurement has something to count.

        Calling it declares this run's coverage partial.
        """
        declared = normalize_bands(bands)
        weights = declared
        measured = self._cohort_weights.get(str(name))
        if measured:
            try:
                weights = normalize_bands(
                    {band: measured[band] for band in measured if band in declared}
                )
            except ValueError:
                weights = declared
        if min_share is not None and not 0 <= float(min_share) < 1:
            raise ValueError("min_share is a fraction between 0 and 1")

        previous = self._cursor.get("cohort")
        state = previous.get(str(name)) if isinstance(previous, dict) else None
        items, next_state, stats = select_cohort(
            str(name), universe, weights=weights, size=int(size), state=state
        )
        self._cohort_state[str(name)] = next_state
        self._cohort_stats[str(name)] = {
            "bands": stats,
            "weightsUsed": weights,
            "declared": declared,
            "minShare": min_share,
            "universeSize": next_state.get("universe_size", 0),
        }
        if not self._partial_coverage:
            self.set_partial_coverage(f"the notebook walks a cohort ({name}) of a larger universe")
        return items

    def set_partial_coverage(self, reason: str = "") -> None:
        """Declare that this run looked at only part of the source.

        Call it from any connector that chooses its own cohort -- a change
        feed, a resumable sweep, a date window, an API with no "list
        everything" operation. Absence from this run then proves nothing and
        no asset is retired.

        The sampling strategy cannot say this on a connector's behalf: it
        describes what the runtime does with the stream you yield, not how much
        of the source you decided to ask for. A cohort connector under
        strategy=ALL is telling the platform it visited everything, and the
        platform believes it -- every asset outside this run's cohort is marked
        DELETED and its findings auto-resolved. On the Firmenbuch corpus that
        was 51,860 assets and 208,639 findings, none of them actually gone.

        Idempotent, and safe to call before you know how much you covered.
        """
        self._partial_coverage = True
        if reason:
            self._partial_coverage_reason = str(reason)

    @property
    def partial_coverage(self) -> bool:
        return self._partial_coverage

    @property
    def partial_coverage_reason(self) -> str:
        return self._partial_coverage_reason

    def query_assets(
        self,
        source: str,
        *,
        kind: str | None = None,
        where: Mapping[str, Mapping[str, Any]] | None = None,
        exclude_visited: Mapping[str, Any] | None = None,
        select: Iterable[str] = (),
        limit: int = 1000,
        cursor: str | None = None,
        cohort: bool = True,
    ) -> AssetQueryPage:
        """Read assets another source in this namespace already wrote.

        Work the queue of things already known to be interesting instead of
        sweeping an external universe::

            page = ctx.query_assets(
                "Firmenbuch Register",
                kind="record",
                where={"filing_count": {"gt": 0},
                       "legal_form_code": {"in": ["GES", "AG", "SE", "FKG"]}},
                exclude_visited={"key": "firmenbuchnummer", "since_days": 90},
                select=["firmenbuchnummer", "legal_form_code"],
                limit=1200,
            )
            for company in page.items:
                fn = company.metadata["firmenbuchnummer"]

        ``source`` is a source's id or exact name. ``where`` filters metadata
        with ``eq``, ``in``, ``exists``, ``gt``, ``gte``, ``lt`` and ``lte``;
        values compare as JSON, so ``{"eq": 5}`` matches the number 5 and not
        the string "5". ``exclude_visited`` leaves out every asset whose
        ``metadata[key]`` matches an asset *this* source scanned in the last
        ``since_days``. Page with ``cursor=page.next_cursor``.

        Read-only, and bounded: at most 5,000 assets a page and 100 calls a run.
        Calling it declares this run's coverage partial, since a connector that
        picks its cohort from a query never sees the rest of its source.
        Available during scans only, not when running a cell in the editor.

        Pass ``cohort=False`` when the query only supplies *inputs* and this run
        still yields its whole universe -- e.g. Land aggregates computed from
        every district profile. Coverage then stays complete, so an asset the
        notebook stops yielding is retired. Without it such a source could never
        retire anything (GENESIS field report P5). Fail the run rather than
        yield a partial universe if the input is incomplete.
        """
        if self._query_assets is None:
            raise AssetQueryError(
                "ctx.query_assets() is available during scans only; running a "
                "cell in the editor has no scan to read the namespace for"
            )
        payload: dict[str, Any] = {"source": str(source), "limit": int(limit)}
        if kind is not None:
            payload["kind"] = str(kind)
        if where:
            if not isinstance(where, Mapping):
                raise AssetQueryError(
                    "ctx.query_assets() where must be a mapping like "
                    '{"legal_form_code": {"in": ["GES", "AG"]}}, '
                    f"got {type(where).__name__}"
                )
            shaped: dict[str, dict[str, Any]] = {}
            for key, condition in where.items():
                if not isinstance(condition, Mapping):
                    raise AssetQueryError(
                        f"ctx.query_assets() where[{str(key)!r}] must be a mapping of "
                        f"operator to value, like {{'eq': 5}}, got {condition!r}"
                    )
                shaped[str(key)] = dict(condition)
            payload["where"] = shaped
        if exclude_visited:
            visited = dict(exclude_visited)
            payload["excludeVisited"] = {
                "key": visited.get("key"),
                "sinceDays": visited.get("since_days", visited.get("sinceDays")),
            }
        if isinstance(select, (str, bytes)):
            raise AssetQueryError(
                "ctx.query_assets() select must be a list of metadata keys, "
                f"not a single string: did you mean select={[select]!r}?"
            )
        selected = [str(key) for key in select]
        if selected:
            payload["select"] = selected
        if cursor is not None:
            payload["cursor"] = str(cursor)

        response = self._query_assets(payload) or {}
        if cohort and not self._partial_coverage:
            # Only on success: a refused query read nothing, so the run still
            # covers what it covers. Never over the notebook's own reason.
            self.set_partial_coverage("the notebook chose its cohort with ctx.query_assets()")
        return AssetQueryPage(
            items=[
                QueriedAsset(
                    asset_hash=str(item.get("assetHash") or ""),
                    external_id=item.get("externalId"),
                    name=str(item.get("name") or ""),
                    kind=str(item.get("kind") or ""),
                    url=str(item.get("url") or ""),
                    metadata=dict(item.get("metadata") or {}),
                )
                for item in response.get("items") or []
            ],
            next_cursor=response.get("nextCursor"),
            calls_remaining=int(response.get("callsRemaining") or 0),
        )

    @property
    def should_abort(self) -> bool:
        """True once the run has been asked to stop.

        Check it in long loops. Python cannot be interrupted from outside, so a
        loop that ignores this is stopped only by the execution timeout.
        """
        return bool(self._should_abort())

    def log(self, *parts: Any, level: str | None = None) -> None:
        """Write a line to the run log. ``level`` ("warning", "error", …) sets its level there."""
        message = " ".join(str(part) for part in parts)
        if level:
            message = f"{level.strip().upper()}: {message}"
        self._logger(message)

    @staticmethod
    def now() -> datetime:
        return datetime.now(UTC)


def build_module(context: Context) -> types.ModuleType:
    """The synthetic ``classifyre`` module the notebook imports."""
    module = types.ModuleType(MODULE_NAME)
    module.__doc__ = "Runtime helpers available to a Classifyre custom connector."
    module.Asset = Asset  # type: ignore[attr-defined]
    # A tag value that carries its own severity, so one detector can cover a
    # banded rule instead of one detector per band (field report P9).
    module.Tag = Tag  # type: ignore[attr-defined]
    module.Ref = Ref  # type: ignore[attr-defined]
    module.FieldMapping = FieldMapping  # type: ignore[attr-defined]
    module.FlowType = FlowType  # type: ignore[attr-defined]
    # The enums the edge builders take. A string worked only because they are
    # StrEnums; a typo in one failed at ingest, not at import (field report P11).
    module.Method = Method  # type: ignore[attr-defined]
    module.ReferenceType = ReferenceType  # type: ignore[attr-defined]
    module.ContainmentType = ContainmentType  # type: ignore[attr-defined]
    module.FieldTransform = FieldTransform  # type: ignore[attr-defined]
    module.UsageType = UsageType  # type: ignore[attr-defined]
    module.flow = flow  # type: ignore[attr-defined]
    module.contains = contains  # type: ignore[attr-defined]
    module.references = references  # type: ignore[attr-defined]
    module.same_as = same_as  # type: ignore[attr-defined]
    module.uses = uses  # type: ignore[attr-defined]
    module.urn_for = urn_for  # type: ignore[attr-defined]
    module.Context = Context  # type: ignore[attr-defined]
    module.NotebookFile = NotebookFile  # type: ignore[attr-defined]
    module.QueriedAsset = QueriedAsset  # type: ignore[attr-defined]
    module.CohortItem = CohortItem  # type: ignore[attr-defined]
    module.AssetQueryPage = AssetQueryPage  # type: ignore[attr-defined]
    module.AssetQueryError = AssetQueryError  # type: ignore[attr-defined]
    module.ParsedContent = ParsedContent  # type: ignore[attr-defined]
    module.ctx = context  # type: ignore[attr-defined]
    module.parse = parse  # type: ignore[attr-defined]
    module.pages = pages  # type: ignore[attr-defined]
    module.__all__ = [  # type: ignore[attr-defined]
        "Asset",
        "Context",
        "ContainmentType",
        "FieldMapping",
        "FieldTransform",
        "FlowType",
        "Method",
        "NotebookFile",
        "ParsedContent",
        "Ref",
        "ReferenceType",
        "Tag",
        "UsageType",
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
        "Tag": Tag,
        "Ref": Ref,
        "FieldMapping": FieldMapping,
        "FlowType": FlowType,
        "Method": Method,
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
