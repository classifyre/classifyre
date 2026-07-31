"""Tests for the scan cache: when an asset may be skipped, and what it records.

The failure that matters here is not "we did redundant work" — it is "we skipped
work we needed to do and nobody noticed". Every test below is written from that
side: a false *miss* costs one run, a false *hit* silently under-scans.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.detectors.engine_version import (
    DETECTOR_ENGINE_VERSION,
    NON_CACHEABLE_DETECTOR_TYPES,
    detector_engine_version,
    is_cacheable_detector_type,
)
from src.pipeline.payload_window import PayloadWindowStore
from src.pipeline.scan_cache import (
    ScanCache,
    detector_cache_key,
    detector_fingerprint,
)


class _FakeAsset:
    def __init__(self, hash_: str, checksum: str, external_url: str = "") -> None:
        self.hash = hash_
        self.checksum = checksum
        self.external_url = external_url
        self.name = hash_


class _FakeSource:
    SUPPORTS_SCAN_CACHE = True
    SCAN_CACHE_VERIFY = "metadata"

    def __init__(self, payloads: dict[str, bytes] | None = None) -> None:
        self._payloads = payloads or {}
        self.fetch_calls: list[str] = []

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        self.fetch_calls.append(asset_id)
        payload = self._payloads.get(asset_id)
        return (payload, "text/plain") if payload is not None else None


def _recipe(detectors: list[dict[str, Any]] | None = None, **extra: Any) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "type": "LOCAL_FOLDER",
        "sampling": {"strategy": "ALL"},
        "scan_cache": {"enabled": True, "verify": "auto"},
        "detectors": detectors if detectors is not None else [{"type": "PII", "enabled": True}],
    }
    recipe.update(extra)
    return recipe


def _entry(asset_hash: str, detectors: dict[str, str], **extra: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "hash": asset_hash,
        "checksum": "checksum-1",
        "contentHash": None,
        "scopeFingerprint": None,
        "detectors": detectors,
    }
    entry.update(extra)
    return entry


def _fingerprints(recipe: dict[str, Any]) -> dict[str, str]:
    """The fingerprints this recipe would produce, as ScanCache computes them."""
    cache = ScanCache(recipe, _FakeSource())
    return dict(cache._cacheable)


# ---------------------------------------------------------------------------
# Fingerprinting
# ---------------------------------------------------------------------------


def test_fingerprint_is_stable_across_key_ordering() -> None:
    """Dict ordering must not change the fingerprint, or nothing ever caches."""
    shape = {"optional": {"a": 1, "b": 2}}
    first = detector_fingerprint("PII", {"x": 1, "y": {"p": 1, "q": 2}}, shape)
    second = detector_fingerprint("PII", {"y": {"q": 2, "p": 1}, "x": 1}, dict(shape))
    assert first == second


def test_rotating_a_credential_does_not_invalidate_the_cache() -> None:
    """A secret rotation must not force a corpus-wide rescan.

    The API injects live provider credentials into detector config at dispatch
    time, so hashing them verbatim would invalidate every asset whenever a key
    is rotated — an expensive no-op.
    """
    base = {
        "custom_detector_key": "llm-pii",
        "pipeline_schema": {
            "type": "LLM",
            "provider_runtime": {
                "provider": "anthropic",
                "model": "claude-opus-5",
                "api_key": "sk-old",
                "base_url": None,
            },
        },
    }
    rotated = {
        **base,
        "pipeline_schema": {
            **base["pipeline_schema"],
            "provider_runtime": {
                **base["pipeline_schema"]["provider_runtime"],
                "api_key": "sk-new",
            },
        },
    }
    shape: dict[str, Any] = {}
    assert detector_fingerprint("CUSTOM", base, shape) == detector_fingerprint(
        "CUSTOM", rotated, shape
    )


def test_changing_the_model_does_invalidate_the_cache() -> None:
    """Non-secret provider settings change what the detector reports."""
    base = {
        "pipeline_schema": {
            "type": "LLM",
            "provider_runtime": {"model": "claude-opus-5", "api_key": "sk-1"},
        }
    }
    swapped = {
        "pipeline_schema": {
            "type": "LLM",
            "provider_runtime": {"model": "claude-sonnet-5", "api_key": "sk-1"},
        }
    }
    shape: dict[str, Any] = {}
    assert detector_fingerprint("CUSTOM", base, shape) != detector_fingerprint(
        "CUSTOM", swapped, shape
    )


def test_feedback_examples_invalidate_the_cache() -> None:
    """Classifier feedback changes predictions, so it must change the fingerprint."""
    shape: dict[str, Any] = {}
    without = {"method": "CLASSIFIER", "examples": []}
    with_examples = {"method": "CLASSIFIER", "examples": [{"label": "pii", "text": "a"}]}
    assert detector_fingerprint("CUSTOM", without, shape) != detector_fingerprint(
        "CUSTOM", with_examples, shape
    )


def test_content_shaping_settings_invalidate_the_cache() -> None:
    """The same detector over truncated content is not the same scan."""
    config: dict[str, Any] = {}
    small = {"optional": {"traversal": {"max_file_bytes": 1024}}}
    large = {"optional": {"traversal": {"max_file_bytes": 10_485_760}}}
    assert detector_fingerprint("PII", config, small) != detector_fingerprint("PII", config, large)


def test_engine_version_bump_invalidates_one_detector(monkeypatch: pytest.MonkeyPatch) -> None:
    """Shipping new detector rules must re-scan for that detector alone."""
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    before = _fingerprints(recipe)

    monkeypatch.setitem(DETECTOR_ENGINE_VERSION, "PII", detector_engine_version("PII") + 1)
    after = _fingerprints(recipe)

    assert before["PII"] != after["PII"]
    assert before["SECRETS"] == after["SECRETS"]


def test_custom_detectors_get_distinct_cache_keys() -> None:
    """Two custom detectors both report type CUSTOM; the key must separate them."""
    assert detector_cache_key("CUSTOM", {"custom_detector_key": "a"}) == "CUSTOM::a"
    assert detector_cache_key("CUSTOM", {"custom_detector_key": "b"}) == "CUSTOM::b"
    assert detector_cache_key("PII", {}) == "PII"


def test_switching_strategy_invalidates_the_cache() -> None:
    """Results banked over the top 100 rows say nothing about the rest."""
    latest = _fingerprints(_recipe(sampling={"strategy": "LATEST", "rows_per_page": 100}))
    automatic = _fingerprints(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 100}))
    assert latest["PII"] != automatic["PII"]


# ---------------------------------------------------------------------------
# Payload windows
#
# The cache's case for skipping is "the checksum did not move". For an asset
# being read a window at a time that is true and irrelevant: the file is
# unchanged and most of it has still never been scanned.
# ---------------------------------------------------------------------------


def _payload_store(strategy: str, cursor: dict[str, Any] | None = None) -> PayloadWindowStore:
    store = PayloadWindowStore(strategy, 100)
    asset = _FakeAsset("h1", "checksum-1")
    asset.name = "events.parquet"
    store.bind(asset)
    if cursor is not None:
        store.record_prior([{"hash": "h1", "cursor": cursor}])
    return store


def _tabular_asset() -> _FakeAsset:
    asset = _FakeAsset("h1", "checksum-1")
    asset.name = "events.parquet"
    return asset


@pytest.mark.asyncio
async def test_part_swept_payload_is_never_skipped() -> None:
    """The regression this guards: 4.9M unread rows reported as "cached"."""
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 100})
    store = _payload_store(
        "AUTOMATIC", {"v": 1, "offset": 100, "exhausted": False, "checksum": "checksum-1"}
    )
    cache = ScanCache(recipe, _FakeSource(), payload_windows=store)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_tabular_asset())

    assert plan.mode == "full"
    assert "payload" in plan.reason


@pytest.mark.asyncio
async def test_fully_swept_payload_is_skipped_again() -> None:
    """Once a pass covers the file, an unchanged checksum means what it says."""
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 100})
    store = _payload_store(
        "AUTOMATIC",
        {"v": 1, "offset": 0, "passes": 1, "exhausted": True, "checksum": "checksum-1"},
    )
    cache = ScanCache(recipe, _FakeSource(), payload_windows=store)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_tabular_asset())

    assert plan.mode == "skip"


@pytest.mark.asyncio
async def test_first_sighting_of_a_tabular_asset_is_never_skipped() -> None:
    """No cursor yet means no pass has covered the file."""
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 100})
    cache = ScanCache(recipe, _FakeSource(), payload_windows=_payload_store("AUTOMATIC"))
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert (await cache.plan(_tabular_asset())).mode == "full"


@pytest.mark.asyncio
async def test_random_sampling_always_rescans_a_tabular_asset() -> None:
    """A fresh sample every run is the point of RANDOM."""
    recipe = _recipe(sampling={"strategy": "RANDOM", "rows_per_page": 100})
    store = _payload_store(
        "RANDOM", {"v": 1, "offset": 0, "exhausted": True, "checksum": "checksum-1"}
    )
    cache = ScanCache(recipe, _FakeSource(), payload_windows=store)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert (await cache.plan(_tabular_asset())).mode == "full"


@pytest.mark.asyncio
async def test_payload_window_does_not_disturb_non_tabular_assets() -> None:
    """A PDF has no rows left over; it stays skippable."""
    recipe = _recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 100})
    store = PayloadWindowStore("AUTOMATIC", 100)
    pdf = _FakeAsset("h1", "checksum-1")
    pdf.name = "report.pdf"
    store.bind(pdf)

    cache = ScanCache(recipe, _FakeSource(), payload_windows=store)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert (await cache.plan(pdf)).mode == "skip"


@pytest.mark.asyncio
async def test_all_strategy_leaves_the_cache_alone() -> None:
    """ALL reads the whole payload every run, so nothing is ever left over."""
    recipe = _recipe(sampling={"strategy": "ALL"})
    cache = ScanCache(recipe, _FakeSource(), payload_windows=_payload_store("ALL"))
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert (await cache.plan(_tabular_asset())).mode == "skip"


@pytest.mark.asyncio
async def test_cache_without_a_payload_store_behaves_as_before() -> None:
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert (await cache.plan(_tabular_asset())).mode == "skip"


# ---------------------------------------------------------------------------
# The skip decision
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unchanged_asset_with_unchanged_detectors_is_skipped() -> None:
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    assert plan.mode == "skip"
    assert cache.skipped_detector_runs(plan) == 1


@pytest.mark.asyncio
async def test_changed_checksum_forces_a_full_run() -> None:
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_FakeAsset("h1", "checksum-2"))

    assert plan.mode == "full"
    assert "checksum" in plan.reason


@pytest.mark.asyncio
async def test_asset_without_prior_state_runs_in_full() -> None:
    """No entry means new *or* last scan never finished. Both must re-run."""
    cache = ScanCache(_recipe(), _FakeSource())
    cache.record_prior([])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    assert plan.mode == "full"


@pytest.mark.asyncio
async def test_scope_change_forces_a_full_run() -> None:
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource(), scope_fingerprint="scope-b")
    cache.record_prior([_entry("h1", _fingerprints(recipe), scopeFingerprint="scope-a")])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    assert plan.mode == "full"
    assert "scope" in plan.reason


@pytest.mark.asyncio
async def test_only_the_changed_detector_re_runs() -> None:
    """The whole point: editing one detector must not re-scan for the others."""
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    prior = _fingerprints(recipe)

    changed = _recipe(
        [
            {"type": "PII", "enabled": True, "config": {"confidence_threshold": 0.9}},
            {"type": "SECRETS", "enabled": True},
        ]
    )
    cache = ScanCache(changed, _FakeSource())
    cache.record_prior([_entry("h1", prior)])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    assert plan.mode == "partial"
    assert plan.run_detector_keys == frozenset({"PII"})
    assert set(plan.carried_detectors) == {"SECRETS"}
    assert cache.skipped_detector_runs(plan) == 1


@pytest.mark.asyncio
async def test_broken_links_always_runs() -> None:
    """Link health changes without the document changing, so it is never cached."""
    assert "BROKEN_LINKS" in NON_CACHEABLE_DETECTOR_TYPES
    assert not is_cacheable_detector_type("BROKEN_LINKS")

    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "BROKEN_LINKS", "enabled": True}])
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    assert plan.mode == "partial"
    assert plan.run_detector_keys == frozenset({"BROKEN_LINKS"})


@pytest.mark.asyncio
async def test_disabled_detectors_are_not_fingerprinted() -> None:
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": False}])
    assert set(_fingerprints(recipe)) == {"PII"}


@pytest.mark.asyncio
async def test_unsupported_source_never_caches() -> None:
    class _Tabularish(_FakeSource):
        SUPPORTS_SCAN_CACHE = False

    recipe = _recipe()
    cache = ScanCache(recipe, _Tabularish())
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    assert not cache.enabled
    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    assert plan.mode == "full"


@pytest.mark.asyncio
async def test_force_full_rescan_env_disables_the_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLASSIFYRE_FORCE_FULL_RESCAN", "1")
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    assert not cache.enabled


@pytest.mark.asyncio
async def test_recipe_can_disable_the_cache() -> None:
    recipe = _recipe()
    recipe["scan_cache"] = {"enabled": False}
    assert not ScanCache(recipe, _FakeSource()).enabled


# ---------------------------------------------------------------------------
# Content verification (tier 2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_content_verify_skips_when_the_digest_matches() -> None:
    """mtime can lie; the digest is what proves the bytes are the same."""
    payload = b"hello world"
    source = _FakeSource({"file:///a.txt": payload})
    source.SCAN_CACHE_VERIFY = "content"

    recipe = _recipe()
    cache = ScanCache(recipe, source)
    import hashlib

    cache.record_prior(
        [
            _entry(
                "h1",
                _fingerprints(recipe),
                contentHash=hashlib.sha256(payload).hexdigest(),
            )
        ]
    )

    plan = await cache.plan(_FakeAsset("h1", "checksum-1", "file:///a.txt"))

    assert plan.mode == "skip"


@pytest.mark.asyncio
async def test_content_verify_runs_when_bytes_changed_under_an_equal_checksum() -> None:
    """The exact case a metadata-only gate would get wrong.

    Same reported checksum (a size-preserving edit under a preserved mtime),
    different bytes. Skipping here would silently under-scan.
    """
    source = _FakeSource({"file:///a.txt": b"goodbye wrld"})
    source.SCAN_CACHE_VERIFY = "content"

    recipe = _recipe()
    cache = ScanCache(recipe, source)
    import hashlib

    cache.record_prior(
        [
            _entry(
                "h1",
                _fingerprints(recipe),
                contentHash=hashlib.sha256(b"hello world").hexdigest(),
            )
        ]
    )

    plan = await cache.plan(_FakeAsset("h1", "checksum-1", "file:///a.txt"))

    assert plan.mode == "full"
    assert "content hash" in plan.reason


@pytest.mark.asyncio
async def test_content_verify_runs_when_no_digest_was_ever_recorded() -> None:
    source = _FakeSource({"file:///a.txt": b"x"})
    source.SCAN_CACHE_VERIFY = "content"

    recipe = _recipe()
    cache = ScanCache(recipe, source)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1", "file:///a.txt"))

    assert plan.mode == "full"


@pytest.mark.asyncio
async def test_content_verify_runs_when_bytes_are_unavailable() -> None:
    source = _FakeSource({})
    source.SCAN_CACHE_VERIFY = "content"

    recipe = _recipe()
    cache = ScanCache(recipe, source)
    cache.record_prior([_entry("h1", _fingerprints(recipe), contentHash="deadbeef")])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1", "file:///gone.txt"))

    assert plan.mode == "full"


@pytest.mark.asyncio
async def test_metadata_verify_never_downloads() -> None:
    """A provider-supplied digest is proof enough; paying for bytes defeats it."""
    source = _FakeSource({"file:///a.txt": b"x"})
    recipe = _recipe()
    cache = ScanCache(recipe, source)
    cache.record_prior([_entry("h1", _fingerprints(recipe))])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1", "file:///a.txt"))

    assert plan.mode == "skip"
    assert source.fetch_calls == []
    assert not cache.tracks_content_hash


# ---------------------------------------------------------------------------
# What gets persisted
# ---------------------------------------------------------------------------


class _Outcome:
    def __init__(self, detector_type: str, status: str, custom_key: str | None = None) -> None:
        self.detector_type = detector_type
        self.status = status
        self.custom_detector_key = custom_key


class _Stats:
    empty_text = False
    text_extraction_status = "EXTRACTED"


@pytest.mark.asyncio
async def test_errored_detector_is_not_recorded_so_it_retries() -> None:
    """A detector that raised produced no result — never bank it as success."""
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[_Outcome("PII", "OK"), _Outcome("SECRETS", "ERROR")],
        scan_stats=_Stats(),
        findings_total=3,
    )

    assert state is not None
    assert state["complete"] is True
    assert "PII" in state["detectors"]
    assert "SECRETS" not in state["detectors"]


@pytest.mark.asyncio
async def test_detector_that_reported_no_outcome_is_still_recorded() -> None:
    """A detector that does not apply to this content type will not apply next
    time either. Withholding it would keep the asset permanently uncacheable."""
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior([])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[_Outcome("PII", "OK")],
        scan_stats=_Stats(),
    )

    assert state is not None
    assert set(state["detectors"]) == {"PII", "SECRETS"}


@pytest.mark.asyncio
async def test_detector_that_failed_to_initialize_is_not_recorded() -> None:
    """No runtime outcome exists for an initialization failure, so the cache
    must use the pipeline's successfully initialized keys as the authority."""
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    cache = ScanCache(recipe, _FakeSource())
    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[_Outcome("PII", "OK")],
        scan_stats=_Stats(),
        available_detector_keys=frozenset({"PII"}),
    )

    assert state is not None
    assert set(state["detectors"]) == {"PII"}


