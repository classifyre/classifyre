"""Registry-driven conformance test for sampling-strategy support.

Invariant: every concrete source registered in ``src.sources`` must handle all
four sampling strategies (``AUTOMATIC``, ``RANDOM``, ``LATEST``, ``ALL``),
either by branching on ``SamplingStrategy`` itself or by inheriting a shared
base (``BaseTabularSource``, ``BaseSearchEngineSource``, the object-storage
base, ...) that already does so on its behalf. ``AUTOMATIC`` additionally
requires the source (or an ancestor) to participate in the cursor protocol
defined on ``BaseSource`` (``automatic_window``, ``automatic_offset``,
``record_automatic_offset``, ``_record_cursor_key``,
``set_next_sampling_cursor``, ``_automatic_fetch``, or reading
``self._sampling_cursor``) so that AUTOMATIC runs are incremental rather than
silently re-scanning (or ignoring) the same data every time.

Today this is enforced by convention only: a new source can implement
``test_connection``/``extract_raw`` and never look at ``recipe["optional"]
["sampling"]`` at all, and nothing would catch it. This test fails loudly
when that happens — implement the strategy branching yourself, or inherit a
base class that already does, or (if the gap is real and tracked) add the
source to ``KNOWN_STRATEGY_BRANCHING_GAPS`` / ``KNOWN_AUTOMATIC_CURSOR_GAPS``
below with a reason and a tracking note.

Purely static: sources are imported (via the normal registry discovery path,
the same one ``get_source`` uses) so we can walk each class's MRO, but no
source is instantiated and no network/DB/API calls are made.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path
from typing import NamedTuple

import pytest

from src.sources import BaseSource, _discover_sources, _registry

# ---------------------------------------------------------------------------
# Known gaps
# ---------------------------------------------------------------------------
#
# Sources listed here are known to violate one of the invariants below. They
# are xfail'd (not silently skipped) so the gap stays visible in test output
# and CI summaries. Remove the entry once the source is fixed; if it stops
# failing on its own, this test will flag it as an "unexpectedly passing"
# xfail so the stale entry gets noticed and removed.
# Keyed per invariant (not per source) since a source can fail one invariant
# while satisfying the other — e.g. a source can have a real AUTOMATIC cursor
# but still fail to distinguish RANDOM from LATEST.
KNOWN_STRATEGY_BRANCHING_GAPS: dict[str, str] = {}

KNOWN_AUTOMATIC_CURSOR_GAPS: dict[str, str] = {
    # Populate only if the corresponding invariant test still fails for a
    # source after a real run — see test_source_implements_automatic_cursor.
}


# ---------------------------------------------------------------------------
# Discovery helpers
# ---------------------------------------------------------------------------


class _SourceEntry(NamedTuple):
    source_type: str
    source_class: type[BaseSource]


def _discovered_sources() -> list[_SourceEntry]:
    """All concrete source classes known to the registry, sorted by type."""
    _discover_sources()
    return [_SourceEntry(source_type, cls) for source_type, cls in sorted(_registry.items())]


def _ancestor_source_files(cls: type[BaseSource]) -> list[Path]:
    """Files for *cls* and every non-``BaseSource`` ancestor under ``src.sources``.

    This is what makes the test registry-driven rather than per-file: a
    source that inherits from e.g. ``BaseTabularSource`` or
    ``BaseSearchEngineSource`` gets credit for the strategy/cursor handling
    implemented once in that shared base, while a source with no such base
    (e.g. a bespoke API-backed connector) must implement it itself.
    """
    files: dict[str, Path] = {}
    for ancestor in inspect.getmro(cls):
        if ancestor is BaseSource:
            continue
        module = ancestor.__module__
        if not (module == "src.sources" or module.startswith("src.sources.")):
            continue
        try:
            source_file = inspect.getsourcefile(ancestor)
        except TypeError:
            continue
        if source_file:
            files[source_file] = Path(source_file)
    return list(files.values())


def _combined_source_text(cls: type[BaseSource]) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in _ancestor_source_files(cls))


# ---------------------------------------------------------------------------
# Static patterns
# ---------------------------------------------------------------------------

# Shared entry points that already implement full strategy branching
# (AUTOMATIC/RANDOM/LATEST/ALL) internally: crediting a call/definition site
# is enough, the callee's own conformance is exercised by whichever source
# actually defines it (tabular_base.py, search_engine_base.py, ...).
_STRATEGY_ENTRY_POINT_RE = re.compile(
    r"\b(_build_sampling_query|_automatic_fetch|automatic_window)\b"
)

# Direct SamplingStrategy member references, e.g. `SamplingStrategy.RANDOM`.
_SAMPLING_STRATEGY_MEMBER_RE = re.compile(r"SamplingStrategy\.(\w+)")

# Cursor primitives from BaseSource that participate in the AUTOMATIC
# incremental-cursor protocol (see base.py "AUTOMATIC sampling cursor").
_CURSOR_PRIMITIVE_RE = re.compile(
    r"\b(automatic_window|automatic_offset|record_automatic_offset|_record_cursor_key|"
    r"set_next_sampling_cursor|_automatic_fetch)\b"
    r"|self\._sampling_cursor\b"
)


def _has_strategy_branching(text: str) -> bool:
    """True if *text* branches on sampling strategy or delegates to a base that does."""
    if _STRATEGY_ENTRY_POINT_RE.search(text):
        return True
    members = set(_SAMPLING_STRATEGY_MEMBER_RE.findall(text))
    # Require ALL plus at least one of RANDOM/LATEST: a source that only ever
    # checks `== SamplingStrategy.ALL` (or only AUTOMATIC) hasn't actually
    # branched on the strategy, it has ignored it.
    if "ALL" in members and bool(members & {"RANDOM", "LATEST"}):
        return True
    # Some sources handle ALL implicitly as the "no extra filtering" fallthrough
    # once RANDOM and LATEST are both branched on explicitly (e.g. kafka picks a
    # start offset per strategy and simply reads from the earliest retained
    # offset when neither RANDOM nor LATEST applies). Explicit RANDOM *and*
    # LATEST handling is still strong evidence of real per-strategy branching.
    return {"RANDOM", "LATEST"}.issubset(members)


def _has_automatic_cursor(text: str) -> bool:
    """True if *text* participates in the AUTOMATIC incremental-cursor protocol."""
    return bool(_CURSOR_PRIMITIVE_RE.search(text))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

_SOURCES = _discovered_sources()
_SOURCE_IDS = [entry.source_type for entry in _SOURCES]


def _params(known_gaps: dict[str, str]) -> list[pytest.param]:
    """Build parametrize entries, xfail'ing (strictly) sources in *known_gaps*."""
    params = []
    for entry in _SOURCES:
        marks = []
        reason = known_gaps.get(entry.source_type)
        if reason is not None:
            marks.append(pytest.mark.xfail(reason=f"{entry.source_type}: {reason}", strict=True))
        params.append(pytest.param(entry, id=entry.source_type, marks=marks))
    return params


