"""Retry, backoff and refusal handling for runners that call a hosted model.

The LLM detector and the decision detector call different litellm entry points
but meet the same providers, the same quotas and the same outages, so both run
their calls through here. One copy matters: the rules below were each learned
from a run that went wrong, and a second copy would drift from them.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import random
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Hard request timeout so a hung provider endpoint can never stall a pool
# worker for litellm's ~10-minute default. Overridable per deployment.
_COMPLETION_TIMEOUT_SECONDS = float(os.environ.get("CLASSIFYRE_LLM_TIMEOUT_SECONDS", "90"))

# Retry budget for transient provider failures (429 rate limits, 5xx, timeouts).
# Exponential backoff with jitter, honouring Retry-After when the provider
# sends one, so a saturated endpoint is backed off from instead of hammered.
# The attempt count is read per call (see `max_attempts`), so a detector's own
# `budget.max_attempts` can override it.
_DEFAULT_MAX_COMPLETION_ATTEMPTS = 4
_RETRY_BACKOFF_BASE_SECONDS = float(os.environ.get("CLASSIFYRE_LLM_RETRY_BASE_SECONDS", "2"))
_RETRY_BACKOFF_MAX_SECONDS = 60.0
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}

# Used only if the shared marker list cannot be read, so a packaging mistake
# degrades to "the known worst offender still fails fast" rather than to "every
# quota refusal is retried on every asset again".
_FALLBACK_QUOTA_MARKERS = (
    "insufficient_credit",
    "insufficient balance",
    "out of credits",
    "resource_exhausted",
    "resource exhausted",
    "quota exceeded",
    "free-models-per-day",
    "insufficient_quota",
)

# Billing-exhaustion signals checked before the generic substring scan, with
# word-boundary anchors so "billing" inside an unrelated word cannot trip them
# while "you have insufficient_credit" always does. Mirrors the head of the
# shared quota list in provider_refusal_markers.json.
_ANCHORED_BILLING_EXHAUSTION_MARKERS = (
    "insufficient_credit",
    "insufficient balance",
    "out of credits",
)


def _billing_exhaustion_match(text: str) -> str | None:
    """The anchored billing marker in *text*, or None when absent."""
    for marker in _ANCHORED_BILLING_EXHAUSTION_MARKERS:
        if re.search(rf"(?<![a-z0-9_]){re.escape(marker)}(?![a-z0-9_])", text):
            return marker
    return None


@functools.lru_cache(maxsize=1)
def _quota_markers() -> tuple[str, ...]:
    """Substrings that make a refusal non-retryable; shared with the API."""
    try:
        import schemas

        path = Path(schemas.__file__).parent / "provider_refusal_markers.json"
        markers = json.loads(path.read_text(encoding="utf-8")).get("quota", [])
        loaded = tuple(str(m).strip().lower() for m in markers if str(m).strip())
        if loaded:
            return loaded
    except Exception as exc:  # pragma: no cover - packaging failure
        logger.warning("provider_refusal_markers.json unavailable (%s); using fallback", exc)
    return _FALLBACK_QUOTA_MARKERS


def max_attempts(schema: Any) -> int:
    """The detector's own budget first, then the deployment default."""
    budget = getattr(schema, "budget", None)
    configured = getattr(budget, "max_attempts", None)
    if isinstance(configured, int) and configured >= 1:
        return configured
    raw = os.environ.get("CLASSIFYRE_LLM_MAX_ATTEMPTS", "")
    try:
        return max(1, int(raw)) if raw.strip() else _DEFAULT_MAX_COMPLETION_ATTEMPTS
    except ValueError:
        return _DEFAULT_MAX_COMPLETION_ATTEMPTS