@pytest.mark.asyncio
async def test_incomplete_extraction_writes_non_reusable_tombstone() -> None:
    """Omitting state would leave an older successful entry reusable."""

    class _FailedStats:
        empty_text = True
        text_extraction_status = "ENGINE_UNAVAILABLE"

    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[],
        scan_stats=_FailedStats(),
    )

    assert state is not None
    assert state["complete"] is False
    assert state["detectors"] == {}


@pytest.mark.asyncio
async def test_failed_chunk_write_writes_non_reusable_tombstone() -> None:
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))

    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[_Outcome("PII", "OK")],
        scan_stats=_Stats(),
        completed=False,
    )

    assert state is not None
    assert state["complete"] is False
    assert state["detectors"] == {}


@pytest.mark.asyncio
async def test_partial_run_merges_carried_and_fresh_fingerprints() -> None:
    recipe = _recipe([{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}])
    prior = _fingerprints(recipe)

    changed = _recipe(
        [
            {"type": "PII", "enabled": True, "config": {"confidence_threshold": 0.9}},
            {"type": "SECRETS", "enabled": True},
        ]
    )
    cache = ScanCache(changed, _FakeSource())
    cache.record_prior([_entry("h1", prior)])

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=[_Outcome("PII", "OK")],
        scan_stats=_Stats(),
    )

    assert state is not None
    assert state["detectors"] == _fingerprints(changed)


