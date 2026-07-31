"""Skip work that would reproduce findings we already have.

A run re-downloads, re-parses, re-OCRs and re-detects every asset in scope even
when nothing about the asset or the detector configuration has moved since the
last scan.  This module decides, per asset, which of that work is provably
redundant.

The decision is a conjunction, and every clause is a veto:

* the source must support caching at all (a database row can change under the
  same key with no signal to compare, so only file-like sources opt in),
* the previous scan of this asset must have completed cleanly,
* the source scope must not have moved,
* the content must be identical — by the source-reported checksum, and by a
  SHA-256 of the bytes when the source's checksum is only mtime and size,
* the sampling strategy must not be part-way through the asset's payload — an
  unchanged Parquet file with four million unread rows is unchanged and unscanned
  at the same time (see ``pipeline.payload_window``),
* and a detector re-runs unless its configuration fingerprint is unchanged.

A detector is cached individually, so adding one detector re-runs that detector
across the corpus and leaves the rest skipped.  Detectors whose verdict depends
on the outside world are never cached — see ``NON_CACHEABLE_DETECTOR_TYPES``.

The safety property that makes skipping non-destructive lives on the API side:
``finalizeIngestRun`` may only resolve a finding whose detector reported an ``OK``
outcome on that asset in this run.  A skipped asset reports no outcomes and a
partially-run asset reports only the detectors that ran, so findings we did not
re-check are never mistaken for findings that disappeared.
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Literal

from ..detectors.engine_version import (
    PARSER_ENGINE_VERSION,
    detector_engine_version,
    is_cacheable_detector_type,
)
from ..utils.hashing import calculate_checksum

logger = logging.getLogger(__name__)

FORCE_FULL_RESCAN_ENV = "CLASSIFYRE_FORCE_FULL_RESCAN"

ScanMode = Literal["full", "partial", "skip"]

_INCOMPLETE_TEXT_EXTRACTION_STATUSES = frozenset({"ENGINE_UNAVAILABLE", "ZERO_FRAMES", "FAILED"})

# Credential material the API injects into detector config at dispatch time
# (``provider_runtime.api_key`` for LLM detectors, for example).  Rotating a
# secret must not invalidate the corpus, so these are dropped before hashing.
# Everything else about a provider — model, context size, vision support — stays
# in, because it does change what the detector reports.
_SECRET_CONFIG_KEYS = frozenset(
    {
        "access_token",
        "api_key",
        "api_secret",
        "apikey",
        "client_secret",
        "credentials",
        "masked",
        "password",
        "private_key",
        "refresh_token",
        "secret",
        "secret_key",
        "token",
    }
)


def _scrub(value: Any) -> Any:
    """Drop credential material anywhere in a detector config tree."""
    if isinstance(value, dict):
        return {
            key: _scrub(item)
            for key, item in value.items()
            if str(key).strip().lower() not in _SECRET_CONFIG_KEYS
        }
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def detector_cache_key(detector_type: str, config: Any) -> str:
    """Stable identity for one configured detector.

    Two custom detectors both report ``type: CUSTOM``, so the custom key is what
    tells them apart.  Mirrors the ``assetHash|DETECTOR|customKey`` shape the API
    uses to decide which findings a run is allowed to resolve.
    """
    normalized = detector_type.strip().upper()
    if normalized == "CUSTOM" and isinstance(config, dict):
        custom_key = config.get("custom_detector_key")
        if isinstance(custom_key, str) and custom_key.strip():
            return f"CUSTOM::{custom_key.strip()}"
    return normalized


def detector_fingerprint(
    detector_type: str,
    config: Any,
    content_shape: dict[str, Any],
) -> str:
    """Hash everything that decides what this detector would report.

    ``content_shape`` covers the recipe settings that change the *input* — byte
    caps, pagination, column inclusion — because identical detector config over
    truncated content is not the same scan.
    """
    return calculate_checksum(
        {
            "type": detector_type.strip().upper(),
            "config": _scrub(config if isinstance(config, dict) else {}),
            "engine": detector_engine_version(detector_type),
            "parser": PARSER_ENGINE_VERSION,
            "content_shape": content_shape,
        }
    )


def _content_shape(recipe: dict[str, Any]) -> dict[str, Any]:
    """Recipe settings that change what content reaches the detectors.

    Deliberately over-inclusive: the whole ``optional`` subtree counts, even keys
    that only affect connection behaviour.  A false "changed" costs one run; a
    false "unchanged" silently under-scans, which is the failure that matters.

    ``strategy`` is in here because it selects *which rows* of a payload a
    detector sees.  Results banked under LATEST describe the top of a file and
    say nothing about the rest, so switching to AUTOMATIC must not reuse them.
    """
    sampling = recipe.get("sampling")
    sampling = sampling if isinstance(sampling, dict) else {}
    return {
        "optional": recipe.get("optional") or {},
        "strategy": sampling.get("strategy"),
        "rows_per_page": sampling.get("rows_per_page"),
        "include_column_names": sampling.get("include_column_names"),
    }


@dataclass(frozen=True)
class PriorScanState:
    """What the API knows about this asset from its last scan.

    Captured at discovery time and held for the run: the Phase 1 stub ingest
    overwrites ``Asset.checksum`` with the incoming value, so reading it any later
    compares the new checksum against itself and skips everything.

    Its mere existence here is proof that the API validated a ``complete=true``
    state bound to the checksum and scope of the last successful payload. A
    partial or failed attempt is withheld, so the next run redoes the work.
    """

    checksum: str | None = None
    content_hash: str | None = None
    scope_fingerprint: str | None = None
    detectors: dict[str, str] = field(default_factory=dict)
    findings_total: int | None = None
    findings_by_severity: dict[str, int] | None = None
    findings_by_detector: dict[str, dict[str, int]] | None = None
    empty_text: bool | None = None
    text_extraction_status: str | None = None

    @classmethod
    def from_payload(cls, raw: Any) -> tuple[str, PriorScanState] | None:
        if not isinstance(raw, dict):
            return None
        asset_hash = raw.get("hash")
        if not isinstance(asset_hash, str) or not asset_hash:
            return None
        detectors_raw = raw.get("detectors")
        detectors = (
            {str(key): str(value) for key, value in detectors_raw.items() if isinstance(value, str)}
            if isinstance(detectors_raw, dict)
            else {}
        )
        return asset_hash, cls(
            checksum=raw.get("checksum") if isinstance(raw.get("checksum"), str) else None,
            content_hash=(
                raw.get("contentHash") if isinstance(raw.get("contentHash"), str) else None
            ),
            scope_fingerprint=(
                raw.get("scopeFingerprint")
                if isinstance(raw.get("scopeFingerprint"), str)
                else None
            ),
            detectors=detectors,
            findings_total=(
                raw.get("findingsTotal") if isinstance(raw.get("findingsTotal"), int) else None
            ),
            findings_by_severity=(
                raw.get("findingsBySeverity")
                if isinstance(raw.get("findingsBySeverity"), dict)
                else None
            ),
            findings_by_detector=(
                raw.get("findingsByDetector")
                if isinstance(raw.get("findingsByDetector"), dict)
                else None
            ),
            empty_text=(raw.get("emptyText") if isinstance(raw.get("emptyText"), bool) else None),
            text_extraction_status=(
                raw.get("textExtractionStatus")
                if isinstance(raw.get("textExtractionStatus"), str)
                else None
            ),
        )


@dataclass(frozen=True)
class ScanPlan:
    """What to do with one asset, and why."""

    mode: ScanMode
    reason: str
    run_detector_keys: frozenset[str] = frozenset()
    carried_detectors: dict[str, str] = field(default_factory=dict)
    content_hash: str | None = None
    prior: PriorScanState | None = None

    @property
    def skipped(self) -> bool:
        return self.mode == "skip"

    @classmethod
    def full(cls, reason: str) -> ScanPlan:
        return cls(mode="full", reason=reason)


class ScanCache:
    """Per-run scan-cache state: fingerprints, prior state, and the decision."""

    def __init__(
        self,
        recipe: dict[str, Any],
        source: Any,
        *,
        scope_fingerprint: str | None = None,
        payload_windows: Any = None,
    ) -> None:
        self._source = source
        self._scope_fingerprint = scope_fingerprint
        self._payload_windows = payload_windows
        self._prior: dict[str, PriorScanState] = {}

        config = recipe.get("scan_cache")
        config = config if isinstance(config, dict) else {}
        supported = bool(getattr(source, "SUPPORTS_SCAN_CACHE", False))
        forced = self._force_full_rescan()
        self._enabled = supported and config.get("enabled", True) is not False and not forced

        verify = config.get("verify") or "auto"
        if verify == "auto":
            resolve_verify = getattr(source, "scan_cache_verification_mode", None)
            verify = (
                resolve_verify()
                if callable(resolve_verify)
                else getattr(source, "SCAN_CACHE_VERIFY", "content")
            )
        self._verify: str = verify if verify in {"metadata", "content"} else "content"

        self._cacheable, self._always_run = self._build_fingerprints(recipe)

        if not supported:
            self._disabled_reason = "source does not support the scan cache"
        elif forced:
            self._disabled_reason = "full rescan forced for this run"
        elif not self._enabled:
            self._disabled_reason = "scan cache disabled for this source"
        else:
            self._disabled_reason = ""

    @staticmethod
    def _force_full_rescan() -> bool:
        raw = os.environ.get(FORCE_FULL_RESCAN_ENV, "")
        return raw.strip().lower() in {"1", "true", "yes", "y", "on"}

    @staticmethod
    def _build_fingerprints(
        recipe: dict[str, Any],
    ) -> tuple[dict[str, str], frozenset[str]]:
        shape = _content_shape(recipe)
        cacheable: dict[str, str] = {}
        always_run: set[str] = set()

        entries = recipe.get("detectors")
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or not entry.get("enabled", True):
                continue
            detector_type = str(entry.get("type") or "").strip().upper()
            if not detector_type:
                continue
            config = entry.get("config")
            key = detector_cache_key(detector_type, config)
            if is_cacheable_detector_type(detector_type):
                cacheable[key] = detector_fingerprint(detector_type, config, shape)
            else:
                always_run.add(key)

        return cacheable, frozenset(always_run)

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def verify(self) -> str:
        return self._verify

    @property
    def tracks_content_hash(self) -> bool:
        """Whether this run should digest asset bytes.

        Only the ``content`` verify mode compares digests, so only it pays for
        them.  A ``metadata`` source proves sameness from a provider-supplied
        digest and must not be made to download bytes it would otherwise skip.
        """
        return self._enabled and self._verify == "content"

    @property
    def cacheable_count(self) -> int:
        """How many configured detectors are eligible to be skipped."""
        return len(self._cacheable)

    def skipped_detector_runs(self, plan: ScanPlan) -> int:
        """Detector runs this plan avoids — the number that shows the saving."""
        if plan.mode == "skip":
            return len(self._cacheable)
        if plan.mode == "partial":
            return len(self._cacheable) - len(plan.run_detector_keys & set(self._cacheable))
        return 0

    def record_prior(self, entries: Any) -> None:
        """Absorb the prior-state entries returned by the discover call."""
        if not isinstance(entries, list):
            return
        for raw in entries:
            parsed = PriorScanState.from_payload(raw)
            if parsed is not None:
                self._prior[parsed[0]] = parsed[1]

    def prior_for(self, asset_hash: str) -> PriorScanState | None:
        return self._prior.get(asset_hash)

    async def plan(self, asset: Any) -> ScanPlan:
        """Decide how much of this asset's processing can be skipped."""
        if not self._enabled:
            return ScanPlan.full(self._disabled_reason or "scan cache disabled")

        asset_hash = str(getattr(asset, "hash", "") or "")
        prior = self._prior.get(asset_hash)
        if prior is None:
            # Either the asset is new, or its last scan did not run to
            # completion — the API withholds state for both.
            return ScanPlan.full("no completed prior scan of this asset")

        if (
            self._scope_fingerprint
            and prior.scope_fingerprint
            and prior.scope_fingerprint != self._scope_fingerprint
        ):
            return ScanPlan.full("source scope changed since the last scan")

        checksum = getattr(asset, "checksum", None)
        if not prior.checksum or not checksum or prior.checksum != str(checksum):
            return ScanPlan.full("asset checksum changed")

        # An unchanged checksum is the cache's whole case for skipping, and it is
        # exactly the wrong answer for a payload that is being read a window at a
        # time. The file has not moved; the rows nobody has read yet are still
        # unread. Ask the payload window before trusting sameness.
        if self._payload_windows is not None and self._payload_windows.advances_for(asset):
            return ScanPlan.full("payload sampling window still has rows to cover")

        content_hash = prior.content_hash
        if self._verify == "content":
            if not prior.content_hash:
                # Nothing to compare against yet — run in full so this scan
                # records a digest the next one can trust.
                return ScanPlan.full("no content hash recorded for this asset")
            digest = await self.content_digest(asset)
            if digest is None:
                return ScanPlan.full("content unavailable to verify")
            if digest != prior.content_hash:
                return ScanPlan.full("content hash changed")
            content_hash = digest

        stale = {
            key
            for key, fingerprint in self._cacheable.items()
            if prior.detectors.get(key) != fingerprint
        }
        run_keys = stale | set(self._always_run)
        carried = {
            key: fingerprint for key, fingerprint in self._cacheable.items() if key not in stale
        }

        if not run_keys:
            return ScanPlan(
                mode="skip",
                reason="content and every detector configuration unchanged",
                carried_detectors=carried,
                content_hash=content_hash,
                prior=prior,
            )

        return ScanPlan(
            mode="partial",
            reason=f"{len(run_keys)} detector(s) changed or always run",
            run_detector_keys=frozenset(run_keys),
            carried_detectors=carried,
            content_hash=content_hash,
            prior=prior,
        )

    async def content_digest(self, asset: Any) -> str | None:
        """SHA-256 of the asset's bytes, or None when they cannot be read.

        Bytes are cached by the source for the rest of the asset's processing, so
        on a cache miss the download is not wasted — the detectors reuse it.
        """
        fetch = getattr(self._source, "fetch_content_bytes", None)
        if fetch is None:
            return None

        # Mirrors DetectorPipeline's candidate order: sources key their byte
        # cache by external URL, falling back to the asset hash.
        candidates = [
            str(value)
            for value in (getattr(asset, "external_url", None), getattr(asset, "hash", None))
            if value
        ]
        for candidate in candidates:
            try:
                result = await fetch(candidate)
            except Exception as exc:
                logger.warning("Scan cache: byte fetch failed for %s: %s", candidate, exc)
                return None
            if result is None:
                continue
            raw_bytes = result[0] if isinstance(result, tuple) else result
            if isinstance(raw_bytes, bytes | bytearray):
                return hashlib.sha256(bytes(raw_bytes)).hexdigest()
        return None

    def build_state(
        self,
        plan: ScanPlan,
        *,
        content_hash: str | None,
        detector_outcomes: Any,
        scan_stats: Any = None,
        available_detector_keys: frozenset[str] | None = None,
        completed: bool = True,
        findings_total: int | None = None,
        findings_by_severity: dict[str, int] | None = None,
        findings_by_detector: dict[str, dict[str, int]] | None = None,
    ) -> dict[str, Any] | None:
        """The scan-cache state to persist for this asset, or None when off.

        A detector that raised or failed to initialize is left out so the next
        run retries it rather than trusting a result we never got. A detector
        that initialized but reported no outcome because it does not apply to
        this content type is recorded.

        The run statistics ride along so a later skipped run can report what this
        scan actually saw, rather than zeroing the asset's finding counts and
        text-coverage contribution.
        """
        if not self._enabled:
            return None

        extraction_status = getattr(scan_stats, "text_extraction_status", None)
        extraction_status_value = str(
            getattr(extraction_status, "value", extraction_status) or ""
        ).upper()
        complete = completed and extraction_status_value not in _INCOMPLETE_TEXT_EXTRACTION_STATUSES

        # Persist an explicit tombstone instead of omitting state. Omitting it
        # would leave an older successful state in place, and a later run could
        # mistake that state for proof that this failed attempt completed.
        if not complete:
            return {
                "complete": False,
                "content_hash": content_hash,
                "detectors": {},
                "findings_total": findings_total,
                "findings_by_severity": findings_by_severity,
                "findings_by_detector": findings_by_detector,
                "empty_text": getattr(scan_stats, "empty_text", None),
                "text_extraction_status": (
                    str(getattr(extraction_status, "value", extraction_status))
                    if extraction_status
                    else None
                ),
            }

        errored: set[str] = set()
        for outcome in detector_outcomes if isinstance(detector_outcomes, list) else []:
            detector_type = getattr(outcome, "detector_type", None)
            custom_key = getattr(outcome, "custom_detector_key", None)
            status = getattr(outcome, "status", None)
            status_value = getattr(status, "value", status)
            if str(status_value).upper() != "ERROR":
                continue
            type_value = str(getattr(detector_type, "value", detector_type) or "").upper()
            errored.add(
                f"CUSTOM::{custom_key}" if type_value == "CUSTOM" and custom_key else type_value
            )

        detectors = dict(plan.carried_detectors)
        requested = plan.run_detector_keys if plan.mode == "partial" else frozenset(self._cacheable)
        available = available_detector_keys if available_detector_keys is not None else requested
        # A configured detector that failed during pipeline construction has no
        # runtime outcome. Only initialized detector keys may be banked.
        ran = requested & available
        for key in requested - available:
            detectors.pop(key, None)
        for key in ran:
            if key in errored:
                detectors.pop(key, None)
                continue
            fingerprint = self._cacheable.get(key)
            if fingerprint is not None:
                detectors[key] = fingerprint

        state: dict[str, Any] = {
            "complete": True,
            "content_hash": content_hash,
            "detectors": detectors,
        }

        if plan.mode == "skip" and plan.prior is not None:
            # Nothing ran, so this run has no statistics of its own — repeat the
            # ones the last real scan recorded.
            state.update(
                findings_total=plan.prior.findings_total,
                findings_by_severity=plan.prior.findings_by_severity,
                findings_by_detector=plan.prior.findings_by_detector,
                empty_text=plan.prior.empty_text,
                text_extraction_status=plan.prior.text_extraction_status,
            )
            return state

        status = getattr(scan_stats, "text_extraction_status", None)
        state.update(
            findings_total=findings_total,
            findings_by_severity=findings_by_severity,
            findings_by_detector=findings_by_detector,
            empty_text=getattr(scan_stats, "empty_text", None),
            text_extraction_status=str(getattr(status, "value", status)) if status else None,
        )
        return state