def test_registry_discovers_sources() -> None:
    """Sanity check: the registry must actually find concrete sources.

    If this fails, the two conformance tests below are vacuously trivial
    (parametrized over an empty list), which would silently defeat the whole
    point of this file.
    """
    assert len(_SOURCES) >= 20, (
        f"Expected many registered source types, found {len(_SOURCES)}: "
        f"{_SOURCE_IDS}. Source discovery in src/sources/__init__.py may be broken."
    )


@pytest.mark.parametrize("entry", _params(KNOWN_STRATEGY_BRANCHING_GAPS))
def test_source_implements_strategy_branching(entry: _SourceEntry) -> None:
    """Every concrete source must branch on sampling strategy (itself or via a base).

    Fails when a source (and every non-BaseSource ancestor) never references
    ``SamplingStrategy.ALL`` together with ``RANDOM``/``LATEST``, and never
    calls a shared strategy entry point (``_build_sampling_query``,
    ``_automatic_fetch``, ``automatic_window``). Implement the branching
    directly, or inherit a base class that already does.
    """
    text = _combined_source_text(entry.source_class)
    assert _has_strategy_branching(text), (
        f"Source '{entry.source_type}' ({entry.source_class.__qualname__}) does not appear "
        "to branch on sampling strategy (no SamplingStrategy.ALL + RANDOM/LATEST reference, "
        "no shared strategy entry-point call) in itself or its ancestors: "
        f"{[str(p) for p in _ancestor_source_files(entry.source_class)]}. "
        "Implement strategy branching for AUTOMATIC/RANDOM/LATEST/ALL, or inherit a base "
        "(BaseTabularSource, BaseSearchEngineSource, object_storage.base, ...) that does."
    )


@pytest.mark.parametrize("entry", _params(KNOWN_AUTOMATIC_CURSOR_GAPS))
def test_source_implements_automatic_cursor(entry: _SourceEntry) -> None:
    """Every concrete source must participate in the AUTOMATIC cursor protocol.

    Fails when a source (and every non-BaseSource ancestor) never calls one of
    the ``BaseSource`` cursor primitives (``automatic_window``,
    ``automatic_offset``, ``record_automatic_offset``, ``_record_cursor_key``,
    ``set_next_sampling_cursor``, ``_automatic_fetch``) and never reads
    ``self._sampling_cursor``. Without this, AUTOMATIC sampling cannot be
    incremental: each run would re-scan (or silently ignore) the same slice
    of data forever.
    """
    text = _combined_source_text(entry.source_class)
    assert _has_automatic_cursor(text), (
        f"Source '{entry.source_type}' ({entry.source_class.__qualname__}) does not appear to "
        "use any AUTOMATIC cursor primitive (automatic_window/automatic_offset/"
        "record_automatic_offset/_record_cursor_key/set_next_sampling_cursor/_automatic_fetch, "
        "or self._sampling_cursor) in itself or its ancestors: "
        f"{[str(p) for p in _ancestor_source_files(entry.source_class)]}. "
        "AUTOMATIC sampling needs a real incremental cursor — see base.py's "
        "'AUTOMATIC sampling cursor' section for the available primitives."
    )