@pytest.mark.asyncio
async def test_skipped_asset_carries_the_previous_run_statistics() -> None:
    """A skipped asset has no statistics of its own; zeroing them would make a
    fully cached run look like every finding vanished."""
    recipe = _recipe()
    cache = ScanCache(recipe, _FakeSource())
    cache.record_prior(
        [
            _entry(
                "h1",
                _fingerprints(recipe),
                findingsTotal=7,
                findingsBySeverity={"HIGH": 7},
                findingsByDetector={"PII": {"total": 7}},
                emptyText=False,
                textExtractionStatus="EXTRACTED",
            )
        ]
    )

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    state = cache.build_state(plan, content_hash=None, detector_outcomes=[])

    assert plan.mode == "skip"
    assert state is not None
    assert state["findings_total"] == 7
    assert state["findings_by_severity"] == {"HIGH": 7}
    assert state["text_extraction_status"] == "EXTRACTED"


@pytest.mark.asyncio
async def test_no_state_is_written_when_the_cache_is_off() -> None:
    recipe = _recipe()
    recipe["scan_cache"] = {"enabled": False}
    cache = ScanCache(recipe, _FakeSource())

    plan = await cache.plan(_FakeAsset("h1", "checksum-1"))
    assert cache.build_state(plan, content_hash=None, detector_outcomes=[]) is None
