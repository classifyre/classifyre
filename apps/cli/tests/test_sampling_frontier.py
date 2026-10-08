"""The frontier that replaced AUTOMATIC's positional cursor."""

from __future__ import annotations

import json
import random
from typing import Any

import pytest

from src.utils.sampling_frontier import (
    MAX_EDGE_IDS,
    ListFrontier,
    OrderedFrontier,
    RangeFrontier,
)

Item = tuple[int, str]


def _entries(items: list[Item]) -> list[tuple[int, str, Item]]:
    return [(rank, ident, (rank, ident)) for rank, ident in items]


def _run(state: Any, items: list[Item], budget: int) -> tuple[list[Item], Any]:
    """One run: load the saved state the way the next process would."""
    frontier = ListFrontier(json.loads(json.dumps(state)))
    window = frontier.window(_entries(items), budget)
    return window, frontier.to_state()


def _files(count: int, start: int = 0) -> list[Item]:
    return [(rank, f"f{rank:04d}") for rank in range(start, start + count)]


# ── ListFrontier ─────────────────────────────────────────────────────────


def test_first_run_takes_the_newest() -> None:
    window, state = _run(None, _files(10), 3)
    assert window == [(9, "f0009"), (8, "f0008"), (7, "f0007")]
    assert state["done"] is False


def test_new_files_are_read_before_the_backfill_continues() -> None:
    # The reported failure: files added between runs went unread while the
    # sweep carried on into older ground.
    items = _files(250)
    _, state = _run(None, items, 100)

    items += _files(5, start=250)
    window, state = _run(state, items, 100)

    assert window[:5] == sorted(_files(5, start=250), reverse=True)
    # The rest of the budget goes to the backfill, picking up where it left
    # off rather than re-reading what the new files pushed down.
    assert window[5] == (149, "f0149")
    assert len(window) == 100


def test_a_finished_sweep_does_not_start_over() -> None:
    items = _files(5)
    _, state = _run(None, items, 100)
    assert state["done"] is True

    window, again = _run(state, items, 100)
    assert window == []
    assert again == state


def test_after_finishing_only_new_items_are_read() -> None:
    items = _files(5)
    _, state = _run(None, items, 100)

    items += _files(2, start=5)
    window, state = _run(state, items, 100)
    assert window == [(6, "f0006"), (5, "f0005")]

    window, _ = _run(state, items, 100)
    assert window == []


def test_more_new_items_than_one_window_carries_on_down_to_old_ground() -> None:
    items = _files(10)
    _, state = _run(None, items, 100)  # everything covered

    items += _files(25, start=10)  # 25 new, window of 10
    seen: list[Item] = []
    for _ in range(3):
        window, state = _run(state, items, 10)
        seen += window

    # Newest first, each exactly once, and none of the old ten again.
    assert seen == sorted(_files(25, start=10), reverse=True)
    window, _ = _run(state, items, 10)
    assert window == []


def test_arrivals_during_a_catch_up_are_read_once_it_closes() -> None:
    items = _files(10)
    _, state = _run(None, items, 100)

    items += _files(15, start=10)
    first, state = _run(state, items, 10)
    assert first == sorted(_files(10, start=15), reverse=True)

    items += _files(3, start=25)
    second, state = _run(state, items, 10)
    # The gap is closed first, then what arrived above it.
    assert second == [
        *sorted(_files(5, start=10), reverse=True),
        *sorted(_files(3, start=25), reverse=True),
    ]
    assert _run(state, items, 10)[0] == []


def test_a_modified_item_counts_as_new() -> None:
    items = _files(5)
    _, state = _run(None, items, 100)

    items = [item for item in items if item != (2, "f0002")] + [(9, "f0002")]
    window, _ = _run(state, items, 100)
    assert window == [(9, "f0002")]


def test_deletions_do_not_skip_unread_items() -> None:
    items = _files(10)
    first, state = _run(None, items, 4)  # 9..6

    items = [item for item in items if item not in first[:2]]  # two read ones go
    second, _ = _run(state, items, 4)
    assert second == [(5, "f0005"), (4, "f0004"), (3, "f0003"), (2, "f0002")]


def test_late_arrival_at_the_head_rank_is_not_mistaken_for_covered() -> None:
    # Same-second upload whose key sorts below the newest one already read.
    items = [(5, "m"), (4, "a")]
    _, state = _run(None, items, 100)

    items.append((5, "b"))  # rank 5 again, but sorts below (5, "m")
    window, state = _run(state, items, 100)
    assert window == [(5, "b")]
    assert _run(state, items, 100)[0] == []


