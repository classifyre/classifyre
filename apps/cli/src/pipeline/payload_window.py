"""Apply the sampling strategy *inside* one asset, not just across assets.

``BaseSource`` already bounds how many assets a run touches: AUTOMATIC keeps an
offset into the source's item list and moves it forward every run (see the
"AUTOMATIC sampling cursor" section of ``sources/base.py``). That bound stops at
the asset boundary. One object in the window can still be a Parquet file with
millions of rows, and every run reads all of them — so a run with
``rows_per_page: 100`` is bounded in assets and unbounded in work, and never
finishes.

This module extends the same idea one level down. A tabular payload has a row
axis, so the strategy can address it:

* ``AUTOMATIC`` reads ``rows_per_page`` rows starting where the previous run
  stopped, and wraps to row 0 once it runs off the end (data is not stale, so
  re-reading is desired — the same wrap-around ``automatic_window`` uses).
* ``RANDOM`` reads a different ``rows_per_page`` rows every run.
* ``LATEST`` reads the top ``rows_per_page`` rows.
* ``ALL`` reads everything, which is what every strategy does today.

Only payloads with a row axis are windowed. A PDF, an image or a Word document
has no meaningful "next 100 rows", so ``window_for`` returns ``None`` for them
and the caller streams the payload unchanged.

The position is per asset, so it lives on the asset: the discover call hands the
CLI the cursor stored on ``Asset.payload_cursor``, and the asset payload carries
the advanced cursor back. ``PayloadWindowStore`` is the per-run holder of both
directions.

Two invariants are load-bearing:

* A cursor is bound to the checksum it was measured against. If the file changed,
  row 12000 is not the row 12000 the offset meant, so the cursor is discarded and
  the sweep restarts rather than resuming into moved data.
* An asset whose window still has rows to cover must never be skipped by the
  scan cache. Its checksum is unchanged — that is exactly the case the cache
  would otherwise skip — but the unread rows have never been scanned. See
  ``advances_for``, which ``pipeline.scan_cache`` consults.
"""

from __future__ import annotations

import logging
import random
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from typing import Any

from ..utils.file_parser import is_tabular_mime_type, tabular_mime_type_for_name

logger = logging.getLogger(__name__)

# Bump when the meaning of a stored cursor changes. A reader that does not
# recognise the version restarts from row 0 rather than misreading an offset.
CURSOR_VERSION = 1
CURSOR_KIND_ROWS = "rows"

STRATEGY_AUTOMATIC = "AUTOMATIC"
STRATEGY_RANDOM = "RANDOM"
STRATEGY_LATEST = "LATEST"
STRATEGY_ALL = "ALL"

# Strategies that read a bounded slice of a payload. ALL is deliberately absent:
# it reads everything, so there is no window to compute and no position to keep.
WINDOWED_STRATEGIES = frozenset({STRATEGY_AUTOMATIC, STRATEGY_RANDOM, STRATEGY_LATEST})

# Strategies whose window moves between runs, so an unchanged checksum is not
# proof that there is nothing left to scan.
ADVANCING_STRATEGIES = frozenset({STRATEGY_AUTOMATIC, STRATEGY_RANDOM})

DEFAULT_ROWS_PER_PAGE = 100

# A factory the window calls to produce payload rows: (start_row, max_rows) with
# ``max_rows=None`` meaning "to the end". Implemented by ``iter_file_pages``,
# which pushes the bounds down into the parquet/CSV reader so skipped rows are
# never decoded.
PageFactory = Callable[[int, "int | None"], Iterator[str]]


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed


