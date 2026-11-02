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

import re
import sys
import types
from collections.abc import Callable, Iterable, Iterator, Mapping
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
    means,
    references,
    same_as,
    uses,
)
from ..utils.sampling_cursor import check_cursor_fits
from ..utils.sampling_frontier import ListFrontier
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


#: What kind of named thing an entity is. Decides which finding labels its name
#: is matched under: a PERSON is found among person names, never among
#: organisations.
ENTITY_TYPES = ("PERSON", "ORGANIZATION", "LOCATION", "REFERENCE", "OTHER")

#: The asset-metadata key a declared entity travels under.
ENTITY_METADATA_KEY = "_entity"


@dataclass(frozen=True)
class Entity:
    """The named thing a record *is*: a company, a person, an account.

    A register or a customer master does not merely mention ACME Holding GmbH --
    its record is ACME. Saying so::

        Asset(
            id=fn,
            urn=urn_for("firmenbuch", fn),
            entity=Entity(
                type="ORGANIZATION",
                name="ACME Holding GmbH",
                identifiers={"vat": "ATU12345678", "fn": "123456a"},
                aliases=["ACME Holding"],
            ),
        )

    creates the entity in the glossary (or updates it), anchored to this
    record, and from then on every document in every other source that carries
    that name or one of those identifiers is a mention of it -- the e-mail that
    quotes the VAT number, the contract that names the company.

    ``identifiers`` are keyed by the *label a detector finds them under*
    (``iban``, ``email``, a custom detector's label): that label is what links
    a finding to the entity, so an identifier under a label nothing detects
    links nothing. ``key`` pins the glossary key, for a source that already
    refers to the entity with ``Ref.term(key)``.

    The asset needs a ``urn`` (or the entity a ``key``): it is what makes the
    declaration the same entity on the next scan instead of a new one. A
    declared entity is the register's word and is approved from the start; what
    an operator changes afterwards is kept -- a later scan only adds.
    """

    name: str
    type: str = "OTHER"
    key: str | None = None
    identifiers: Mapping[str, str] = field(default_factory=dict)
    aliases: tuple[str, ...] | list[str] = field(default_factory=tuple)
    attributes: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        name = str(self.name or "").strip()
        if not name:
            raise ValueError("Entity.name is required and must be a non-empty string")
        object.__setattr__(self, "name", name)
        kind = str(self.type or "OTHER").strip().upper()
        if kind not in ENTITY_TYPES:
            raise ValueError(
                f"Entity.type must be one of {', '.join(ENTITY_TYPES)}, got {self.type!r}"
            )
        object.__setattr__(self, "type", kind)
        key = str(self.key).strip().lower() if self.key is not None else ""
        object.__setattr__(self, "key", key or None)
        if not isinstance(self.identifiers, Mapping):
            raise TypeError(
                'Entity.identifiers must map a label to a value, e.g. {"vat": "ATU12345678"}'
            )
        object.__setattr__(
            self,
            "identifiers",
            {
                str(label).strip(): str(value).strip()
                for label, value in self.identifiers.items()
                if str(label).strip() and value is not None and str(value).strip()
            },
        )
        if isinstance(self.aliases, str | bytes):
            raise TypeError("Entity.aliases must be a list of names, not a single string")
        object.__setattr__(
            self,
            "aliases",
            tuple(
                dict.fromkeys(str(alias).strip() for alias in self.aliases if str(alias).strip())
            ),
        )
        if not isinstance(self.attributes, Mapping):
            raise TypeError("Entity.attributes must be a mapping")
        object.__setattr__(self, "attributes", dict(self.attributes))

    def to_metadata(self) -> dict[str, Any]:
        """The declaration as it travels on the asset. Empty parts are left out,
        so adding a field here never changes the checksum of an asset that does
        not use it."""
        payload: dict[str, Any] = {"name": self.name, "type": self.type}
        if self.key:
            payload["key"] = self.key
        if self.identifiers:
            payload["identifiers"] = dict(sorted(self.identifiers.items()))
        if self.aliases:
            payload["aliases"] = list(self.aliases)
        if self.attributes:
            payload["attributes"] = dict(self.attributes)
        return payload


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
    #: The named thing this record *is* -- see :class:`Entity`. Recorded as
    #: ``metadata["_entity"]``, so it is part of the checksum only for assets
    #: that declare one. Needs ``urn`` (or ``Entity.key``).
    entity: Entity | None = None

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
        if self.entity is not None:
            if not isinstance(self.entity, Entity):
                raise TypeError("Asset.entity must be an Entity(...)")
            if not (self.urn and str(self.urn).strip()) and not self.entity.key:
                # Without either, the next scan could not tell this is the same
                # entity and would create it again.
                raise ValueError(
                    "Asset.entity needs Asset.urn (build one with urn_for(...)) or "
                    "Entity.key, so the next scan updates the same entity"
                )
            self.metadata = {**self.metadata, ENTITY_METADATA_KEY: self.entity.to_metadata()}
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
class AssetFinding:
    """One open finding of a queried asset (``include=("findings",)``)."""

    id: str
    detector_type: str
    #: The custom detector's key, for CUSTOM findings (a Tag detector's tags too).
    detector: str | None
    finding_type: str
    severity: str
    status: str
    #: The source whose notebook asserted it (``ctx.tag()``); None for a detector's.
    asserted_by_source_id: str | None


