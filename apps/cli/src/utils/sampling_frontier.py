"""Where an AUTOMATIC sweep has been, small enough to carry between runs.

AUTOMATIC reads a bounded slice of a source per run and remembers its place.
It used to remember a *position*: "the next run starts at item 300 of the
newest-first list". A position means something only while the list holds still,
and the list never does. Five files added to a folder become items 0-4 and push
everything else down, so the next run re-read five files it had already seen
and the new ones waited until the sweep wrapped around -- up to
``total / window`` runs later. A deletion did the reverse and skipped files
that had never been read.

So the place is kept as a *frontier* instead: the newest thing covered (the
head) and how far down the backfill has got (the tail). Everything between the
two is covered, whatever is added or removed around it. Each run then does, in
this order:

1. what is newer than the head, newest first;
2. if that was more than one window, the next runs carry on downwards until
   they meet the head again (``top``/``pos`` -- the catch-up), and only then
   look for anything newer still;
3. with budget left over, the backfill below the tail;
4. once the backfill has reached the end (``done``), nothing but step 1 -- a
   finished sweep does not start over.

Two shapes of source need this, so there are two classes with the same state
machine:

* ``ListFrontier`` for a source that lists everything it has every run (object
  stores, wikis, drives). It is handed the listing and picks the window.
* ``RangeFrontier`` for a source that asks its backing store for a range (SQL
  keys, message timestamps, log offsets). It says which range to ask for next.

A frontier is state about an *ordering*. Order by something that does not
change for an item unless the item itself did, and that is later for a later
arrival: an upload time, a modification time, an increasing key.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

# Bump when the meaning of a stored frontier changes. A reader that does not
# recognise the version starts fresh instead of misreading a boundary. Version
# 1 was the bare integer offset this replaced.
FRONTIER_VERSION = 2

# How many ids are remembered at a boundary rank (see ``_Edge``). Past this the
# boundary falls back to comparing ids, which is still right for everything
# except a late arrival that shares the boundary's rank.
MAX_EDGE_IDS = 256

Rank = int | float | str
Position = tuple[Any, str]

_T = TypeVar("_T")

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

_NEW = "new"
_CATCHUP = "catchup"
_FUTURE = "future"
_LATE = "late"
_COVERED = "covered"
_BELOW = "below"


def time_rank(value: datetime | None) -> int | None:
    """A timestamp as a rank: whole microseconds since the epoch, UTC.

    An integer rather than an ISO string so that two spellings of one instant
    (``Z`` against ``+00:00``, with and without fractions) cannot order
    differently. No timestamp is no rank -- never "now", which would make the
    item look newly arrived on every run.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return (value - _EPOCH) // timedelta(microseconds=1)