@dataclass(frozen=True)
class PayloadCursor:
    """Where a sweep of one asset's rows stopped.

    ``exhausted`` is the field the scan cache reads: it is the only signal that
    the whole payload has been covered and an unchanged file therefore has
    nothing left to give.
    """

    offset: int = 0
    rows_seen: int | None = None
    passes: int = 0
    exhausted: bool = False
    checksum: str | None = None
    strategy: str | None = None

    @classmethod
    def parse(
        cls,
        raw: Any,
        *,
        checksum: str | None = None,
        strategy: str | None = None,
    ) -> PayloadCursor | None:
        """Read a stored cursor, or None when it no longer describes this asset.

        Returning None is the restart signal. It fires on an unreadable cursor,
        an unknown format version, a checksum that no longer matches the file,
        and a strategy switch — in each case the stored offset points at rows we
        can no longer vouch for.
        """
        if not isinstance(raw, dict):
            return None
        if _coerce_int(raw.get("v"), CURSOR_VERSION) != CURSOR_VERSION:
            return None
        kind = raw.get("kind", CURSOR_KIND_ROWS)
        if kind is not None and str(kind) != CURSOR_KIND_ROWS:
            return None

        stored_checksum = raw.get("checksum")
        stored_checksum = str(stored_checksum) if isinstance(stored_checksum, str) else None
        if checksum is not None and stored_checksum is not None and stored_checksum != checksum:
            return None

        stored_strategy = raw.get("strategy")
        stored_strategy = str(stored_strategy) if isinstance(stored_strategy, str) else None
        if strategy is not None and stored_strategy is not None and stored_strategy != strategy:
            return None

        rows_seen = raw.get("rows_seen")
        offset = _coerce_int(raw.get("offset"), 0)
        return cls(
            offset=max(0, offset),
            rows_seen=(max(0, int(rows_seen)) if isinstance(rows_seen, int) else None),
            passes=max(0, _coerce_int(raw.get("passes"), 0)),
            exhausted=bool(raw.get("exhausted", False)),
            checksum=stored_checksum,
            strategy=stored_strategy,
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "v": CURSOR_VERSION,
            "kind": CURSOR_KIND_ROWS,
            "offset": self.offset,
            "rows_seen": self.rows_seen,
            "passes": self.passes,
            "exhausted": self.exhausted,
            "checksum": self.checksum,
            "strategy": self.strategy,
        }


