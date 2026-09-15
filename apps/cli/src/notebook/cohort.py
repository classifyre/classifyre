"""Choosing which slice of a large, ordered universe a run visits.

A connector that enumerates a big external universe -- every company number a
register has published, every ticket id, every object key -- cannot visit all
of it per run, and the order it walks decides what it finds. Walking company
numbers ascending walks registration order: on the Firmenbuch corpus that spent
74% of the budget on 1990s companies with a 2.8% yield before reaching 2020s
companies with 22.2%.

Bands buy three things from one budget, which no single ordering gives:

* ``newest`` walks down from the end of the sorted universe,
* ``oldest`` walks up from the start, so the long tail still advances,
* ``random`` samples without positional bias and keeps no cursor, so the yield
  of the unvisited middle stays measurable.

Each directional band resumes from the last key it visited, found by bisect,
not from an offset: a universe that is republished at a different length (the
OGD extract grew 326,479 -> 326,871 in a day, while a full pass takes sixty
hours) keeps every band's position instead of sending the walk back to zero.

Generalised from the shared cohort cell of the Firmenbuch notebooks, which
~300 lines of every such connector would otherwise rewrite.
"""

from __future__ import annotations

import bisect
import random
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

BANDS = ("newest", "oldest", "random")
DEFAULT_BANDS: dict[str, float] = {"newest": 60, "oldest": 30, "random": 10}


@dataclass(frozen=True)
class CohortItem:
    """One key a run should visit, and the band that chose it.

    Pass it to ``Asset(cohort=item)``: the band is recorded on the asset, which
    is how the platform measures what each band yields and shifts the split
    toward the productive ones.
    """

    key: str
    band: str
    cohort: str


def normalize_bands(bands: Mapping[str, Any] | None) -> dict[str, float]:
    """Band weights, validated. Unknown names and negative weights are errors."""
    raw = dict(DEFAULT_BANDS if bands is None else bands)
    weights: dict[str, float] = {}
    for name, weight in raw.items():
        band = str(name).strip().lower()
        if band not in BANDS:
            raise ValueError(f"Unknown cohort band {name!r}; use {', '.join(BANDS)}")
        try:
            value = float(weight)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Cohort band {band!r} needs a number, got {weight!r}") from exc
        if value < 0:
            raise ValueError(f"Cohort band {band!r} cannot be negative")
        if value > 0:
            weights[band] = value
    if not weights:
        raise ValueError("A cohort needs at least one band with a positive weight")
    return weights


def split_budget(size: int, weights: Mapping[str, float]) -> dict[str, int]:
    """Divide ``size`` across bands in proportion to their weights.

    Largest remainder, so the shares always add up to exactly ``size``: rounding
    each band on its own either loses visits or spends more than the budget.
    """
    size = max(0, int(size))
    total = sum(weights.values())
    if size == 0 or total <= 0:
        return dict.fromkeys(weights, 0)
    exact = {band: size * weight / total for band, weight in weights.items()}
    shares = {band: int(value) for band, value in exact.items()}
    remainder = size - sum(shares.values())
    order = sorted(
        weights, key=lambda band: (exact[band] - shares[band], weights[band]), reverse=True
    )
    for band in order[:remainder]:
        shares[band] += 1
    return shares


def _directional_slice(
    universe: Sequence[str],
    count: int,
    band: str,
    state: Mapping[str, Any] | None,
) -> tuple[list[str], dict[str, Any], bool]:
    """The next ``count`` keys of one directional band, its cursor, and whether it wrapped."""
    state = dict(state or {})
    size = len(universe)
    descending = band == "newest"

    offset = 0
    last_key = state.get("last_key")
    if isinstance(last_key, str) and last_key:
        offset = (
            size - bisect.bisect_left(universe, last_key)
            if descending
            else bisect.bisect_right(universe, last_key)
        )
    if not offset:
        try:
            offset = max(0, int(state.get("offset") or 0))
        except (TypeError, ValueError):
            offset = 0

    wrapped = False
    if offset >= size:
        offset, wrapped = 0, True

    if descending:
        end = size - offset
        picked = list(universe[max(0, end - count) : end])[::-1]
    else:
        picked = list(universe[offset : offset + count])

    next_offset = offset + len(picked)
    return (
        picked,
        {
            "offset": next_offset,
            "last_key": picked[-1] if picked else last_key,
            "covered_fraction": round(next_offset / size, 6) if size else 0.0,
        },
        wrapped or next_offset >= size,
    )


def select_cohort(
    name: str,
    universe: Iterable[Any],
    *,
    weights: Mapping[str, float],
    size: int,
    state: Mapping[str, Any] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[CohortItem], dict[str, Any], dict[str, Any]]:
    """Pick this run's cohort.

    Returns the items, the cursor state to keep for the next run, and per-band
    stats (``visited`` keys after dedup, and whether a directional band came to
    the end of the universe).
    """
    keys = sorted({str(key) for key in universe if str(key).strip()})
    rng = rng or random.Random()
    previous: Mapping[str, Any] = state if isinstance(state, Mapping) else {}
    raw_bands = previous.get("bands")
    band_state: Mapping[str, Any] = raw_bands if isinstance(raw_bands, Mapping) else {}

    items: list[CohortItem] = []
    seen: set[str] = set()
    next_bands: dict[str, Any] = dict(band_state)
    stats: dict[str, Any] = {}
    if not keys:
        return items, {"universe_size": 0, "bands": next_bands}, stats

    for band, share in split_budget(min(size, len(keys)), weights).items():
        if share <= 0:
            stats[band] = {"visited": 0, "exhausted": False}
            continue
        if band == "random":
            drawn = rng.sample(keys, min(share, len(keys)))
            exhausted = False
        else:
            drawn, next_bands[band], exhausted = _directional_slice(
                keys, share, band, band_state.get(band)
            )
        visited = 0
        for key in drawn:
            # Bands overlap once the cursors meet, and random can draw anything:
            # the budget goes to distinct keys.
            if key in seen:
                continue
            seen.add(key)
            items.append(CohortItem(key=key, band=band, cohort=name))
            visited += 1
        stats[band] = {"visited": visited, "exhausted": exhausted}

    return items, {"universe_size": len(keys), "bands": next_bands}, stats