def refusal_reason(litellm: Any, exc: Exception) -> str | None:
    """Why retrying this error cannot help, or None when it might.

    A 429 is usually "slow down" and is retried. It is a refusal only when the
    provider says the allowance itself is gone — a daily or credit quota — and
    then every further call until the reset is the same answer, paid for again.
    """
    status = getattr(exc, "status_code", None)
    if status in (401, 403):
        return "authentication refused"
    if status == 402:
        return "payment required"
    for type_name, reason in (
        ("AuthenticationError", "authentication refused"),
        ("PermissionDeniedError", "permission denied"),
        ("BudgetExceededError", "budget exceeded"),
    ):
        error_type = getattr(litellm, type_name, None)
        if isinstance(error_type, type) and isinstance(exc, error_type):
            return reason

    text = _error_text(exc).lower()
    # Anchored billing-exhaustion markers first: a spent balance is the
    # most specific "retrying cannot help" signal in the shared list.
    if _billing_exhaustion_match(text) is not None:
        return "quota exhausted"
    if any(marker in text for marker in _quota_markers()):
        return "quota exhausted"
    return None


def is_retryable(litellm: Any, exc: Exception) -> bool:
    retryable_types = tuple(
        t
        for t in (
            getattr(litellm, "RateLimitError", None),
            getattr(litellm, "Timeout", None),
            getattr(litellm, "ServiceUnavailableError", None),
            getattr(litellm, "InternalServerError", None),
            getattr(litellm, "APIConnectionError", None),
        )
        if isinstance(t, type)
    )
    if retryable_types and isinstance(exc, retryable_types):
        return True
    # Only the listed statuses are retried: an unknown 4xx (e.g. a Gemini
    # safety-block 400) is a final answer for this input, not a busy
    # provider. Retry stays for 5xx, plain 429s and network errors.
    return getattr(exc, "status_code", None) in _RETRYABLE_STATUS_CODES


def call_with_backoff[T](
    call: Callable[[], T],
    *,
    litellm: Any,
    schema: Any,
    kind: str,
    detector_key: str,
    model: str,
    refused: Callable[[str, Exception], Exception],
) -> T:
    """Run one provider call, retrying what a retry can fix.

    ``kind`` names the engine in the log lines ("llm", "decision"). ``refused``
    builds the error raised for a refusal no retry can fix; the pipeline
    disables the detector for the rest of the run when it sees one.
    """
    attempts = max_attempts(schema)
    for attempt in range(1, attempts + 1):
        try:
            return call()
        except Exception as exc:
            refusal = refusal_reason(litellm, exc)
            if refusal is not None:
                logger.warning(
                    "%s provider refused (detector=%s, model=%s): %s — not retrying",
                    kind,
                    detector_key,
                    model,
                    refusal,
                )
                raise refused(refusal, exc) from None
            if attempt >= attempts or not is_retryable(litellm, exc):
                raise
            delay = min(
                _RETRY_BACKOFF_MAX_SECONDS,
                _RETRY_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)),
            )
            retry_after = _retry_after_seconds(exc)
            if retry_after is not None:
                delay = min(_RETRY_BACKOFF_MAX_SECONDS, max(delay, retry_after))
            delay *= 0.75 + random.random() * 0.5  # ±25% jitter
            logger.warning(
                "%s provider transient failure (detector=%s, model=%s, "
                "attempt %d/%d), retrying in %.1fs: %s",
                kind,
                detector_key,
                model,
                attempt,
                attempts,
                delay,
                exc,
            )
            time.sleep(delay)
    raise RuntimeError("unreachable")  # pragma: no cover


def _error_text(exc: Exception) -> str:
    """Everything a provider exception says about itself, for marker matching."""
    parts = [str(exc), str(getattr(exc, "message", "") or "")]
    response = getattr(exc, "response", None)
    body = getattr(response, "text", None)
    if isinstance(body, str):
        parts.append(body)
    return " ".join(parts)


def _retry_after_seconds(exc: Exception) -> float | None:
    """Best-effort extraction of a Retry-After hint from a provider exception."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        raw = headers.get("retry-after")
    except Exception:
        return None
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None
