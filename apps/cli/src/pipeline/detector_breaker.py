"""Run-scoped circuit breaker for detectors.

A detector that has stopped working keeps being called by default: every asset
is dispatched, every call fails, and the run spends its life waiting for the
same answer. Measured on an LLM detector whose free-tier provider refused its
key: 451 of 451 assets failed, 120-157 minutes a run, with the only runner slot
held the whole time.

The breaker disables a detector for the rest of the run when

* the provider refused in a way no retry can fix (``ProviderRefusedError``),
* it failed ``max_consecutive_failures`` payloads in a row (default 10), or
* it has spent more than ``max_wall_clock_seconds`` (off unless configured).

A disabled detector still reports an ERROR outcome on each asset it skips, with
a message starting ``breaker_open[<cause>]``. That is load-bearing twice over:
the API resolves a finding for absence only on an OK outcome, so the skipped
assets keep their findings; and the scan cache never banks an errored detector,
so the next run retries them. The API reads the prefix to report the cause.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..detectors.base import BaseDetector
from ..detectors.errors import ProviderRefusedError

DEFAULT_MAX_CONSECUTIVE_FAILURES = 10
#: Outcome errors for skipped assets start with this. Parsed by the API.
BREAKER_OUTCOME_PREFIX = "breaker_open"
_MAX_REASON_CHARS = 300


@dataclass(frozen=True)
class BreakerLimits:
    max_consecutive_failures: int = DEFAULT_MAX_CONSECUTIVE_FAILURES
    max_wall_clock_seconds: int | None = None


@dataclass
class _BreakerState:
    label: str
    limits: BreakerLimits
    consecutive_failures: int = 0
    failures: int = 0
    successes: int = 0
    elapsed_ms: int = 0
    skipped: int = 0
    cause: str | None = None
    reason: str | None = None


def budget_limits(detector: BaseDetector) -> BreakerLimits:
    """The limits a detector's pipeline schema asks for, or the defaults."""
    config = getattr(detector, "custom_config", None)
    schema = getattr(config, "pipeline_schema", None)
    schema = getattr(schema, "root", schema)
    budget = getattr(schema, "budget", None)
    if budget is None:
        return BreakerLimits()
    failures = getattr(budget, "max_consecutive_failures", None)
    wall = getattr(budget, "max_wall_clock_seconds", None)
    return BreakerLimits(
        max_consecutive_failures=(
            failures
            if isinstance(failures, int) and failures >= 1
            else DEFAULT_MAX_CONSECUTIVE_FAILURES
        ),
        max_wall_clock_seconds=wall if isinstance(wall, int) and wall >= 1 else None,
    )


def _short(error: BaseException) -> str:
    text = str(error).strip() or error.__class__.__name__
    return text if len(text) <= _MAX_REASON_CHARS else text[: _MAX_REASON_CHARS - 1] + "…"


class DetectorBreaker:
    """Per-run breaker state, keyed by the detector's scan-cache identity."""

    def __init__(self) -> None:
        self._states: dict[str, _BreakerState] = {}

    def _state(self, key: str, detector: BaseDetector, label: str) -> _BreakerState:
        state = self._states.get(key)
        if state is None:
            state = _BreakerState(label=label, limits=budget_limits(detector))
            self._states[key] = state
        return state

    def skip_message(self, key: str) -> str | None:
        """The outcome error to record instead of dispatching, when open."""
        state = self._states.get(key)
        if state is None or state.cause is None:
            return None
        state.skipped += 1
        return (
            f"{BREAKER_OUTCOME_PREFIX}[{state.cause}]: {state.label} was disabled for the "
            f"rest of this run and did not evaluate this asset — {state.reason}"
        )

    def record(
        self,
        key: str,
        detector: BaseDetector,
        label: str,
        *,
        error: BaseException | None,
        elapsed_ms: int,
    ) -> str | None:
        """Account one payload's result. Returns the reason if it opened the breaker.

        Results that land after the breaker opened (payloads already in flight
        when it tripped) are counted but cannot re-open or reset it.
        """
        state = self._state(key, detector, label)
        state.elapsed_ms += max(0, int(elapsed_ms))
        if error is None:
            state.successes += 1
            if state.cause is None:
                state.consecutive_failures = 0
        else:
            state.failures += 1
            state.consecutive_failures += 1
        if state.cause is not None:
            return None

        if error is not None and isinstance(error, ProviderRefusedError):
            return self._trip(
                state,
                "provider_refused",
                f"the provider refused the request and retrying cannot help: {_short(error)}",
            )
        if (
            error is not None
            and state.consecutive_failures >= state.limits.max_consecutive_failures
        ):
            return self._trip(
                state,
                "consecutive_failures",
                f"{state.consecutive_failures} consecutive failures (last: {_short(error)})",
            )
        wall = state.limits.max_wall_clock_seconds
        if wall is not None and state.elapsed_ms >= wall * 1000:
            return self._trip(
                state,
                "wall_clock_budget",
                f"it spent {state.elapsed_ms / 1000:.0f}s against a {wall}s budget",
            )
        return None

    @staticmethod
    def _trip(state: _BreakerState, cause: str, reason: str) -> str:
        state.cause = cause
        state.reason = reason
        return reason

    def summary(self) -> list[dict[str, Any]]:
        """Detectors disabled during this run, for the run log."""
        return [
            {
                "detector": key,
                "label": state.label,
                "cause": state.cause,
                "reason": state.reason,
                "attempted_payloads": state.successes + state.failures,
                "failed_payloads": state.failures,
                "skipped_payloads": state.skipped,
            }
            for key, state in sorted(self._states.items())
            if state.cause is not None
        ]