def test_a_rank_group_split_by_the_window_is_finished_exactly_once() -> None:
    items = [(7, f"k{i:02d}") for i in range(6)] + _files(4)
    seen: list[Item] = []
    state: Any = None
    for _ in range(5):
        window, state = _run(state, items, 4)
        seen += window
    assert sorted(seen) == sorted(items)
    assert len(seen) == len(set(seen))
    assert state["done"] is True


def test_edge_ids_fall_back_to_comparing_ids_when_too_many_share_a_rank() -> None:
    items = [(1, f"k{i:04d}") for i in range(MAX_EDGE_IDS + 50)]
    seen: list[Item] = []
    state: Any = None
    for _ in range(4):
        window, state = _run(state, items, MAX_EDGE_IDS + 10)
        seen += window
    assert state["head"]["ids"] is None
    assert sorted(seen) == sorted(items)
    assert len(seen) == len(set(seen))


def test_an_empty_listing_changes_nothing() -> None:
    frontier = ListFrontier()
    assert frontier.window([], 10) == []
    assert frontier.to_state() is None

    _, state = _run(None, _files(3), 2)
    window, after = _run(state, [], 2)
    assert window == []
    assert after == state


def test_the_old_integer_cursor_starts_fresh() -> None:
    frontier = ListFrontier(300)
    assert frontier.fresh
    assert frontier.window(_entries(_files(3)), 2) == [(2, "f0002"), (1, "f0001")]


@pytest.mark.parametrize(
    "state",
    [
        {"v": 1, "head": {"r": 1, "id": "a", "ids": []}, "tail": [0, "a"], "done": False},
        {"v": 2, "head": {"r": 1}, "tail": [0, "a"], "done": False},
        {"v": 2, "head": {"r": 1, "id": "a", "ids": []}, "tail": None, "done": False},
        {
            "v": 2,
            "head": {"r": 1, "id": "a", "ids": []},
            "tail": [1, "a"],
            "done": True,
            "top": {"r": 2, "id": "b", "ids": []},
        },
        "nonsense",
    ],
)
def test_an_unreadable_state_starts_fresh(state: Any) -> None:
    assert ListFrontier(state).fresh


def test_a_change_of_rank_type_starts_fresh() -> None:
    _, state = _run(None, _files(3), 10)
    frontier = ListFrontier(state)
    window = frontier.window([("2026-01-01", "a", "a"), ("2026-01-02", "b", "b")], 10)
    assert window == ["b", "a"]
    assert frontier.to_state()["head"]["r"] == "2026-01-02"


def test_partial_listing_below_the_tail_never_concludes() -> None:
    frontier = ListFrontier()
    frontier.window(_entries(_files(3)), 10, below_complete=False)
    assert frontier.done is False

    state = frontier.to_state()
    frontier = ListFrontier(state)
    assert frontier.window(_entries(_files(3)), 10, below_complete=True) == []
    assert frontier.done is True


@pytest.mark.parametrize("seed", range(40))
def test_random_histories_read_every_item_exactly_once(seed: int) -> None:
    """Arrivals, deletions and ties, against a model of what has been read.

    Whatever happens to the listing, an item that stays in it is read once and
    only once, new items come before the backfill, and the state stops
    changing once there is nothing left to read.
    """
    rng = random.Random(seed)
    budget = rng.randint(1, 7)
    clock = 10
    items: list[Item] = [(rng.randint(0, clock), f"i{n:04d}") for n in range(rng.randint(0, 30))]
    serial = len(items)
    read: list[Item] = []
    state: Any = None

    def step() -> list[Item]:
        nonlocal state
        window, state = _run(state, items, budget)
        assert len(window) <= budget
        for item in window:
            assert item in items
            assert item not in read, f"{item} read twice"
        read.extend(window)
        return window

    for _ in range(60):
        action = rng.random()
        if action < 0.45:
            # Arrivals never predate what is already there: a later arrival
            # has a later (or the same) rank. Ties are deliberately common.
            clock += rng.randint(0, 2)
            for _ in range(rng.randint(1, 2 * budget + 2)):
                serial += 1
                items.append((clock, f"i{rng.randint(0, 9999):04d}x{serial}"))
        elif action < 0.6 and items:
            for victim in rng.sample(items, k=min(len(items), rng.randint(1, 3))):
                items.remove(victim)

        frontier = ListFrontier(json.loads(json.dumps(state)))
        head_before = frontier.head_rank
        catching_up = frontier.catching_up
        unread_newer = [
            item
            for item in items
            if item not in read and head_before is not None and item[0] > head_before
        ]
        window = step()
        if unread_newer and not catching_up:
            # New ground is always read ahead of the backfill.
            assert window[0] == max(unread_newer)

    for _ in range(len(items) + 5):
        if not step():
            break
    assert sorted(read_item for read_item in read if read_item in items) == sorted(items)

    settled = state
    assert step() == []
    assert state == settled