# ---------------------------------------------------------------------------
# Payload windows
# ---------------------------------------------------------------------------
#
# ``BaseSource.iter_asset_pages`` is where a tabular payload is bounded to one
# window of rows, and it can only find the stored position if the caller says
# which asset the bytes belong to. A source that calls it without ``asset_id``
# still works — it just reads the whole file every run, which is the failure this
# whole mechanism exists to prevent, and it fails silently. So the call sites are
# checked statically rather than left to convention.


@pytest.mark.parametrize("entry", _params({}))
def test_iter_asset_pages_calls_identify_the_asset(entry: _SourceEntry) -> None:
    text = _combined_source_text(entry.source_class)
    for call in re.finditer(r"\.iter_asset_pages\s*\(", text):
        body = _balanced_call_args(text, call.end() - 1)
        assert "asset_id" in body, (
            f"Source '{entry.source_type}' ({entry.source_class.__qualname__}) calls "
            "iter_asset_pages() without asset_id=. Without it the payload window cannot "
            "resolve this asset's stored cursor, so every run re-reads the whole file "
            "from row 0 — the exact behaviour payload windows exist to avoid. Pass the "
            "same identifier the source uses for fetch_content_bytes()."
        )


def _balanced_call_args(text: str, open_paren: int) -> str:
    """The argument text of the call whose ``(`` is at *open_paren*."""
    depth = 0
    for index in range(open_paren, len(text)):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                return text[open_paren + 1 : index]
    return text[open_paren:]


# ---------------------------------------------------------------------------
# Scan-cache eligibility
# ---------------------------------------------------------------------------
#
# Opting into the scan cache is a correctness claim, not a performance tweak:
# it asserts that an unchanged ``checksum`` genuinely proves the payload is
# unchanged. That holds for files, whose identity is their bytes. It does not
# hold for a database row or a paged API response, which can change under the
# same key with nothing in the metadata to compare — caching those would
# silently under-scan, and nothing at runtime would say so.
#
# Adding a source here is the deliberate step that makes the claim reviewable.
SCAN_CACHE_ELIGIBLE_SOURCE_TYPES: frozenset[str] = frozenset(
    {
        "local_folder",
        "s3_compatible_storage",
        "google_cloud_storage",
        "azure_blob_storage",
        "dropbox",
        # Hub file entries carry a content-derived digest: the Git LFS SHA-256 for
        # LFS-backed files (every large data file) and the Git blob OID otherwise.
        "hugging_face",
        # Every tree entry carries the Git blob OID, which is a hash of the
        # file's contents — an unchanged OID is proof the bytes are unchanged.
        "git",
        "sandbox",
        "google_workspace",
        "microsoft_365",
        "email",
    }
)


@pytest.mark.parametrize("entry", _params({}))
def test_scan_cache_opt_in_is_declared(entry: _SourceEntry) -> None:
    """A source may only enable the scan cache if it is on the reviewed list.

    Catches the silent-widening failure: a new connector inherits from
    ``ObjectStorageSourceBase`` (which opts in) without anyone checking that its
    provider actually reports a content-derived digest, and starts skipping
    assets whose bytes changed.
    """
    opted_in = bool(getattr(entry.source_class, "SUPPORTS_SCAN_CACHE", False))
    expected = entry.source_type in SCAN_CACHE_ELIGIBLE_SOURCE_TYPES
    assert opted_in == expected, (
        f"Source '{entry.source_type}' ({entry.source_class.__qualname__}) has "
        f"SUPPORTS_SCAN_CACHE={opted_in} but the reviewed list says {expected}. "
        "If this source's checksum genuinely proves its content is unchanged, add it to "
        "SCAN_CACHE_ELIGIBLE_SOURCE_TYPES; otherwise set SUPPORTS_SCAN_CACHE = False on "
        "the class (it may be inheriting the opt-in from a base)."
    )


@pytest.mark.parametrize("entry", _params({}))
def test_scan_cache_verify_mode_is_valid(entry: _SourceEntry) -> None:
    """The declared verification strength must be one the cache understands.

    A typo here would silently fall back to the strict mode rather than fail,
    so assert it directly.
    """
    verify = getattr(entry.source_class, "SCAN_CACHE_VERIFY", "content")
    assert verify in {"metadata", "content"}, (
        f"Source '{entry.source_type}' declares SCAN_CACHE_VERIFY={verify!r}; "
        "expected 'metadata' (provider supplies a content-derived digest) or "
        "'content' (hash the bytes before trusting the cache)."
    )