@dataclass(frozen=True)
class QueriedAsset:
    """An asset already in the namespace, as ``ctx.query_assets()`` returns it."""

    #: The platform's id for the asset: what ``ctx.tag()`` and ``ctx.link()`` take.
    id: str
    #: The asset's hash, unique within its source only.
    asset_hash: str
    #: The asset's URN, when its connector gave it one.
    urn: str | None
    #: The source the asset belongs to.
    source_id: str
    source_name: str
    #: The id the writing connector gave it (``Asset.id``), when it had one.
    external_id: str | None
    name: str
    kind: str
    url: str
    #: Only the keys you asked for with ``select``.
    metadata: dict[str, Any]
    #: Its first open findings, when asked for with ``include=("findings",)``.
    findings: list[AssetFinding] = field(default_factory=list)


@dataclass(frozen=True)
class AssetQueryPage:
    """One page of ``ctx.query_assets()``. Pass ``next_cursor`` back for the next."""

    items: list[QueriedAsset]
    #: None once there is nothing more to read.
    next_cursor: str | None


class AssetQueryError(RuntimeError):
    """A ``ctx.query_*()`` read was refused; the message says why and what to change."""


class AugmentationError(RuntimeError):
    """A ``ctx.tag()`` / ``ctx.link()`` write was refused; the message says why."""


@dataclass(frozen=True)
class QueriedSource:
    """A source of the namespace, as ``ctx.query_sources()`` returns it.

    Deliberately without configuration: a notebook never reads another
    source's credentials, variables or code.
    """

    id: str
    name: str
    type: str
    description: str | None
    #: Status of its latest run, None when it never ran.
    run_status: str | None
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class SourcePage:
    items: list[QueriedSource]
    next_cursor: str | None


@dataclass(frozen=True)
class QueriedFinding:
    """A finding, as ``ctx.query_findings()`` returns it."""

    id: str
    asset_id: str
    source_id: str
    detector_type: str
    #: The custom detector's key, for CUSTOM findings.
    detector: str | None
    detector_name: str | None
    finding_type: str
    category: str
    severity: str
    status: str
    confidence: float
    #: Redacted where the detector redacts; never the raw match.
    content: str | None
    metadata: dict[str, Any]
    asserted_by_source_id: str | None
    first_detected_at: str | None
    last_detected_at: str | None


@dataclass(frozen=True)
class FindingPage:
    items: list[QueriedFinding]
    next_cursor: str | None


@dataclass(frozen=True)
class QueriedDetector:
    """A custom detector, as ``ctx.query_detectors()`` returns it (no pipeline)."""

    id: str
    key: str
    name: str
    description: str | None
    #: TAG, REGEX, GLINER2, LLM, CODE_DETECTOR, ...
    type: str
    is_active: bool
    version: int


