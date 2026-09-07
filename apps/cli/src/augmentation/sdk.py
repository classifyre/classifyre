"""What an augmentation notebook sees: ``augment(asset)`` and ``ctx``.

This is the whole public surface of source augmentation. It reuses the CUSTOM
notebook machinery end to end — ``Ref``, the relationship builders, ``urn_for``,
``Context`` — rather than growing a second vocabulary for the same ideas:

- ``asset`` is an :class:`AugmentedAsset`: the connector's asset read-only,
  except through the additive writers (``set``/``tag``/``link``/``set_urn``).
  Anything those writers do not cover cannot be changed, which is what makes
  the additive-only guarantee structural rather than conventional.
- ``ctx`` is an :class:`AugmentContext`: the connector context plus ``state``
  (per-run scratch that survives across assets) and ``source`` (which source
  is being augmented).

"Payload" is not one shape, and the lazy accessors are where the unification
happens. Only file-shaped sources have bytes; row-shaped ones never produce
any. Every family implements ``fetch_content_pages() -> (raw, text)``, and the
parent serves both halves here, which is what makes one API work everywhere:

- object storage, files, Git, HF, local folder: ``payload()`` is the bytes.
- SQL / tabular: ``raw_pages()`` is one JSON record per row.
- Elasticsearch / OpenSearch / Mongo / Neo4j / Kafka / Meilisearch: one JSON
  document per page.
- API sources (Jira, Confluence, Slack, Notion, WordPress, ...): the original
  markup per page.
- CUSTOM: ``content_bytes`` when the notebook set it, else the text.

``rows()`` parses ``raw_pages()`` when it is JSON records and yields dicts; it
is empty otherwise. So "read the source value, not the extracted text" reads
the same on Postgres and on S3.
"""

from __future__ import annotations

import inspect
import json
import types
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

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
from ..notebook.files import ParsedContent, pages, parse
from ..notebook.sdk import (
    MODULE_NAME,
    Context,
    NotebookFile,
    urn_for,
)
from ..utils.urn import normalize_urn_or_none

#: Cap applied to ``text()`` when the parent did not already truncate. A whole
#: extracted document is the common case; without a bound one pathological PDF
#: would dominate the augmentation child.
DEFAULT_TEXT_CAP = 1_000_000


