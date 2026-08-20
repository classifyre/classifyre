"""What a notebook imports: ``from classifyre import Asset, ctx``.

This is the whole public surface a connector author sees. It stays small on
purpose -- the adapter in ``sources/custom`` is what turns an ``Asset`` into a
``SingleAssetScanResults``, computes hashes and checksums, resolves links and
validates metadata, so none of that leaks into the notebook.
"""

from __future__ import annotations

import sys
import types
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

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
        logger: Callable[[str], None] | None = None,
        should_abort: Callable[[], bool] | None = None,
    ) -> None:
        self._variables = dict(variables or {})
        self._secrets = dict(secrets or {})
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
    module.Context = Context  # type: ignore[attr-defined]
    module.ctx = context  # type: ignore[attr-defined]
    module.__all__ = ["Asset", "Context", "ctx"]  # type: ignore[attr-defined]
    return module


def install(context: Context) -> types.ModuleType:
    """Register ``classifyre`` in ``sys.modules`` so the import statement works."""
    module = build_module(context)
    sys.modules[MODULE_NAME] = module
    return module


def namespace(context: Context) -> dict[str, Any]:
    """Globals for the assembled module.

    ``Asset`` and ``ctx`` are pre-bound as well as importable, so a notebook
    that forgets the import line still runs -- the import is documentation, not
    a hurdle.
    """
    install(context)
    return {
        "__name__": "classifyre_notebook",
        "__builtins__": __builtins__,
        "Asset": Asset,
        "ctx": context,
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