def iso_time_rank(value: Any) -> int | None:
    """``time_rank`` of an ISO-8601 string; None when it is missing or unreadable."""
    if isinstance(value, datetime):
        return time_rank(value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return time_rank(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None


def _short_hash(ident: str) -> str:
    return hashlib.sha1(ident.encode("utf-8"), usedforsecurity=False).hexdigest()[:10]


def _is_rank(value: Any) -> bool:
    return isinstance(value, (int, float, str)) and not isinstance(value, bool)


class _Edge:
    """An upper boundary of covered ground: a rank, and who was seen at it.

    Ranks are often coarse. An object store stamps uploads to the second, so a
    file uploaded later in the same second as the newest one covered has the
    boundary's rank, and by id alone may sort *below* the boundary -- inside
    ground already called covered, never to be read. Remembering which ids
    were seen at the boundary rank makes that exact: at this one rank, covered
    means "its id is in the set".
    """

    __slots__ = ("ident", "ids", "rank")

    def __init__(self, rank: Any, ident: str, ids: set[str] | None) -> None:
        self.rank = rank
        self.ident = ident
        self.ids = ids

    @property
    def position(self) -> Position:
        return (self.rank, self.ident)

    def remember(self, rank: Any, ident: str) -> None:
        if rank != self.rank:
            return
        self.ident = max(self.ident, ident)
        if self.ids is None:
            return
        self.ids.add(_short_hash(ident))
        if len(self.ids) > MAX_EDGE_IDS:
            self.ids = None

    def to_state(self) -> dict[str, Any]:
        return {
            "r": self.rank,
            "id": self.ident,
            "ids": sorted(self.ids) if self.ids is not None else None,
        }

    @classmethod
    def parse(cls, raw: Any) -> _Edge | None:
        if not isinstance(raw, dict):
            return None
        rank, ident, ids = raw.get("r"), raw.get("id"), raw.get("ids")
        if not _is_rank(rank) or not isinstance(ident, str):
            return None
        if ids is not None and not (
            isinstance(ids, list) and all(isinstance(entry, str) for entry in ids)
        ):
            return None
        return cls(rank, ident, set(ids) if ids is not None else None)


def _parse_position(raw: Any) -> Position | None:
    if (
        isinstance(raw, (list, tuple))
        and len(raw) == 2
        and _is_rank(raw[0])
        and isinstance(raw[1], str)
    ):
        return (raw[0], raw[1])
    return None


class ListFrontier:
    """The frontier of a source that lists everything it has on every run.

    ``window`` is handed ``(rank, id, item)`` for the whole listing and returns
    the items this run should read, newest first. ``rank`` orders the listing
    (later is newer) and must be an int, float or string of one consistent
    type; ``id`` is unique to the item and breaks ties.
    """

    def __init__(self, state: Any = None) -> None:
        self._head: _Edge | None = None
        self._tail: Position | None = None
        self._done = False
        self._top: _Edge | None = None
        self._pos: Position | None = None
        self._load(state)

    def _load(self, state: Any) -> None:
        if not isinstance(state, dict) or state.get("v") != FRONTIER_VERSION:
            return
        head = _Edge.parse(state.get("head"))
        if head is None:
            return
        tail = _parse_position(state.get("tail"))
        if tail is None:
            return
        top = _Edge.parse(state.get("top")) if state.get("top") is not None else None
        pos = _parse_position(state.get("pos")) if state.get("pos") is not None else None
        if (top is None) != (pos is None):
            return
        self._head, self._tail, self._done = head, tail, bool(state.get("done", False))
        self._top, self._pos = top, pos

    def _reset(self) -> None:
        self._head = None
        self._tail = None
        self._done = False
        self._top = None
        self._pos = None

    @property
    def fresh(self) -> bool:
        """True until a run has covered anything."""
        return self._head is None

    @property
    def done(self) -> bool:
        """True once the backfill has reached the end of the listing.

        Not a promise about the future: the tail is kept, so anything that
        later turns up below it -- a directory that was unreadable last time --
        is still read.
        """
        return self._done

    @property
    def head_rank(self) -> Any:
        """The rank of the newest covered item, or None when fresh."""
        return self._head.rank if self._head is not None else None

    @property
    def tail_rank(self) -> Any:
        """The rank the backfill has reached, or None when fresh."""
        return self._tail[0] if self._tail is not None else None

    @property
    def gap_rank(self) -> Any:
        """While catching up, the rank the catch-up has come down to; else None."""
        return self._pos[0] if self._pos is not None else None

    @property
    def catching_up(self) -> bool:
        return self._top is not None

    def pending(self, rank: Any, ident: str) -> bool:
        """Whether this item is still to be read, as the frontier stands now."""
        if self._head is None:
            return True
        try:
            return self._zone(rank, ident) in {_NEW, _CATCHUP, _LATE, _BELOW}
        except TypeError:
            return True

    def to_state(self) -> dict[str, Any] | None:
        if self._head is None:
            return None
        state: dict[str, Any] = {
            "v": FRONTIER_VERSION,
            "head": self._head.to_state(),
            "tail": list(self._tail) if self._tail is not None else None,
            "done": self._done,
        }
        if self._top is not None and self._pos is not None:
            state["top"] = self._top.to_state()
            state["pos"] = list(self._pos)
        return state

    def window(
        self,
        entries: Iterable[tuple[Any, str, _T]],
        budget: int,
        *,
        above_complete: bool = True,
        below_complete: bool = True,
    ) -> list[_T]:
        """Pick this run's items and move the frontier over them.

        The two flags are for a remote listing fetched a page at a time, which
        may stop before it has seen everything. ``above_complete=False``: more
        unread items lie above the head than were listed, so the head is not
        moved past them. ``below_complete=False``: only some of what lies
        below the tail was listed, so the backfill does not conclude.
        """
        ordered = sorted(entries, key=lambda entry: (entry[0], entry[1]), reverse=True)
        budget = max(1, int(budget))
        try:
            picked = self._window(ordered, budget, above_complete, below_complete)
        except TypeError:
            # The stored ranks are of another type than this listing's (a
            # source changed what it orders by). The boundaries cannot be
            # compared to anything any more, so the sweep starts over.
            self._reset()
            picked = self._window(ordered, budget, above_complete, below_complete)
        return [ordered[index][2] for index in picked]

    def _zone(self, rank: Any, ident: str) -> str:
        head = self._head
        assert head is not None
        top = self._top
        position = (rank, ident)

        # At a boundary rank, covered means "seen", not "sorts inside".
        if top is not None and top.ids is not None and rank == top.rank:
            return _COVERED if _short_hash(ident) in top.ids else _CATCHUP
        if head.ids is not None and rank == head.rank:
            return _COVERED if _short_hash(ident) in head.ids else _LATE

        if top is not None:
            assert self._pos is not None
            if position > top.position:
                return _FUTURE
            if position >= self._pos:
                return _COVERED
            if position > head.position:
                return _CATCHUP
        elif position > head.position:
            return _NEW

        if self._tail is not None and position >= self._tail:
            return _COVERED
        return _BELOW

    def _start(self, ordered: list[tuple[Any, str, Any]], budget: int, complete: bool) -> list[int]:
        picked = list(range(min(budget, len(ordered))))
        if not picked:
            return []
        rank, ident, _ = ordered[0]
        head = _Edge(rank, ident, set())
        for index in picked:
            head.remember(ordered[index][0], ordered[index][1])
        last = ordered[picked[-1]]
        self._head = head
        self._done = complete and len(ordered) <= budget
        self._tail = (last[0], last[1])
        return picked

    def _window(
        self,
        ordered: list[tuple[Any, str, Any]],
        budget: int,
        above_complete: bool,
        below_complete: bool,
    ) -> list[int]:
        if self._head is None:
            return self._start(ordered, budget, below_complete)
        if not ordered:
            # An empty listing is more often a listing that failed than a
            # source that emptied; it is evidence of nothing.
            return []

        picked: list[int] = []
        seen: set[int] = set()
        above_settled = above_complete

        while budget > 0:
            head = self._head
            catching_up = self._top is not None
            wanted = _CATCHUP if catching_up else _NEW
            above: list[int] = []
            late: list[int] = []
            for index, (rank, ident, _) in enumerate(ordered):
                if index in seen:
                    continue
                zone = self._zone(rank, ident)
                if zone == wanted:
                    above.append(index)
                elif zone == _LATE:
                    late.append(index)

            candidates = above + late
            if not candidates:
                if catching_up and above_complete:
                    # The gap is closed. Whatever arrived above it meanwhile
                    # is plain "new" on the next turn of the loop.
                    self._promote()
                    continue
                break

            chunk = candidates[:budget]
            above_set = set(above)
            for index in chunk:
                rank, ident, _ = ordered[index]
                if index not in above_set:
                    head.remember(rank, ident)
                    if self._tail is not None and (rank, ident) < self._tail:
                        self._tail = (rank, ident)
                elif catching_up:
                    assert self._top is not None and self._pos is not None
                    self._top.remember(rank, ident)
                    self._pos = min(self._pos, (rank, ident))
                else:
                    if self._top is None:
                        # Without ids at the head rank, ids at the same rank
                        # above it would claim the head's own items as unseen.
                        tracked = not (head.ids is None and rank == head.rank)
                        self._top = _Edge(rank, ident, set() if tracked else None)
                    self._top.remember(rank, ident)
                    self._pos = (rank, ident)

            picked.extend(chunk)
            seen.update(chunk)
            budget -= len(chunk)
            if len(chunk) < len(candidates):
                above_settled = False
                break
            if self._top is None or not above_complete:
                break
            self._promote()

        if budget > 0 and self._top is None and above_settled:
            below = [
                index
                for index, (rank, ident, _) in enumerate(ordered)
                if index not in seen and self._zone(rank, ident) == _BELOW
            ]
            chunk = below[:budget]
            if chunk:
                last = ordered[chunk[-1]]
                self._tail = (last[0], last[1])
                picked.extend(chunk)
            self._done = below_complete and len(chunk) == len(below)

        return picked

    def _promote(self) -> None:
        self._head = self._top
        self._top = None
        self._pos = None


@dataclass(frozen=True)
class RangeStep:
    """One range to read, newest first, strictly between ``after`` and ``before``.

    Either bound may be None, meaning open on that side.
    """

    kind: str
    after: Any = None
    before: Any = None


class RangeFrontier:
    """The frontier of a source that asks its backing store for ranges.

    Positions are whatever the store orders by -- a key, a timestamp, an
    offset -- and must be unique: the store does the comparing, this only
    remembers the boundaries. Drive it like this::

        frontier = RangeFrontier(saved)
        while budget > 0 and (step := frontier.next_step()) is not None:
            rows = fetch_newest_first(after=step.after, before=step.before, limit=budget)
            frontier.record(step, newest=..., oldest=..., exhausted=len(rows) < budget)
            budget -= len(rows)
        save(frontier.to_state())

    ``exhausted`` says the range has nothing more to give. Reporting a full
    page as not exhausted is always safe: the next run asks again, gets
    nothing, and concludes it then.
    """

    def __init__(self, state: Any = None) -> None:
        self._head: Any = None
        self._tail: Any = None
        self._done = False
        self._top: Any = None
        self._pos: Any = None
        self._started = False
        self._new_checked = False
        self._stalled = False
        if isinstance(state, dict) and state.get("v") == FRONTIER_VERSION:
            head = state.get("head")
            done = bool(state.get("done", False))
            tail = state.get("tail")
            top, pos = state.get("top"), state.get("pos")
            if head is not None and (done or tail is not None) and (top is None) == (pos is None):
                self._head, self._done = head, done
                self._tail = None if done else tail
                self._top, self._pos = top, pos

    @property
    def fresh(self) -> bool:
        return self._head is None

    @property
    def done(self) -> bool:
        return self._done

    def to_state(self) -> dict[str, Any] | None:
        if self._head is None:
            return None
        state: dict[str, Any] = {
            "v": FRONTIER_VERSION,
            "head": self._head,
            "tail": None if self._done else self._tail,
            "done": self._done,
        }
        if self._top is not None:
            state["top"] = self._top
            state["pos"] = self._pos
        return state

    def next_step(self) -> RangeStep | None:
        if self._stalled:
            return None
        if self._head is None:
            return None if self._started else RangeStep("fresh")
        if self._top is not None:
            return RangeStep("catchup", after=self._head, before=self._pos)
        if not self._new_checked:
            return RangeStep("new", after=self._head)
        if not self._done:
            return RangeStep("backfill", before=self._tail)
        return None

    def record(
        self,
        step: RangeStep,
        *,
        newest: Any = None,
        oldest: Any = None,
        exhausted: bool,
    ) -> None:
        """Fold in what ``step`` returned: its first and last positions."""
        empty = newest is None or oldest is None
        if step.kind == "fresh":
            self._started = True
            self._new_checked = True
            if empty:
                return
            self._head, self._done = newest, exhausted
            self._tail = None if exhausted else oldest
        elif step.kind == "new":
            self._new_checked = True
            if empty:
                return
            if exhausted:
                self._head = newest
            else:
                self._top, self._pos = newest, oldest
        elif step.kind == "catchup":
            if not empty:
                self._pos = oldest
            if exhausted:
                self._head = self._top
                self._top = None
                self._pos = None
                # More may have arrived above the gap while it was being closed.
                self._new_checked = False
            elif empty:
                self._stalled = True
        elif step.kind == "backfill":
            if not empty:
                self._tail = oldest
            if exhausted:
                self._done = True
                self._tail = None
            elif empty:
                # Nothing came back and the store did not say it was the end:
                # stop asking this run rather than spin.
                self._stalled = True


# How many ids mark each boundary of an ``OrderedFrontier``. A boundary is
# lost only if every one of them disappears between two runs.
ANCHOR_COUNT = 5


class OrderedFrontier:
    """The frontier of a newest-first listing that carries nothing to order by.

    Some listings arrive in order and say no more than that: a channel's
    uploads are newest first, but the cheap listing has ids and no dates. With
    no rank to store, the boundaries are remembered as the ids that sit at
    them, and found again by looking those ids up in the next listing. New
    items appear ahead of the head's ids; the backfill continues after the
    tail's.

    Several ids mark each boundary so that one deleted item does not lose it.
    If a boundary is lost anyway the affected ground is read again, never
    skipped.
    """

    def __init__(self, state: Any = None) -> None:
        self._head: list[str] = []
        self._tail: list[str] = []
        self._done = False
        self._top: list[str] = []
        self._pos: list[str] = []
        if not isinstance(state, dict) or state.get("v") != FRONTIER_VERSION:
            return
        head, tail = self._ids(state.get("head")), self._ids(state.get("tail"))
        if not head or not tail:
            return
        self._head, self._tail = head, tail
        self._done = bool(state.get("done", False))
        top, pos = self._ids(state.get("top")), self._ids(state.get("pos"))
        if top and pos:
            self._top, self._pos = top, pos

    @staticmethod
    def _ids(raw: Any) -> list[str]:
        if not isinstance(raw, list):
            return []
        return [entry for entry in raw if isinstance(entry, str)]

    @property
    def fresh(self) -> bool:
        return not self._head

    @property
    def done(self) -> bool:
        return self._done

    def to_state(self) -> dict[str, Any] | None:
        if not self._head:
            return None
        state: dict[str, Any] = {
            "v": FRONTIER_VERSION,
            "head": self._head,
            "tail": self._tail,
            "done": self._done,
        }
        if self._top:
            state["top"] = self._top
            state["pos"] = self._pos
        return state

    def window(self, listing: list[str], budget: int) -> list[str]:
        """Pick this run's ids from a complete newest-first listing."""
        budget = max(1, int(budget))
        if not listing:
            return []
        index = {ident: position for position, ident in enumerate(listing)}

        head_at = [index[ident] for ident in self._head if ident in index]
        if not head_at:
            # Fresh, or every id that marked the head is gone: start over.
            taken = listing[:budget]
            self._head = taken[:ANCHOR_COUNT]
            self._tail = taken[-ANCHOR_COUNT:]
            self._done = len(listing) <= budget
            self._top, self._pos = [], []
            return taken

        head = min(head_at)
        tail_at = [index[ident] for ident in self._tail if ident in index]
        # A lost tail falls back to the head: the ground between is read again.
        tail = max(tail_at) if tail_at else head
        tail = max(tail, head)

        top_at = [index[ident] for ident in self._top if ident in index]
        pos_at = [index[ident] for ident in self._pos if ident in index]
        if self._top and not (top_at and pos_at):
            # A lost catch-up is forgotten: everything above the head is new.
            self._top, self._pos = [], []
            top_at, pos_at = [], []

        picked: list[str] = []
        if self._top:
            top, pos = min(top_at), min(max(pos_at), head - 1)
            chunk = listing[pos + 1 : head][:budget]
            picked += chunk
            budget -= len(chunk)
            if pos + 1 + len(chunk) < head:
                self._pos = chunk[-ANCHOR_COUNT:]
                return picked
            # The gap is closed: covered ground now starts where the catch-up did.
            head = top
            self._top, self._pos = [], []
            self._head = listing[head : head + ANCHOR_COUNT]

        if budget > 0 and head > 0:
            chunk = listing[:head][:budget]
            picked += chunk
            budget -= len(chunk)
            if len(chunk) < head:
                self._top = chunk[:ANCHOR_COUNT]
                self._pos = chunk[-ANCHOR_COUNT:]
                return picked
            self._head = listing[:ANCHOR_COUNT]

        if budget > 0:
            chunk = listing[tail + 1 :][:budget]
            if chunk:
                picked += chunk
                tail += len(chunk)
                self._tail = listing[max(head, tail - ANCHOR_COUNT + 1) : tail + 1]
            self._done = tail >= len(listing) - 1
        return picked