# ── RangeFrontier ────────────────────────────────────────────────────────


class _Log:
    """A store of unique integer positions that serves newest-first ranges."""

    def __init__(self, positions: list[int]) -> None:
        self.positions = sorted(positions)

    def fetch(self, after: int | None, before: int | None, limit: int) -> list[int]:
        rows = [
            position
            for position in self.positions
            if (after is None or position > after) and (before is None or position < before)
        ]
        return sorted(rows, reverse=True)[:limit]


def _range_run(state: Any, log: _Log, budget: int) -> tuple[list[int], Any]:
    frontier = RangeFrontier(json.loads(json.dumps(state)))
    read: list[int] = []
    guard = 0
    while budget > 0 and (step := frontier.next_step()) is not None:
        guard += 1
        assert guard < 10, "range frontier did not settle"
        rows = log.fetch(step.after, step.before, budget)
        frontier.record(
            step,
            newest=rows[0] if rows else None,
            oldest=rows[-1] if rows else None,
            exhausted=len(rows) < budget,
        )
        read += rows
        budget -= len(rows)
    return read, frontier.to_state()


def test_range_first_run_reads_the_newest_then_backfills() -> None:
    log = _Log(list(range(10)))
    first, state = _range_run(None, log, 4)
    assert first == [9, 8, 7, 6]
    second, state = _range_run(state, log, 4)
    assert second == [5, 4, 3, 2]
    third, state = _range_run(state, log, 4)
    assert third == [1, 0]
    assert state["done"] is True
    assert _range_run(state, log, 4) == ([], state)


def test_range_new_rows_come_before_the_backfill() -> None:
    log = _Log(list(range(10)))
    _, state = _range_run(None, log, 4)
    log.positions += [10, 11]
    window, _ = _range_run(state, log, 4)
    assert window == [11, 10, 5, 4]


def test_range_catch_up_closes_the_gap_before_looking_higher() -> None:
    log = _Log(list(range(3)))
    _, state = _range_run(None, log, 10)
    log.positions += list(range(3, 12))  # nine new, window of four
    first, state = _range_run(state, log, 4)
    assert first == [11, 10, 9, 8]
    log.positions += [12]
    second, state = _range_run(state, log, 4)
    assert second == [7, 6, 5, 4]
    third, state = _range_run(state, log, 4)
    assert third == [3, 12]
    assert _range_run(state, log, 4)[0] == []


def test_range_empty_store_stays_fresh() -> None:
    read, state = _range_run(None, _Log([]), 4)
    assert read == []
    assert state is None


@pytest.mark.parametrize("seed", range(25))
def test_range_random_histories_read_every_row_exactly_once(seed: int) -> None:
    rng = random.Random(seed)
    budget = rng.randint(1, 6)
    log = _Log(list(range(rng.randint(0, 25))))
    next_position = len(log.positions)
    read: list[int] = []
    state: Any = None

    for _ in range(50):
        if rng.random() < 0.4:
            for _ in range(rng.randint(1, 2 * budget + 1)):
                log.positions.append(next_position)
                next_position += 1
        if rng.random() < 0.15 and log.positions:
            log.positions.remove(rng.choice(log.positions))
        window, state = _range_run(state, log, budget)
        assert not set(window) & set(read)
        read += window

    for _ in range(len(log.positions) + 5):
        window, state = _range_run(state, log, budget)
        assert not set(window) & set(read)
        read += window
        if not window:
            break
    assert sorted(position for position in read if position in log.positions) == log.positions


def test_items_that_surface_below_a_finished_sweep_are_still_read() -> None:
    # A directory that could not be listed last time, older than everything read.
    items = _files(5, start=10)
    _, state = _run(None, items, 100)
    assert state["done"] is True

    items += _files(3)
    window, state = _run(state, items, 100)
    assert window == [(2, "f0002"), (1, "f0001"), (0, "f0000")]
    assert state["done"] is True


