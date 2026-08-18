"""The two values a custom source notebook returns.

Deliberately small. Everything Classifyre needs but a connector author should
not have to think about - stable hashing, checksums, asset typing, sampling
windows, detector routing - is derived on the host side from these.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Sequence

#: Asset kinds a custom source may emit. These map onto the
#: ``x-asset-metadata.sources.CUSTOM`` catalog entry, and onto the icon a
#: reviewer sees next to the asset.
KINDS = ("record", "page", "file", "table")

DEFAULT_KIND = "record"


class AssetError(ValueError):
    """Raised when a notebook returns something Classifyre cannot ingest."""


@dataclass
class AssetRef:
    """One thing that exists in the source system.

    Returned by ``discover()``. Keep it cheap: discovery runs over the whole
    corpus before any content is read, so this should be a listing call, not a
    download.

    Args:
        id: Stable identifier within this source. It is the basis of the asset's
            identity across runs, so it must not change for the same underlying
            object - prefer a primary key or path over an array index.
        name: Human-readable label shown in the UI.
        url: Where a person would go to see this thing. Falls back to ``id``.
        updated_at: Last-modified time, when the source knows it.
        links: ``id``s of related assets, used to build the investigation graph.
        kind: One of ``KINDS``.
        attributes: Anything else worth recording against the asset.
    """

    id: str
    name: str = ""
    url: str = ""
    updated_at: datetime | None = None
    links: Sequence[str] = ()
    kind: str = DEFAULT_KIND
    attributes: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        if not self.id:
            raise AssetError("AssetRef.id is required and cannot be empty")
        if self.kind not in KINDS:
            raise AssetError(
                f"AssetRef.kind must be one of {', '.join(KINDS)} (got {self.kind!r})"
            )
        self.name = str(self.name or "").strip() or self.id
        self.url = str(self.url or "").strip() or self.id
        self.links = [str(link) for link in self.links if str(link).strip()]
        if not isinstance(self.attributes, dict):
            raise AssetError("AssetRef.attributes must be a dict")


@dataclass
class AssetContent:
    """The content of one asset.

    Returned by ``fetch()``. Set whichever of ``text`` / ``rows`` / ``data`` fits
    the thing you are describing; set none of them for an asset that is only
    metadata.

    Args:
        text: Plain text to scan.
        rows: Tabular records. Each row is a mapping of column name to value.
        data: Raw bytes, for a real file. Pair it with ``mime_type``.
        mime_type: Media type of ``data``, e.g. ``application/pdf``.
        name: Overrides the ref's name when the content reveals a better one.
        attributes: Merged over the ref's attributes.
    """

    text: str | None = None
    rows: Iterable[dict[str, Any]] | None = None
    data: bytes | None = None
    mime_type: str | None = None
    name: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.data is not None and not isinstance(self.data, (bytes, bytearray)):
            raise AssetError("AssetContent.data must be bytes - encode text yourself")
        if self.text is not None and not isinstance(self.text, str):
            raise AssetError("AssetContent.text must be a str")
        if not isinstance(self.attributes, dict):
            raise AssetError("AssetContent.attributes must be a dict")

    @property
    def is_empty(self) -> bool:
        return self.text is None and self.rows is None and self.data is None
