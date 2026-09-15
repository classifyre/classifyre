"""``ctx.cohort()``: a resumable, banded walk over a large ordered universe."""

from __future__ import annotations

import random

import pytest

from src.notebook.cohort import normalize_bands, select_cohort, split_budget
from src.notebook.sdk import Asset, CohortItem, Context

UNIVERSE = [f"{n:06d}a" for n in range(1, 101)]  # sorted: 000001a .. 000100a


def keys(items: list[CohortItem], band: str | None = None) -> list[str]:
    return [item.key for item in items if band is None or item.band == band]


def test_the_budget_split_always_adds_up() -> None:
    for size in (0, 1, 7, 10, 99, 1200):
        shares = split_budget(size, {"newest": 60, "oldest": 30, "random": 10})
        assert sum(shares.values()) == size
    assert split_budget(10, {"newest": 60, "oldest": 30, "random": 10}) == {
        "newest": 6,
        "oldest": 3,
        "random": 1,
    }


@pytest.mark.parametrize(
    "bands", [{"sideways": 10}, {"newest": -1}, {"newest": 0}, {"oldest": "lots"}]
)
def test_bands_are_validated(bands: dict) -> None:
    with pytest.raises(ValueError):
        normalize_bands(bands)


def test_directional_bands_walk_from_opposite_ends_and_resume() -> None:
    weights = {"newest": 50, "oldest": 50}
    items, state, stats = select_cohort("r", UNIVERSE, weights=weights, size=10)
    assert keys(items, "newest") == ["000100a", "000099a", "000098a", "000097a", "000096a"]
    assert keys(items, "oldest") == ["000001a", "000002a", "000003a", "000004a", "000005a"]
    assert stats["newest"] == {"visited": 5, "exhausted": False}

    items, state, _ = select_cohort("r", UNIVERSE, weights=weights, size=10, state=state)
    assert keys(items, "newest")[0] == "000095a"
    assert keys(items, "oldest")[0] == "000006a"


def test_a_republished_universe_keeps_every_band_in_place() -> None:
    # Resuming by offset sent the Firmenbuch walk back to zero whenever the
    # extract was republished at a new length; resuming by last key does not.
    weights = {"oldest": 100}
    _, state, _ = select_cohort("r", UNIVERSE, weights=weights, size=10)
    grown = sorted([*UNIVERSE, "000000z", "000005b"])  # one before, one inside the walked range
    items, _, _ = select_cohort("r", grown, weights=weights, size=3, state=state)
    assert keys(items) == ["000011a", "000012a", "000013a"]


def test_a_band_that_reaches_the_end_says_so_and_wraps() -> None:
    weights = {"oldest": 100}
    items, state, stats = select_cohort("r", UNIVERSE, weights=weights, size=100)
    assert len(items) == 100
    assert stats["oldest"]["exhausted"] is True
    items, _, _ = select_cohort("r", UNIVERSE, weights=weights, size=2, state=state)
    assert keys(items) == ["000001a", "000002a"]


def test_random_keeps_no_cursor_and_bands_never_repeat_a_key() -> None:
    items, state, _ = select_cohort(
        "r",
        UNIVERSE[:10],
        weights={"newest": 50, "random": 50},
        size=10,
        rng=random.Random(7),
    )
    assert len(keys(items)) == len(set(keys(items)))
    assert "random" not in state["bands"]


def test_ctx_cohort_keeps_its_position_in_the_cursor_beside_the_notebooks() -> None:
    ctx = Context(cursor={"cohort": {"other": {"bands": {}}}, "feed": "2026-09-01"})
    items = ctx.cohort("register", UNIVERSE, bands={"newest": 100}, size=3)
    assert keys(items) == ["000100a", "000099a", "000098a"]
    cursor = ctx.next_cursor
    assert cursor is not None
    assert cursor["feed"] == "2026-09-01"  # the previous run's state is not dropped
    assert "other" in cursor["cohort"]
    assert cursor["cohort"]["register"]["bands"]["newest"]["last_key"] == "000098a"
    assert ctx.cohort_stats["register"]["bands"]["newest"]["visited"] == 3
    assert ctx.partial_coverage is True


def test_measured_weights_replace_the_declared_split() -> None:
    ctx = Context(cohort_weights={"register": {"oldest": 90, "newest": 10, "sideways": 99}})
    items = ctx.cohort("register", UNIVERSE, bands={"newest": 60, "oldest": 40}, size=10)
    assert len(keys(items, "oldest")) == 9
    assert ctx.cohort_stats["register"]["weightsUsed"] == {"oldest": 90.0, "newest": 10.0}
    assert ctx.cohort_stats["register"]["declared"] == {"newest": 60.0, "oldest": 40.0}


def test_an_asset_records_which_band_chose_it() -> None:
    item = CohortItem(key="000100a", band="newest", cohort="register")
    asset = Asset(id="company:000100a", metadata={"legal_form": "GES"}, cohort=item)
    assert asset.metadata["_cohort"] == {"name": "register", "band": "newest", "key": "000100a"}
    assert asset.metadata["legal_form"] == "GES"
    with pytest.raises(TypeError):
        Asset(id="x", cohort={"band": "newest"})  # type: ignore[arg-type]
