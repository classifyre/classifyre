"""Custom detector extraction engine — REGEX, GLINER, and CLASSIFIER_GLINER strategies."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from ...models.generated_detectors import (
    CustomDetectorMethod,
    CustomExtractorConfig,
    CustomExtractorField,
)
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)

# Extraction method tags sent to the API via DetectionResult.extraction_method
EXTRACTION_METHOD_REGEX = "REGEX"
EXTRACTION_METHOD_GLINER = "GLINER"
EXTRACTION_METHOD_CLASSIFIER_GLINER = "CLASSIFIER_GLINER"


@dataclass
class ExtractionResult:
    """Typed output from one extraction run."""

    extracted_data: dict[str, Any]
    method: str
    populated_fields: list[str] = field(default_factory=list)
    field_count: int = 0

    def __post_init__(self) -> None:
        self.populated_fields = [
            k for k, v in self.extracted_data.items() if v is not None and v not in ([], "")
        ]
        self.field_count = len(self.extracted_data)


class CustomExtractor:
    """
    Runs after a custom detector fires to pull structured data from the content.

    Strategy selection:
      RULESET     → REGEX    (named capture groups in field.regex_pattern)
      ENTITY      → GLINER   (group entity spans by entity_label into fields)
      CLASSIFIER  → CLASSIFIER_GLINER  (second GLiNER pass on wider content slice)
    """

    def __init__(
        self,
        config: CustomExtractorConfig,
        detector_method: CustomDetectorMethod,
    ) -> None:
        self._config = config
        self._method = detector_method
        self._gliner_model: Any | None = None
        self._compiled: dict[str, re.Pattern[str]] = {}  # pattern cache

    # ── Public API ───────────────────────────────────────────────────────────

    def extract(
        self,
        matched_content: str,
        content_for_extraction: str,
    ) -> ExtractionResult | None:
        """
        Run extraction and return structured result, or None if nothing extracted.

        Args:
            matched_content:       The content stored in the finding (may be truncated).
            content_for_extraction: Wider slice of the original document for GLiNER/regex.
        """
        if not self._config.enabled:
            return None

        if self._method == CustomDetectorMethod.RULESET:
            return self._extract_regex(content_for_extraction)
        if self._method == CustomDetectorMethod.ENTITY:
            return self._extract_gliner(content_for_extraction, EXTRACTION_METHOD_GLINER)
        if self._method == CustomDetectorMethod.CLASSIFIER:
            return self._extract_gliner(content_for_extraction, EXTRACTION_METHOD_CLASSIFIER_GLINER)
        logger.warning("CustomExtractor: unknown detector method %s", self._method)
        return None

    # ── RULESET — regex named groups ─────────────────────────────────────────

    def _extract_regex(self, content: str) -> ExtractionResult | None:
        data: dict[str, Any] = {}

        for f in self._config.fields:
            if not f.regex_pattern:
                logger.debug(
                    "Extractor field '%s' has no regex_pattern — skipped for RULESET", f.name
                )
                continue
            value = self._apply_regex_field(content, f)
            if value is not None:
                data[f.name] = value

        return self._finalize(data, EXTRACTION_METHOD_REGEX)

    def _apply_regex_field(self, content: str, f: CustomExtractorField) -> Any:
        pattern = self._compile(f.regex_pattern or "", f.regex_flags or "i")
        if pattern is None:
            return None

        named_groups = pattern.groupindex
        group_name = next(iter(named_groups), None)

        matches: list[str] = []
        for m in pattern.finditer(content):
            captured = m.group(group_name) if group_name else m.group(0)
            if captured and captured.strip():
                matches.append(captured.strip())

        return self._aggregate(matches, f) if matches else None

    def _compile(self, pattern: str, flags_str: str) -> re.Pattern[str] | None:
        cache_key = f"{pattern}::{flags_str}"
        if cache_key in self._compiled:
            return self._compiled[cache_key]

        flags = 0
        for ch in flags_str:
            if ch == "i":
                flags |= re.IGNORECASE
            elif ch == "m":
                flags |= re.MULTILINE
            elif ch == "s":
                flags |= re.DOTALL

        try:
            compiled = re.compile(pattern, flags=flags)
            self._compiled[cache_key] = compiled
            return compiled
        except re.error as exc:
            logger.warning("CustomExtractor: invalid regex pattern '%s': %s", pattern, exc)
            return None

    # ── ENTITY / CLASSIFIER — GLiNER entity spans ────────────────────────────

    def _extract_gliner(self, content: str, method_tag: str) -> ExtractionResult | None:
        label_to_fields: dict[str, list[CustomExtractorField]] = {}
        for f in self._config.fields:
            if f.entity_label:
                label_to_fields.setdefault(f.entity_label, []).append(f)

        if not label_to_fields:
            logger.debug("CustomExtractor: no fields with entity_label — skipping GLiNER")
            return None

        model = self._load_gliner()
        if model is None:
            return None

        entity_labels = list(label_to_fields.keys())
        try:
            entities = model.predict_entities(content, entity_labels)
        except Exception as exc:  # pragma: no cover
            logger.warning("CustomExtractor: GLiNER prediction failed: %s", exc)
            return None

        # Group spans by label, filtered by per-field min_confidence
        spans_by_label: dict[str, list[str]] = {}
        for entity in entities:
            score = float(entity.get("score", 0.0))
            label = str(entity.get("label", "")).strip()
            text = str(entity.get("text", "")).strip()
            if not label or not text:
                continue
            for f in label_to_fields.get(label, []):
                threshold = f.min_confidence if f.min_confidence is not None else 0.4
                if score >= threshold:
                    spans_by_label.setdefault(label, []).append(text)
                    break  # one field matched — avoid double-counting

        # Map grouped spans → output fields
        data: dict[str, Any] = {}
        for entity_label, fields in label_to_fields.items():
            spans = spans_by_label.get(entity_label, [])
            for f in fields:
                value = self._aggregate(spans, f) if spans else None
                if value is not None:
                    data[f.name] = value

        return self._finalize(data, method_tag)

    def _load_gliner(self) -> Any | None:
        if self._gliner_model is not None:
            return self._gliner_model
        try:
            gliner_module = require_module("gliner", "custom", ["classification", "detectors"])
            model_name = self._config.gliner_model or "urchade/gliner_multi-v2.1"
            self._gliner_model = gliner_module.GLiNER.from_pretrained(model_name)
            return self._gliner_model
        except MissingDependencyError:
            raise
        except Exception as exc:  # pragma: no cover
            logger.warning("CustomExtractor: failed to load GLiNER: %s", exc)
            return None

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _aggregate(self, values: list[str], f: CustomExtractorField) -> Any:
        if not values:
            return None
        aggregate = f.aggregate or "list"
        if aggregate == "first":
            return values[0]
        if aggregate == "last":
            return values[-1]
        if aggregate == "list":
            return values
        if aggregate == "join":
            sep = f.join_separator if f.join_separator is not None else ", "
            return sep.join(values)
        if aggregate == "count":
            return len(values)
        return values  # fallback

    def _finalize(self, data: dict[str, Any], method: str) -> ExtractionResult | None:
        # Required fields gate: if any required field is missing, discard the result
        for f in self._config.fields:
            if f.required and f.name not in data:
                logger.debug(
                    "CustomExtractor: required field '%s' not populated — discarding", f.name
                )
                return None

        if not data:
            return None

        return ExtractionResult(extracted_data=data, method=method)