@dataclass(frozen=True)
class DetectorPage:
    items: list[QueriedDetector]
    next_cursor: str | None


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
        relay: Callable[[str, dict[str, Any]], Any] | None = None,
        cohort_weights: Mapping[str, Mapping[str, float]] | None = None,
        config_changed: bool = False,
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
        # Wired only for a scan: the runtime relays reads and writes through
        # the parent process, which holds the credentials the notebook never
        # sees. ``relay(op, payload)`` returns the API's answer or raises.
        self._relay = relay
        # Which entry point is running; reads default their cohort by it.
        self._phase = "extract"
        self._tags: dict[tuple[str, str], dict[str, Any]] = {}
        self._edges: list[dict[str, Any]] = []
        self._augmentation_stats = {"tags": 0, "edges": 0, "skipped": 0}
        # Band weights the platform measured for each named cohort, when the
        # source leaves the split to it. Absent: the notebook's declared bands.
        self._cohort_weights = {
            str(name): dict(weights) for name, weights in (cohort_weights or {}).items()
        }
        self._cohort_state: dict[str, Any] = {}
        self._cohort_stats: dict[str, Any] = {}
        self._config_changed = bool(config_changed)
        self._frontier_state: dict[str, Any] = {}

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

        Raises ``ValueError`` for a cursor too large to start the next run with
        (128 KiB compressed). Keep a cursor to positions and counters; state
        that grows with the corpus belongs in assets, read back with
        ``ctx.query_assets()``.
        """
        check_cursor_fits(cursor)
        self._next_cursor = dict(cursor)

    @property
    def config_changed(self) -> bool:
        """True on the first run after this source's settings changed, and on a
        run started as a full rescan.

        "Settings" is anything in the source's configuration -- scope,
        sampling, variables, the notebook itself, which detectors are on --
        and the definition of any custom detector it uses. Rotating a secret
        does not count. A full rescan asks for the whole sweep again with the
        same settings, so it sets the flag as well.

        A built-in source starts its sweep over when that happens. A notebook
        owns its own cursor, so nothing is taken from it; it is told instead,
        and decides::

            cursor = {} if ctx.config_changed else ctx.cursor

        The flag stays set until a run finishes, so a run that fails before
        acting on it does not lose it. ``ctx.newest_first()`` acts on it for
        you.
        """
        return self._config_changed

    def newest_first(
        self,
        items: Iterable[Any],
        *,
        order: Callable[[Any], tuple[Any, str]],
        name: str = "items",
        limit: int | None = None,
    ) -> list[Any]:
        """This run's slice of a listing: what is new first, then the backfill.

        ::

            def extract():
                for doc in ctx.newest_first(
                    api.list_documents(),
                    order=lambda doc: (doc["updated_at"], doc["id"]),
                ):
                    yield Asset(id=doc["id"], ...)

        Pass the whole listing, in any order. ``order`` maps an item to
        ``(rank, id)``: ``rank`` is what makes an item newer -- a timestamp, an
        increasing number -- and must be an int, float or string of one
        consistent type that only changes when the item does; ``id`` is unique
        to the item. Each run gets ``limit`` items -- by default ``ctx.limit``:
        the whole listing under the ALL strategy, ``rows_per_page`` otherwise.
        Everything newer than what earlier runs read comes first, the rest
        continues backwards from where the last run stopped, and once the whole
        listing has been read only new items are returned.

        The position is kept in the cursor beside whatever you store there,
        one per ``name``, and starts over when ``ctx.config_changed``. Calling
        it declares this run's coverage partial.
        """
        stored = self._cursor.get("frontier")
        previous = stored.get(str(name)) if isinstance(stored, dict) else None
        frontier = ListFrontier(None if self._config_changed else previous)
        entries = [(*order(item), item) for item in items]
        # Without a limit of its own the run takes what the source's sampling
        # asks for: everything under ALL, ``rows_per_page`` otherwise.
        budget = int(limit) if limit else (self.limit if self.limit is not None else len(entries))
        window = frontier.window(entries, budget)
        state = frontier.to_state()
        if state is not None:
            self._frontier_state[str(name)] = state
        if not self._partial_coverage:
            self.set_partial_coverage(
                f"the notebook reads a window ({name}) of a larger listing each run"
            )
        return window

    @property
    def next_cursor(self) -> dict[str, Any] | None:
        if not self._cohort_state and not self._frontier_state:
            return None if self._next_cursor is None else dict(self._next_cursor)
        # A cohort's or a frontier's position is kept in the same cursor,
        # beside whatever the notebook stores -- or, when it stores nothing
        # this run, beside what the previous run left, which would otherwise
        # be dropped.
        base = self._next_cursor if self._next_cursor is not None else self._cursor
        merged = dict(base)
        for section, state in (
            ("cohort", self._cohort_state),
            ("frontier", self._frontier_state),
        ):
            if not state:
                continue
            stored = base.get(section)
            previous: dict[str, Any] = stored if isinstance(stored, dict) else {}
            if section == "frontier" and self._config_changed:
                previous = {}
            merged[section] = {**previous, **state}
        return merged

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

    # -- reading the rest of the namespace -----------------------------------

    def _declare_cohort(self, name: str, cohort: bool | None) -> None:
        """Mark coverage partial after a successful read, unless this read owns no cohort.

        Only on success: a refused read saw nothing, so the run still covers what
        it covers. Never over the notebook's own reason. In ``augment_sources()``
        the default is no cohort: an augmentation owns no assets to retire.
        """
        owns_cohort = self._phase != "augment" if cohort is None else bool(cohort)
        if owns_cohort and not self._partial_coverage:
            self.set_partial_coverage(f"the notebook chose its cohort with ctx.{name}()")

    def _call(self, name: str, op: str, payload: dict[str, Any], error: type[Exception]) -> Any:
        if self._relay is None:
            raise error(
                f"ctx.{name}() is available during scans only; running a cell in the "
                "editor has no scan to read the namespace for"
            )
        return self._relay(op, payload) or {}

    def query_assets(
        self,
        source: str | None = None,
        *,
        kind: str | None = None,
        where: Mapping[str, Mapping[str, Any]] | None = None,
        exclude_visited: Mapping[str, Any] | None = None,
        search: str | None = None,
        status: Iterable[str] | None = None,
        term: str | Iterable[str] | None = None,
        include_narrower: bool = False,
        findings: Mapping[str, Any] | None = None,
        semantic: str | None = None,
        semantic_mode: str = "hybrid",
        include: Iterable[str] = (),
        select: Iterable[str] = (),
        limit: int = 1000,
        cursor: str | None = None,
        cohort: bool | None = None,
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

        ``source`` is a source's id or exact name; leave it out to read every
        source in the namespace. Filters combine (all must hold):

        - ``where`` filters metadata with ``eq``, ``in``, ``exists``, ``gt``,
          ``gte``, ``lt`` and ``lte``; values compare as JSON, so
          ``{"eq": 5}`` matches the number 5 and not the string "5".
        - ``exclude_visited`` leaves out every asset whose ``metadata[key]``
          matches an asset *this* source scanned in the last ``since_days``.
        - ``search`` matches the name, case-insensitively; ``semantic`` ranks
          by meaning (``semantic_mode`` is "hybrid" or "vector"), best first,
          over at most 200 assets.
        - ``term`` keeps assets currently linked to glossary term keys (with
          ``include_narrower``, to their narrower terms too).
        - ``findings`` keeps assets that have findings matching, e.g.
          ``{"detector": "pii-email", "severity": ["HIGH", "CRITICAL"]}``;
          see :meth:`query_findings` for the keys. Open findings unless
          ``status`` is given there.
        - ``include=("findings",)`` returns each asset's first open findings.

        Always paged: at most 5,000 assets a page, as many pages as you need;
        ``cursor=page.next_cursor`` continues the *same* query. Read-only.
        Available during scans only, not when running a cell in the editor.

        Calling it from ``extract()`` declares this run's coverage partial,
        since a connector that picks its cohort from a query never sees the
        rest of its source. Pass ``cohort=False`` when the query only supplies
        *inputs* and this run still yields its whole universe -- e.g. Land
        aggregates computed from every district profile. Coverage then stays
        complete, so an asset the notebook stops yielding is retired. Inside
        ``augment_sources()`` the default is ``cohort=False``: an augmentation
        owns no cohort. Fail the run rather than yield a partial universe if
        the input is incomplete.
        """
        payload: dict[str, Any] = {"limit": int(limit)}
        if source is not None:
            payload["source"] = str(source)
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
        if search is not None:
            payload["search"] = str(search)
        if status is not None:
            payload["status"] = _strings(status)
        if term is not None:
            payload["term"] = {
                "keys": _strings(term),
                "includeNarrower": bool(include_narrower),
            }
        if findings:
            payload["findings"] = _finding_filter("query_assets", findings)
        if semantic is not None:
            payload["semantic"] = {"query": str(semantic), "mode": str(semantic_mode)}
        wanted = _strings(include) if include else []
        if wanted:
            payload["include"] = wanted
        if cursor is not None:
            payload["cursor"] = str(cursor)

        response = self._call("query_assets", "query_assets", payload, AssetQueryError)
        self._declare_cohort("query_assets", cohort)
        return AssetQueryPage(
            items=[
                QueriedAsset(
                    id=str(item.get("id") or ""),
                    asset_hash=str(item.get("assetHash") or ""),
                    urn=item.get("urn"),
                    source_id=str(item.get("sourceId") or ""),
                    source_name=str(item.get("sourceName") or ""),
                    external_id=item.get("externalId"),
                    name=str(item.get("name") or ""),
                    kind=str(item.get("kind") or ""),
                    url=str(item.get("url") or ""),
                    metadata=dict(item.get("metadata") or {}),
                    findings=[
                        AssetFinding(
                            id=str(f.get("id") or ""),
                            detector_type=str(f.get("detectorType") or ""),
                            detector=f.get("customDetectorKey"),
                            finding_type=str(f.get("findingType") or ""),
                            severity=str(f.get("severity") or ""),
                            status=str(f.get("status") or ""),
                            asserted_by_source_id=f.get("assertedBySourceId"),
                        )
                        for f in item.get("findings") or []
                    ],
                )
                for item in response.get("items") or []
            ],
            next_cursor=response.get("nextCursor"),
        )

    def query_sources(
        self,
        *,
        search: str | None = None,
        type: str | Iterable[str] | None = None,
        status: str | Iterable[str] | None = None,
        limit: int = 1000,
        cursor: str | None = None,
        cohort: bool | None = None,
    ) -> SourcePage:
        """List the namespace's sources, not scan them.

        ``type`` is a source type such as "POSTGRESQL" and ``status`` the status
        of the source's latest run. The result never carries configuration or
        credentials. Always paged; see :meth:`query_assets` for the cursor and for
        ``cohort``: from ``extract()``, choosing what to yield by this read declares
        the run's coverage partial unless you pass ``cohort=False``.
        """
        payload: dict[str, Any] = {"limit": int(limit)}
        if search is not None:
            payload["search"] = str(search)
        if type is not None:
            payload["type"] = _strings(type)
        if status is not None:
            payload["status"] = _strings(status)
        if cursor is not None:
            payload["cursor"] = str(cursor)
        response = self._call("query_sources", "query_sources", payload, AssetQueryError)
        self._declare_cohort("query_sources", cohort)
        return SourcePage(
            items=[
                QueriedSource(
                    id=str(item.get("id") or ""),
                    name=str(item.get("name") or ""),
                    type=str(item.get("type") or ""),
                    description=item.get("description"),
                    run_status=item.get("runnerStatus"),
                    created_at=str(item.get("createdAt") or ""),
                    updated_at=str(item.get("updatedAt") or ""),
                )
                for item in response.get("items") or []
            ],
            next_cursor=response.get("nextCursor"),
        )

    def query_findings(
        self,
        *,
        detector: str | Iterable[str] | None = None,
        detector_type: str | Iterable[str] | None = None,
        finding_type: str | Iterable[str] | None = None,
        severity: str | Iterable[str] | None = None,
        status: str | Iterable[str] | None = None,
        source: str | Iterable[str] | None = None,
        asset: str | Iterable[str] | None = None,
        asserted_by: str | Iterable[str] | None = None,
        limit: int = 1000,
        cursor: str | None = None,
        cohort: bool | None = None,
    ) -> FindingPage:
        """Findings of the namespace, from a detector, or of a source or asset.

        ``detector`` is a custom detector's key (see :meth:`query_detectors`),
        ``detector_type`` a built-in type such as "PII"; ``source`` and
        ``asset`` take ids. Only OPEN findings unless ``status`` says otherwise.
        ``asserted_by`` keeps what another source's notebook tagged. Walk from
        a detector to its assets with ``ctx.query_assets(findings={"detector":
        key})``. Always paged; see :meth:`query_assets` for the cursor.
        """
        payload = _finding_filter(
            "query_findings",
            {
                "detector": detector,
                "detector_type": detector_type,
                "finding_type": finding_type,
                "severity": severity,
                "status": status,
                "source": source,
                "asset": asset,
                "asserted_by": asserted_by,
            },
        )
        payload["limit"] = int(limit)
        if cursor is not None:
            payload["cursor"] = str(cursor)
        response = self._call("query_findings", "query_findings", payload, AssetQueryError)
        self._declare_cohort("query_findings", cohort)
        return FindingPage(
            items=[
                QueriedFinding(
                    id=str(item.get("id") or ""),
                    asset_id=str(item.get("assetId") or ""),
                    source_id=str(item.get("sourceId") or ""),
                    detector_type=str(item.get("detectorType") or ""),
                    detector=item.get("customDetectorKey"),
                    detector_name=item.get("customDetectorName"),
                    finding_type=str(item.get("findingType") or ""),
                    category=str(item.get("category") or ""),
                    severity=str(item.get("severity") or ""),
                    status=str(item.get("status") or ""),
                    confidence=float(item.get("confidence") or 0),
                    content=item.get("content"),
                    metadata=dict(item.get("metadata") or {}),
                    asserted_by_source_id=item.get("assertedBySourceId"),
                    first_detected_at=item.get("firstDetectedAt"),
                    last_detected_at=item.get("lastDetectedAt"),
                )
                for item in response.get("items") or []
            ],
            next_cursor=response.get("nextCursor"),
        )

    def query_detectors(
        self,
        *,
        type: str | Iterable[str] | None = None,
        include_inactive: bool = False,
        limit: int = 1000,
        cursor: str | None = None,
        cohort: bool | None = None,
    ) -> DetectorPage:
        """The namespace's custom detectors: key, name, type. Never the pipeline."""
        payload: dict[str, Any] = {"limit": int(limit), "includeInactive": bool(include_inactive)}
        if type is not None:
            payload["type"] = _strings(type)
        if cursor is not None:
            payload["cursor"] = str(cursor)
        response = self._call("query_detectors", "query_detectors", payload, AssetQueryError)
        self._declare_cohort("query_detectors", cohort)
        return DetectorPage(
            items=[
                QueriedDetector(
                    id=str(item.get("id") or ""),
                    key=str(item.get("key") or ""),
                    name=str(item.get("name") or ""),
                    description=item.get("description"),
                    type=str(item.get("type") or ""),
                    is_active=bool(item.get("isActive")),
                    version=int(item.get("version") or 0),
                )
                for item in response.get("items") or []
            ],
            next_cursor=response.get("nextCursor"),
        )

    def each_asset(self, source: str | None = None, **query: Any) -> Iterator[QueriedAsset]:
        """Every asset matching :meth:`query_assets`, page after page."""
        return _each(lambda cursor: self.query_assets(source, cursor=cursor, **query))

    def each_source(self, **query: Any) -> Iterator[QueriedSource]:
        """Every source matching :meth:`query_sources`, page after page."""
        return _each(lambda cursor: self.query_sources(cursor=cursor, **query))

    def each_finding(self, **query: Any) -> Iterator[QueriedFinding]:
        """Every finding matching :meth:`query_findings`, page after page."""
        return _each(lambda cursor: self.query_findings(cursor=cursor, **query))

    def each_detector(self, **query: Any) -> Iterator[QueriedDetector]:
        """Every detector matching :meth:`query_detectors`, page after page."""
        return _each(lambda cursor: self.query_detectors(cursor=cursor, **query))

    # -- writing onto other sources' assets ----------------------------------

    def tag(
        self, asset: QueriedAsset | str, key: str, value: Any, severity: str | None = None
    ) -> None:
        """Tag an asset of another source.

        ``key`` is an active Tag detector's key (``ctx.query_detectors(type="TAG")``)
        and ``value`` what to assert, or a ``Tag(value, severity)``. The tag is
        recorded as asserted by *this* source, so it never overwrites the asset's
        own tags or another source's, and is retired when a later complete run
        of this source stops asserting it. Several values under one key are
        joined with ", ", as in ``Asset(tags=...)``. Buffered; sent in batches
        and at the end of ``augment_sources()``.
        """
        if isinstance(value, Tag):
            value, severity = value.value, value.severity if severity is None else severity
        asset_id = _asset_id("tag", asset)
        text = str(value).strip()
        if not str(key).strip() or not text:
            raise AugmentationError("ctx.tag() needs a tag key and a non-empty value")
        slot = self._tags.setdefault((asset_id, str(key).strip()), {"values": [], "severity": None})
        if text not in slot["values"]:
            slot["values"].append(text)
        if severity is not None:
            slot["severity"] = str(severity)
        if len(self._tags) >= AUGMENTATION_FLUSH_SIZE:
            self.flush_augmentations()

    def tags(self, asset: QueriedAsset | str, tags: Mapping[str, Any]) -> None:
        """``ctx.tag()`` for several keys at once: ``ctx.tags(asset, {"qa": "reviewed"})``."""
        for key, value in tags.items():
            self.tag(asset, key, value)

    def link(
        self,
        source: QueriedAsset | str,
        target: QueriedAsset | str,
        relation: str = "REFERENCES",
        *,
        relation_class: str | None = None,
        method: str | None = None,
        confidence: float | None = None,
        evidence: Mapping[str, Any] | None = None,
    ) -> None:
        """Draw a link between two assets of any source: ``source`` --relation--> ``target``.

        Either end is a queried asset, an asset id, or a URN. ``relation`` is
        e.g. REFERENCES, SAME_AS, DERIVED_FROM, USES. The edge records this
        source as its author; one that a connector or a person already holds
        is left as it is.
        """
        edge: dict[str, Any] = {"relationType": str(relation).upper()}
        edge.update(_endpoint("from", source))
        edge.update(_endpoint("to", target))
        if relation_class is not None:
            edge["relationClass"] = str(relation_class).upper()
        if method is not None:
            edge["method"] = str(method).upper()
        if confidence is not None:
            edge["confidence"] = float(confidence)
        if evidence:
            edge["evidence"] = dict(evidence)
        self._edges.append(edge)
        if len(self._edges) >= AUGMENTATION_FLUSH_SIZE:
            self.flush_augmentations()

    def means(
        self,
        asset: QueriedAsset | str,
        term: str,
        *,
        confidence: float | None = None,
        evidence: Mapping[str, Any] | None = None,
    ) -> None:
        """Link an asset to a glossary term by key: "this asset means that term".

        A term that does not exist yet is held pending and links once defined.
        """
        self.link(
            asset,
            f"term://glossary/{str(term).strip().lower()}",
            "MEANS",
            relation_class="REFERENCE",
            confidence=confidence,
            evidence=evidence,
        )

    def flush_augmentations(self) -> dict[str, int]:
        """Send buffered tags and links now. Done for you at the end of ``augment_sources()``."""
        if not self._tags and not self._edges:
            return dict(self._augmentation_stats)
        if self._relay is None:
            raise AugmentationError(
                "ctx.tag() and ctx.link() work during scans only; running a cell in the "
                "editor has no scan to write for"
            )
        if self._tags:
            batch = [
                {
                    "assetId": asset_id,
                    "key": key,
                    "value": ", ".join(slot["values"]),
                    **({"severity": slot["severity"]} if slot["severity"] else {}),
                }
                for (asset_id, key), slot in self._tags.items()
            ]
            self._tags = {}
            for start in range(0, len(batch), AUGMENTATION_FLUSH_SIZE):
                self._send(
                    "augment_tags", {"tags": batch[start : start + AUGMENTATION_FLUSH_SIZE]}, "tags"
                )
        if self._edges:
            edges, self._edges = self._edges, []
            for start in range(0, len(edges), AUGMENTATION_FLUSH_SIZE):
                self._send(
                    "augment_edges",
                    {"edges": edges[start : start + AUGMENTATION_FLUSH_SIZE]},
                    "edges",
                )
        return dict(self._augmentation_stats)

    def _send(self, op: str, payload: dict[str, Any], kind: str) -> None:
        assert self._relay is not None
        try:
            result = self._relay(op, payload) or {}
        except AssetQueryError as exc:
            raise AugmentationError(str(exc)) from exc
        self._augmentation_stats[kind] += int(result.get("written") or 0)
        self._augmentation_stats["skipped"] += int(result.get("skipped") or 0)

    @property
    def augmentation_stats(self) -> dict[str, int]:
        """What this run has written so far: ``tags``, ``edges`` and ``skipped``."""
        return dict(self._augmentation_stats)

    def swap_partial_coverage(self, flag: bool, reason: str = "") -> tuple[bool, str]:
        """Runtime-only: replace the partial-coverage verdict, returning the old one.

        Lets the runtime judge ``augment_sources()`` on its own: what ``extract()``
        declared about its assets says nothing about whether the augmentation
        covered everything it meant to.
        """
        previous = (self._partial_coverage, self._partial_coverage_reason)
        self._partial_coverage, self._partial_coverage_reason = flag, reason
        return previous

    def set_phase(self, phase: str) -> None:
        """Runtime-only: which entry point is running ("extract" or "augment")."""
        self._phase = phase

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