class AugmentContext(Context):
    """The augmentation notebook's window onto its configuration and this run.

    Everything :class:`Context` offers (``var``, ``secret``, ``files``,
    ``folder``, ``sampling``, ``log``, ...) works unchanged, plus the two
    members below.
    """

    def __init__(
        self,
        *,
        source: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        info = dict(source or {})
        self._source = {
            "type": str(info.get("type") or ""),
            "source_id": info.get("source_id"),
        }
        #: Per-run scratch that survives across assets. ``setup()`` builds
        #: lookup tables here; ``augment()`` reads them; ``finalize()`` drains
        #: them. Scoped to one child process — with ``max_workers > 1`` each
        #: worker keeps its own, and ``finalize()`` runs on every worker.
        self.state: dict[str, Any] = {}

    @property
    def source(self) -> dict[str, Any]:
        """Which source is being augmented: ``{"type": ..., "source_id": ...}``."""
        return dict(self._source)


NeedsFetcher = Callable[[str], Any]
"""Serve one lazy payload op. ``op`` is ``payload`` | ``raw_pages`` | ``text``."""


class AugmentedAsset:
    """One asset as its connector produced it, plus additive writers.

    Read the connector's fields directly; fetch the underlying value lazily
    (each accessor hits the parent at most once — results are memoized); write
    only through ``set``/``tag``/``link``/``set_urn`` and by yielding edges.
    """

    def __init__(
        self,
        *,
        hash: str,
        id: str = "",
        name: str = "",
        kind: str = "",
        url: str = "",
        urn: str | None = None,
        source_type: str = "",
        metadata: Mapping[str, Any] | None = None,
        mime_type: str | None = None,
        need: NeedsFetcher | None = None,
    ) -> None:
        self._hash = str(hash or "").strip()
        if not self._hash:
            raise ValueError("AugmentedAsset needs the asset hash")
        self._id = str(id or "").strip() or self._hash
        self._name = str(name or "")
        self._kind = str(kind or "")
        self._url = str(url or "")
        self._urn = str(urn) if urn else None
        self._source_type = str(source_type or "")
        self._metadata = dict(metadata or {})
        self._mime_type = mime_type
        self._need = need
        self._fetched: dict[str, Any] = {}
        # Staged writes. The parent applies them additively; nothing else in
        # this object ever reaches the parent, so hash/name/content are
        # structurally unreachable from a notebook.
        self._added_metadata: dict[str, Any] = {}
        self._tags: dict[str, str] = {}
        self._links: list[str] = []
        self._new_urn: str | None = None
        self.warnings: list[str] = []

    # -- read: the asset as the connector produced it ------------------------

    @property
    def hash(self) -> str:
        return self._hash

    @property
    def id(self) -> str:
        """The connector's own id for this asset (``external_id`` when known)."""
        return self._id

    @property
    def name(self) -> str:
        return self._name

    @property
    def kind(self) -> str:
        return self._kind

    @property
    def url(self) -> str:
        return self._url

    @property
    def urn(self) -> str | None:
        return self._urn

    @property
    def source_type(self) -> str:
        return self._source_type

    @property
    def mime_type(self) -> str | None:
        return self._mime_type

    @property
    def metadata(self) -> Mapping[str, Any]:
        """Read-only view of the connector's own metadata."""
        return types.MappingProxyType(self._metadata)

    @property
    def ref(self) -> Ref:
        """``Ref.asset(asset.hash)``, for edge builders."""
        return Ref.asset(self._hash)

    # -- read: lazy payload, paid only when called ----------------------------

    def _fetch(self, op: str) -> Any:
        if op in self._fetched:
            return self._fetched[op]
        if self._need is None:
            return None
        try:
            value = self._need(op)
        except Exception as exc:
            self.warnings.append(f"Lazy payload {op!r} unavailable: {exc}")
            value = None
        self._fetched[op] = value
        return value

    def payload(self) -> bytes | None:
        """Raw source bytes (file-shaped sources), or None.

        Fetched from the parent on first call and memoized. ``None`` means the
        source has no bytes for this asset — row-shaped sources never do — not
        an error.
        """
        raw = self._fetch("payload")
        if not isinstance(raw, Mapping):
            return None
        encoded = raw.get("bytes_b64")
        if not isinstance(encoded, str) or not encoded:
            return None
        import base64
        import binascii

        try:
            return base64.b64decode(encoded)
        except (ValueError, binascii.Error):
            self.warnings.append("Ignoring malformed payload bytes from parent")
            return None

    def raw_pages(self) -> list[str]:
        """The connector's own raw representation, page by page.

        One JSON record per row for SQL/tabular sources, one JSON document per
        page for document stores, the original markup for API sources. Empty
        when the source exposes no raw representation.
        """
        raw = self._fetch("raw_pages")
        if not isinstance(raw, Mapping):
            return []
        pages_value = raw.get("pages")
        if not isinstance(pages_value, list):
            return []
        return [str(page) for page in pages_value if isinstance(page, str) and page]

    def rows(self) -> Iterator[dict[str, Any]]:
        """Dict rows, when the raw representation is JSON records.

        Parses ``raw_pages()``: a page may be one JSON object, a JSON array of
        objects, or JSON-lines. Anything else yields nothing — this is empty,
        not an error, on sources with no record shape.
        """
        for page in self.raw_pages():
            yield from _parse_record_page(page)

    def text(self) -> str:
        """Extracted text, whole (capped)."""
        raw = self._fetch("text")
        if not isinstance(raw, Mapping):
            return ""
        value = raw.get("text")
        if not isinstance(value, str):
            return ""
        return value[:DEFAULT_TEXT_CAP]

    def pages(self) -> list[str]:
        """Extracted text, page by page."""
        raw = self._fetch("text")
        if not isinstance(raw, Mapping):
            return []
        pages_value = raw.get("pages")
        if not isinstance(pages_value, list):
            return []
        return [str(page) for page in pages_value if isinstance(page, str)]

    # -- write: additive only ---------------------------------------------------

    def set(self, key: str, value: Any) -> None:
        """Stage one metadata value. Lands under ``metadata["augmentation"]``.

        Connector keys are unreachable: the parent writes only inside the
        ``augmentation`` namespace, never touching what the connector set.
        """
        name = str(key or "").strip()
        if not name:
            self.warnings.append("Ignoring asset.set() with an empty key")
            return
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            self.warnings.append(f"Ignoring asset.set({name!r}): value is not JSON-serializable")
            return
        self._added_metadata[name] = value

    def tag(self, key: str, value: str) -> None:
        """Assert a fact keyed by a Tag detector's key.

        Each entry becomes a finding with that detector's label and severity.
        A key with no matching Tag detector is skipped with a scan warning.
        """
        name = str(key or "").strip()
        text = str("" if value is None else value).strip()
        if not name or not text:
            self.warnings.append("Ignoring asset.tag() with an empty key or value")
            return
        existing = self._tags.get(name)
        self._tags[name] = f"{existing}, {text}" if existing else text

    def link(self, other_hash: str) -> None:
        """Record an untyped "related" link to another asset by its hash."""
        target = str(other_hash or "").strip()
        if not target:
            self.warnings.append("Ignoring asset.link() with an empty hash")
            return
        if target not in self._links:
            self._links.append(target)

    def set_urn(self, urn: str) -> None:
        """Set the asset's cross-system identity, only if the connector left it empty.

        The parent keeps the connector's URN when one exists; a notebook that
        could overwrite it could steal another source's lineage. Malformed
        values are ignored with a warning, not an error.
        """
        candidate = str(urn or "").strip()
        if not candidate:
            self.warnings.append("Ignoring asset.set_urn() with an empty URN")
            return
        if normalize_urn_or_none(candidate) is None:
            self.warnings.append(f"Ignoring asset.set_urn({candidate!r}): not a valid URN")
            return
        self._new_urn = candidate

    # -- patch -------------------------------------------------------------------

    def patch(self) -> dict[str, Any]:
        """The staged writes, for the parent to apply additively."""
        return {
            "metadata": dict(self._added_metadata),
            "tags": dict(self._tags),
            "links": list(self._links),
            "urn": self._new_urn,
            "warnings": list(self.warnings),
        }


def _parse_record_page(page: str) -> Iterator[dict[str, Any]]:
    text = page.strip()
    if not text:
        return
    try:
        record = json.loads(text)
    except (ValueError, TypeError):
        # JSON-lines: one object per line.
        for raw_line in text.splitlines():
            stripped = raw_line.strip()
            if not stripped:
                continue
            try:
                item = json.loads(stripped)
            except (ValueError, TypeError):
                continue
            if isinstance(item, dict):
                yield item
        return
    if isinstance(record, dict):
        yield record
    elif isinstance(record, list):
        for item in record:
            if isinstance(item, dict):
                yield item


def iter_augment_edges(value: Any) -> Iterable[Edge]:
    """Normalize whatever ``augment()``/``finalize()`` returned into Edges.

    Only the builders are accepted — the same rule as ``relationships()``: the
    value of the edge vocabulary is that the author had to choose between
    ``flow``, ``contains``, ``references`` and ``same_as``.
    """
    if value is None:
        return
    if isinstance(value, Edge):
        value = [value]
    elif inspect.isgenerator(value) or isinstance(value, Iterator):
        pass
    elif isinstance(value, (list, tuple)):
        pass
    else:
        # A single non-None, non-edge return (a string, a dict, ...) is almost
        # always "return asset" or a forgotten yield — say so, rather than
        # failing the asset over it.
        raise TypeError(
            "augment() must yield edges built with flow(), contains(), "
            "references(), same_as() or uses() -- got "
            f"{type(value).__name__}. To only add metadata, tags or links, "
            "return nothing."
        )
    for item in value:
        if isinstance(item, Edge):
            yield item
        else:
            raise TypeError(
                "augment() must yield edges built with flow(), contains(), "
                "references(), same_as() or uses() -- got "
                f"{type(item).__name__}. These are not interchangeable: only "
                "flow() is lineage, and only it answers 'what breaks if this changes'."
            )


def build_augmentation_module(context: AugmentContext) -> types.ModuleType:
    """The synthetic ``classifyre`` module an augmentation notebook imports."""
    module = types.ModuleType(MODULE_NAME)
    module.__doc__ = "Runtime helpers available to a Classifyre augmentation notebook."
    module.Asset = AugmentedAsset  # type: ignore[attr-defined]
    module.AugmentedAsset = AugmentedAsset  # type: ignore[attr-defined]
    module.Ref = Ref  # type: ignore[attr-defined]
    module.FieldMapping = FieldMapping  # type: ignore[attr-defined]
    module.FlowType = FlowType  # type: ignore[attr-defined]
    module.flow = flow  # type: ignore[attr-defined]
    module.contains = contains  # type: ignore[attr-defined]
    module.references = references  # type: ignore[attr-defined]
    module.same_as = same_as  # type: ignore[attr-defined]
    module.uses = uses  # type: ignore[attr-defined]
    module.urn_for = urn_for  # type: ignore[attr-defined]
    module.Context = AugmentContext  # type: ignore[attr-defined]
    module.NotebookFile = NotebookFile  # type: ignore[attr-defined]
    module.ParsedContent = ParsedContent  # type: ignore[attr-defined]
    module.ctx = context  # type: ignore[attr-defined]
    module.parse = parse  # type: ignore[attr-defined]
    module.pages = pages  # type: ignore[attr-defined]
    module.__all__ = [  # type: ignore[attr-defined]
        "Asset",
        "AugmentedAsset",
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


def augmentation_namespace(context: AugmentContext) -> dict[str, Any]:
    """Globals for the assembled augmentation module.

    ``ctx`` and the builders are pre-bound as well as importable, so a notebook
    that forgets the import line still runs. ``asset`` is deliberately absent:
    it is per-call, bound by the runner around each ``augment(asset)`` call.
    """
    import sys as _sys

    _sys.modules[MODULE_NAME] = build_augmentation_module(context)
    return {
        "__name__": "classifyre_augmentation_notebook",
        "__builtins__": __builtins__,
        "Asset": AugmentedAsset,
        "AugmentedAsset": AugmentedAsset,
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


__all__ = [
    "DEFAULT_TEXT_CAP",
    "AugmentContext",
    "AugmentedAsset",
    "augmentation_namespace",
    "build_augmentation_module",
    "iter_augment_edges",
]