@dataclass(frozen=True)
class PayloadWindow:
    """The slice of one payload this run reads, and how to record where it got to.

    Holds no bytes: it drives a ``PageFactory`` so the bounds can be pushed into
    the reader instead of decoding rows only to drop them.
    """

    strategy: str
    rows_per_page: int
    prior: PayloadCursor | None = None
    checksum: str | None = None
    rng: random.Random | None = None

    @property
    def start_row(self) -> int:
        """First row this run reads."""
        if self.strategy == STRATEGY_AUTOMATIC and self.prior is not None:
            return self.prior.offset
        return 0

    def iterate(
        self,
        pages: PageFactory,
        *,
        rows_per_unit: int = 1,
        row_count: int | None = None,
        on_cursor: Callable[[PayloadCursor], None] | None = None,
    ) -> Iterator[str]:
        """Yield this run's rows, reporting the advanced cursor via ``on_cursor``.

        ``rows_per_unit`` is how many payload rows one yielded page carries.
        Record-shaped readers (Parquet, CSV) emit one row per page, so it is 1;
        a spreadsheet reaches the detectors as extracted text and emits a block
        of lines per page. Row accounting is done in rows either way, so the same
        cursor arithmetic covers both.

        ``row_count`` is the payload's total row count when the reader can supply
        it for free (Parquet keeps it in the footer). RANDOM uses it to seek
        straight to a random window; without it, RANDOM falls back to reservoir
        sampling, which still visits every row but holds only one window.
        """
        take = max(1, self.rows_per_page)
        unit = max(1, rows_per_unit)

        if self.strategy == STRATEGY_LATEST:
            yield from pages(0, take)
            return

        if self.strategy == STRATEGY_RANDOM:
            yield from self._iterate_random(pages, take, unit, row_count)
            return

        if self.strategy != STRATEGY_AUTOMATIC:
            # Unknown strategy: read everything rather than silently under-scan.
            yield from pages(0, None)
            return

        yield from self._iterate_automatic(pages, take, unit, on_cursor)

    # ── AUTOMATIC ────────────────────────────────────────────────────────

    def _iterate_automatic(
        self,
        pages: PageFactory,
        take: int,
        unit: int,
        on_cursor: Callable[[PayloadCursor], None] | None,
    ) -> Iterator[str]:
        start = self.start_row
        emitted = 0
        for page in pages(start, take):
            emitted += 1
            yield page

        if emitted == 0 and start > 0:
            # The payload shrank below the saved offset (or the offset was stale
            # in a way the checksum could not catch). Restart this run rather
            # than burning it on zero rows — the same recovery
            # ``automatic_window`` performs for an out-of-range list offset.
            logger.info(
                "Payload cursor at row %d is past the end; restarting this run at row 0",
                start,
            )
            start = 0
            for page in pages(0, take):
                emitted += 1
                yield page

        if on_cursor is not None:
            on_cursor(self._advanced(start, emitted, take, unit))

    def _advanced(self, start: int, emitted: int, take: int, unit: int) -> PayloadCursor:
        """The cursor to persist after emitting ``emitted`` pages from ``start``.

        An underfilled window means the reader ran off the end, which is what
        marks the pass complete: the offset wraps to 0 so the next run re-reads
        from the top, and ``exhausted`` tells the scan cache the payload has been
        covered.
        """
        prior = self.prior
        passes = prior.passes if prior is not None else 0
        # ``take`` is a row budget; the reader hands it back as pages of ``unit``
        # rows each, so a full window is that many pages.
        expected_units = -(-take // unit)
        reached = start + emitted * unit
        if emitted < expected_units:
            return PayloadCursor(
                offset=0,
                rows_seen=reached,
                passes=passes + 1,
                exhausted=True,
                checksum=self.checksum,
                strategy=self.strategy,
            )
        return PayloadCursor(
            offset=reached,
            rows_seen=prior.rows_seen if prior is not None else None,
            passes=passes,
            exhausted=False,
            checksum=self.checksum,
            strategy=self.strategy,
        )

    # ── RANDOM ───────────────────────────────────────────────────────────

    def _iterate_random(
        self,
        pages: PageFactory,
        take: int,
        unit: int,
        row_count: int | None,
    ) -> Iterator[str]:
        rng = self.rng or random.Random()

        if row_count is not None and row_count > 0:
            # The reader knows the row count up front, so a random window costs
            # one seek instead of a full decode.
            start = rng.randint(0, max(0, row_count - take))
            yield from pages(start, take)
            return

        # No row count available (CSV and friends): reservoir-sample so every
        # page has an equal chance without materialising the payload. One pass,
        # at most one window held.
        capacity = max(1, -(-take // unit))
        reservoir: list[str] = []
        for index, page in enumerate(pages(0, None)):
            if index < capacity:
                reservoir.append(page)
                continue
            slot = rng.randint(0, index)
            if slot < capacity:
                reservoir[slot] = page
        yield from reservoir


class PayloadWindowStore:
    """Per-run payload cursors: what the API stored, and what to store next.

    An asset is addressed by more than one id during a run — the detector
    pipeline tries ``external_url`` before ``hash`` (see
    ``DetectorPipeline._iter_text_content_pages``) and sources key their byte
    caches by whichever they use. ``bind`` registers both so a window looked up
    by either id resolves to the same cursor.

    Thread-safe: assets are processed concurrently and page iteration runs on
    worker threads.
    """

    def __init__(
        self,
        strategy: str,
        rows_per_page: int = DEFAULT_ROWS_PER_PAGE,
        *,
        rng: random.Random | None = None,
    ) -> None:
        self.strategy = (strategy or STRATEGY_AUTOMATIC).strip().upper()
        self.rows_per_page = (
            rows_per_page if rows_per_page and rows_per_page > 0 else (DEFAULT_ROWS_PER_PAGE)
        )
        self._rng = rng
        self._lock = threading.Lock()
        self._alias: dict[str, str] = {}
        self._checksums: dict[str, str] = {}
        self._names: dict[str, str] = {}
        self._prior_raw: dict[str, Any] = {}
        self._next: dict[str, PayloadCursor] = {}

    # ── Construction ─────────────────────────────────────────────────────

    @classmethod
    def from_recipe(cls, recipe: dict[str, Any]) -> PayloadWindowStore:
        sampling = recipe.get("sampling")
        sampling = sampling if isinstance(sampling, dict) else {}
        return cls(
            strategy=str(sampling.get("strategy") or STRATEGY_AUTOMATIC),
            rows_per_page=_coerce_int(sampling.get("rows_per_page"), DEFAULT_ROWS_PER_PAGE),
        )

    @property
    def enabled(self) -> bool:
        """Whether any payload is windowed at all under this strategy."""
        return self.strategy in WINDOWED_STRATEGIES

    @property
    def persists_cursor(self) -> bool:
        """Whether this strategy has a position worth sending back to the API."""
        return self.strategy == STRATEGY_AUTOMATIC

    # ── Identity ─────────────────────────────────────────────────────────

    def bind(self, asset: Any) -> None:
        """Register an asset's ids, checksum and name for this run."""
        asset_hash = str(getattr(asset, "hash", "") or "")
        if not asset_hash:
            return
        checksum = getattr(asset, "checksum", None)
        name = getattr(asset, "name", None)
        with self._lock:
            self._alias[asset_hash] = asset_hash
            external_url = str(getattr(asset, "external_url", "") or "")
            if external_url:
                self._alias[external_url] = asset_hash
            if checksum:
                self._checksums[asset_hash] = str(checksum)
            if name:
                self._names[asset_hash] = str(name)

    def _key(self, asset_id: str) -> str:
        # An unregistered id still gets a window (bounded reading is the point);
        # it just has no stored cursor to resume from.
        return self._alias.get(asset_id, asset_id)

    def _candidate_keys(self, asset: Any) -> list[str]:
        keys: list[str] = []
        for candidate in (getattr(asset, "hash", None), getattr(asset, "external_url", None)):
            value = str(candidate or "").strip()
            if value and value not in keys:
                keys.append(self._key(value))
        return keys

    # ── Prior state (from the discover call) ─────────────────────────────

    def record_prior(self, entries: Any) -> None:
        """Absorb the ``payloadCursors`` entries returned by the discover call."""
        if not isinstance(entries, list):
            return
        with self._lock:
            for raw in entries:
                if not isinstance(raw, dict):
                    continue
                asset_hash = raw.get("hash")
                cursor = raw.get("cursor")
                if isinstance(asset_hash, str) and asset_hash and isinstance(cursor, dict):
                    self._prior_raw[asset_hash] = cursor

    def prior_for(self, asset: Any) -> PayloadCursor | None:
        """The stored cursor for an asset, or None when it cannot be resumed."""
        for key in self._candidate_keys(asset):
            with self._lock:
                raw = self._prior_raw.get(key)
                checksum = self._checksums.get(key)
            cursor = PayloadCursor.parse(raw, checksum=checksum, strategy=self.strategy)
            if cursor is not None:
                return cursor
        return None

    # ── Windows ──────────────────────────────────────────────────────────

    def window_for(self, asset_id: str | None, mime_type: str) -> PayloadWindow | None:
        """The window for one payload, or None when it should stream unchanged.

        None covers every case where windowing does not apply: the ALL strategy,
        and any payload without a row axis.
        """
        if not self.enabled or not is_tabular_mime_type(mime_type):
            return None

        key = self._key(str(asset_id or ""))
        with self._lock:
            raw = self._prior_raw.get(key)
            checksum = self._checksums.get(key)
        prior = PayloadCursor.parse(raw, checksum=checksum, strategy=self.strategy)
        return PayloadWindow(
            strategy=self.strategy,
            rows_per_page=self.rows_per_page,
            prior=prior,
            checksum=checksum,
            rng=self._rng,
        )

    def record(self, asset_id: str | None, cursor: PayloadCursor) -> None:
        """Remember the advanced cursor for an asset."""
        if not self.persists_cursor:
            return
        key = self._key(str(asset_id or ""))
        if not key:
            return
        with self._lock:
            checksum = self._checksums.get(key)
            if checksum and cursor.checksum is None:
                cursor = replace(cursor, checksum=checksum)
            self._next[key] = cursor

    def cursor_payload_for(self, asset: Any) -> dict[str, Any] | None:
        """The cursor to send back on this asset's ingest payload, if any."""
        if not self.persists_cursor:
            return None
        for key in self._candidate_keys(asset):
            with self._lock:
                cursor = self._next.get(key)
            if cursor is not None:
                return cursor.to_payload()
        return None

    # ── Scan-cache interaction ───────────────────────────────────────────

    def advances_for(self, asset: Any) -> bool:
        """Whether this run would read *different* rows of the asset than the last.

        The scan cache skips an asset whose checksum is unchanged. That is right
        for a payload that has been read end to end and wrong for one that is
        part-way through a sweep, so it asks here before skipping.
        """
        if self.strategy not in ADVANCING_STRATEGIES:
            return False

        prior = self.prior_for(asset)
        if not self._looks_tabular(asset) and prior is None:
            # No row axis and no cursor proving otherwise — the window does not
            # apply, so it cannot be the reason to rescan.
            return False

        if self.strategy == STRATEGY_RANDOM:
            # A fresh sample every run is the whole point of RANDOM.
            return True

        # AUTOMATIC: keep scanning until a pass has run off the end. Once the
        # payload is covered and the file has not changed, skipping is correct
        # again and the cache takes over.
        return prior is None or not prior.exhausted

    def _looks_tabular(self, asset: Any) -> bool:
        """Guess a row axis from the asset's name — no bytes, no download."""
        for candidate in (
            getattr(asset, "name", None),
            getattr(asset, "external_url", None),
        ):
            value = str(candidate or "").strip()
            if value and tabular_mime_type_for_name(value) is not None:
                return True
        return False