#: Buffered tags/links sent per call; the API takes up to 5,000.
AUGMENTATION_FLUSH_SIZE = 1000

_ASSET_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _strings(value: str | Iterable[str]) -> list[str]:
    """One string or many, as the list the API takes."""
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value]


def _finding_filter(caller: str, spec: Mapping[str, Any]) -> dict[str, Any]:
    """Snake-case finding filters as the API names them. ``None`` means unfiltered."""
    names = {
        "detector": "customDetectorKey",
        "custom_detector_key": "customDetectorKey",
        "detector_type": "detectorType",
        "finding_type": "findingType",
        "severity": "severity",
        "status": "status",
        "source": "sourceId",
        "source_id": "sourceId",
        "asset": "assetId",
        "asset_id": "assetId",
        "asserted_by": "assertedBySourceId",
        "asserted_by_source_id": "assertedBySourceId",
    }
    shaped: dict[str, Any] = {}
    for key, value in spec.items():
        if value is None:
            continue
        if key not in names:
            raise AssetQueryError(
                f"ctx.{caller}() has no finding filter {key!r}. Use one of: "
                f"{', '.join(sorted(set(names) - {'custom_detector_key', 'source_id', 'asset_id', 'asserted_by_source_id'}))}"
            )
        shaped[names[key]] = _strings(value)
    return shaped


