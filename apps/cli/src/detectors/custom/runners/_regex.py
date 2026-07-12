"""Regex pipeline runner."""

from __future__ import annotations

import logging
import re
import time
from datetime import UTC, datetime
from typing import Any

from ....models.generated_detectors import (
    PipelineResult,
    RegexPatternDefinition,
    RegexPipelineSchema,
)
from ...dependencies import MissingDependencyError, require_module
from ._base import BaseRunner

logger = logging.getLogger(__name__)

# Hard per-pattern span cap: a pathological pattern on a large document would
# otherwise materialise millions of spans before the detector-level
# max_findings cap applies.
_MAX_SPANS_PER_PATTERN = 1000


def _load_regex_engine() -> tuple[Any, bool]:
    """Try to load google-re2, fall back to stdlib re."""
    try:
        re2_module = require_module("re2", "regex", ["regex"])
        logger.info("Using google-re2 engine for regex patterns")
        return re2_module, True
    except MissingDependencyError:
        logger.info(
            "google-re2 not available, using stdlib re (install with: uv sync --group regex)"
        )
        return re, False


class RegexRunner(BaseRunner):
    """Regex pipeline — uses google-re2 when available, falls back to stdlib re."""

    def __init__(
        self, schema: RegexPipelineSchema, detector_key: str = "", detector_name: str = ""
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        self._engine, self._using_re2 = _load_regex_engine()
        self._compiled: dict[str, tuple[re.Pattern[str], RegexPatternDefinition]] = {}
        self._compile_patterns()

    def _compile_patterns(self) -> None:
        patterns = self._schema.patterns or {}
        for name, defn in patterns.items():
            try:
                compiled = self._compile_one(defn)
                self._compiled[name] = (compiled, defn)
            except Exception as exc:
                logger.warning(
                    "Invalid regex pattern '%s' in detector '%s': %s",
                    name,
                    self._detector_key,
                    exc,
                )

    def _compile_one(self, defn: RegexPatternDefinition) -> re.Pattern[str]:
        case_sensitive = defn.case_sensitive if defn.case_sensitive is not None else True
        dot_nl = defn.dot_nl or False
        literal = defn.literal or False
        longest_match = defn.longest_match or False
        max_mem = defn.max_mem

        legacy_flags = defn.flags or 0
        if isinstance(legacy_flags, int) and legacy_flags & re.IGNORECASE:
            case_sensitive = False
        if isinstance(legacy_flags, int) and legacy_flags & re.DOTALL:
            dot_nl = True

        if self._using_re2:
            options = self._engine.Options()
            options.case_sensitive = case_sensitive
            options.dot_nl = dot_nl
            options.literal = literal
            options.longest_match = longest_match
            if max_mem is not None:
                options.max_mem = max_mem
            return self._engine.compile(defn.pattern, options=options)

        flags = legacy_flags
        if not case_sensitive:
            flags |= re.IGNORECASE
        if dot_nl:
            flags |= re.DOTALL
        if literal:
            return re.compile(re.escape(defn.pattern), flags)
        if longest_match:
            logger.debug("longest_match is a RE2-only feature, ignored with stdlib re")
        if max_mem is not None:
            logger.debug("max_mem is a RE2-only feature, ignored with stdlib re")
        return re.compile(defn.pattern, flags)

    def run(self, text: str) -> PipelineResult:
        start_ms = time.monotonic()
        entities: dict[str, list[dict[str, object]]] = {}

        for name, (rx, defn) in self._compiled.items():
            group_idx = defn.group or 0
            spans: list[dict[str, object]] = []
            for match in rx.finditer(text):
                actual_group = group_idx
                try:
                    value = match.group(group_idx)
                except IndexError:
                    value = match.group(0)
                    actual_group = 0
                    logger.warning(
                        "Capture group %d does not exist in pattern '%s', using group 0",
                        group_idx,
                        name,
                    )

                start = match.start(actual_group)
                end = match.end(actual_group)

                span: dict[str, object] = {
                    "value": value or "",
                    "confidence": 1.0,
                    "start": start,
                    "end": end,
                }
                if defn.severity is not None:
                    span["severity"] = str(defn.severity)
                if match.lastindex:
                    span["groups"] = match.groups()

                spans.append(span)
                if len(spans) >= _MAX_SPANS_PER_PATTERN:
                    logger.warning(
                        "Pattern '%s' in detector '%s' hit the %d-span cap; "
                        "remaining matches dropped",
                        name,
                        self._detector_key,
                        _MAX_SPANS_PER_PATTERN,
                    )
                    break
            if spans:
                entities[name] = spans

        latency_ms = round((time.monotonic() - start_ms) * 1000)
        engine_tag = "RE2" if self._using_re2 else "stdlib-re"
        return PipelineResult(
            entities=entities,
            classification={},
            metadata={
                "runner": "REGEX",
                "engine": engine_tag,
                "latency_ms": latency_ms,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