# ── OrderedFrontier ──────────────────────────────────────────────────────


def _ordered_run(state: Any, listing: list[str], budget: int) -> tuple[list[str], Any]:
    frontier = OrderedFrontier(json.loads(json.dumps(state)))
    return frontier.window(list(listing), budget), frontier.to_state()


def test_ordered_first_run_then_backfill_then_nothing() -> None:
    listing = [f"v{n}" for n in range(9, -1, -1)]  # newest first
    first, state = _ordered_run(None, listing, 4)
    assert first == ["v9", "v8", "v7", "v6"]
    second, state = _ordered_run(state, listing, 4)
    assert second == ["v5", "v4", "v3", "v2"]
    third, state = _ordered_run(state, listing, 4)
    assert third == ["v1", "v0"]
    assert state["done"] is True
    assert _ordered_run(state, listing, 4) == ([], state)


def test_ordered_new_uploads_come_first() -> None:
    listing = [f"v{n}" for n in range(9, -1, -1)]
    _, state = _ordered_run(None, listing, 4)
    listing = ["v11", "v10", *listing]
    window, _ = _ordered_run(state, listing, 4)
    assert window == ["v11", "v10", "v5", "v4"]


def test_ordered_catch_up_closes_the_gap() -> None:
    listing = ["v2", "v1", "v0"]
    _, state = _ordered_run(None, listing, 10)
    listing = [f"n{n}" for n in range(8, -1, -1)] + listing
    first, state = _ordered_run(state, listing, 4)
    assert first == ["n8", "n7", "n6", "n5"]
    listing = ["z", *listing]
    second, state = _ordered_run(state, listing, 4)
    assert second == ["n4", "n3", "n2", "n1"]
    third, state = _ordered_run(state, listing, 4)
    assert third == ["n0", "z"]
    assert _ordered_run(state, listing, 4)[0] == []


def test_ordered_survives_a_deleted_boundary_item() -> None:
    listing = [f"v{n}" for n in range(9, -1, -1)]
    _, state = _ordered_run(None, listing, 4)  # v9..v6
    listing.remove("v9")  # the newest covered one is deleted
    listing.remove("v6")  # and the one the backfill stopped at
    listing = ["v10", *listing]
    window, _ = _ordered_run(state, listing, 4)
    assert window == ["v10", "v5", "v4", "v3"]


def test_ordered_losing_every_anchor_starts_over() -> None:
    listing = [f"v{n}" for n in range(3)]
    _, state = _ordered_run(None, listing, 10)
    window, _ = _ordered_run(state, ["a", "b"], 10)
    assert window == ["a", "b"]


@pytest.mark.parametrize("seed", range(25))
def test_ordered_random_histories_read_every_id_exactly_once(seed: int) -> None:
    rng = random.Random(seed)
    budget = rng.randint(1, 6)
    serial = rng.randint(0, 20)
    listing = [f"v{n}" for n in range(serial - 1, -1, -1)]
    read: list[str] = []
    state: Any = None

    for _ in range(50):
        if rng.random() < 0.4:
            for _ in range(rng.randint(1, 2 * budget + 1)):
                listing.insert(0, f"v{serial}")
                serial += 1
        if rng.random() < 0.15 and listing:
            # One deletion at a time: fewer than the anchors that mark a boundary.
            listing.remove(rng.choice(listing))
        window, state = _ordered_run(state, listing, budget)
        assert not set(window) & set(read)
        read += window

    for _ in range(len(listing) + 5):
        window, state = _ordered_run(state, listing, budget)
        assert not set(window) & set(read)
        read += window
        if not window:
            break
    assert sorted(ident for ident in read if ident in listing) == sorted(listing)


def test_an_incomplete_listing_above_the_head_does_not_move_it() -> None:
    items = _files(5)
    _, state = _run(None, items, 100)

    # Twelve new items exist; only the newest three were fetched.
    frontier = ListFrontier(state)
    window = frontier.window(_entries(_files(3, start=14)), 5, above_complete=False)
    assert window == [(16, "f0016"), (15, "f0015"), (14, "f0014")]
    assert frontier.head_rank == 4
    assert frontier.catching_up

    # The next run sees the rest of the gap and closes it.
    rest = _files(9, start=5)
    window = frontier.window(_entries(rest), 100)
    assert window == sorted(rest, reverse=True)
    assert frontier.head_rank == 16
    assert not frontier.catching_up