def _each(fetch: Callable[[str | None], Any]) -> Iterator[Any]:
    cursor: str | None = None
    while True:
        page = fetch(cursor)
        yield from page.items
        cursor = page.next_cursor
        if not cursor:
            return


def _asset_id(caller: str, asset: QueriedAsset | str) -> str:
    asset_id = asset.id if isinstance(asset, QueriedAsset) else str(asset)
    if not _ASSET_ID.match(asset_id):
        raise AugmentationError(
            f"ctx.{caller}() needs an asset from ctx.query_assets() (or its id), got {asset_id!r}"
        )
    return asset_id


def _endpoint(side: str, value: QueriedAsset | str) -> dict[str, str]:
    """A link end: a queried asset or asset id, or a URN."""
    text = value.id if isinstance(value, QueriedAsset) else str(value)
    if _ASSET_ID.match(text):
        return {f"{side}Id": text}
    if ":" in text:
        return {f"{side}Urn": text}
    raise AugmentationError(f"ctx.link() ends are queried assets, asset ids or URNs; got {text!r}")


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
    module.means = means  # type: ignore[attr-defined]
    module.Entity = Entity  # type: ignore[attr-defined]
    module.same_as = same_as  # type: ignore[attr-defined]
    module.uses = uses  # type: ignore[attr-defined]
    module.urn_for = urn_for  # type: ignore[attr-defined]
    module.Context = Context  # type: ignore[attr-defined]
    module.NotebookFile = NotebookFile  # type: ignore[attr-defined]
    module.QueriedAsset = QueriedAsset  # type: ignore[attr-defined]
    module.CohortItem = CohortItem  # type: ignore[attr-defined]
    module.AssetQueryPage = AssetQueryPage  # type: ignore[attr-defined]
    module.AssetQueryError = AssetQueryError  # type: ignore[attr-defined]
    module.AugmentationError = AugmentationError  # type: ignore[attr-defined]
    module.AssetFinding = AssetFinding  # type: ignore[attr-defined]
    module.QueriedSource = QueriedSource  # type: ignore[attr-defined]
    module.QueriedFinding = QueriedFinding  # type: ignore[attr-defined]
    module.QueriedDetector = QueriedDetector  # type: ignore[attr-defined]
    module.SourcePage = SourcePage  # type: ignore[attr-defined]
    module.FindingPage = FindingPage  # type: ignore[attr-defined]
    module.DetectorPage = DetectorPage  # type: ignore[attr-defined]
    module.ParsedContent = ParsedContent  # type: ignore[attr-defined]
    module.ctx = context  # type: ignore[attr-defined]
    module.parse = parse  # type: ignore[attr-defined]
    module.pages = pages  # type: ignore[attr-defined]
    module.__all__ = [  # type: ignore[attr-defined]
        "Asset",
        "Context",
        "ContainmentType",
        "Entity",
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
        "means",
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
        "Entity": Entity,
        "Ref": Ref,
        "FieldMapping": FieldMapping,
        "FlowType": FlowType,
        "Method": Method,
        "flow": flow,
        "contains": contains,
        "references": references,
        "means": means,
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
                "references(), means(), same_as() or uses() -- got "
                f"{type(item).__name__}. These are not interchangeable: only "
                "flow() is lineage, and only it answers 'what breaks if this changes'."
            )
