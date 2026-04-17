"""Custom detector implementation with ruleset, classifier, and entity methods."""

from __future__ import annotations

import hashlib
import json
import logging
import operator
import os
import re
from pathlib import Path
from typing import Any

from ...models.generated_detectors import (
    CustomClassifierConfig,
    CustomClassifierTrainingExample,
    CustomDetectorConfig,
    CustomDetectorMethod,
    CustomEntityConfig,
    CustomKeywordRule,
    CustomRegexRule,
    CustomRulesetConfig,
    DetectorConfig,
    Severity,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
)
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, ensure_torch, require_module
from .extractor import CustomExtractor, ExtractionResult

logger = logging.getLogger(__name__)

_DEFAULT_GLINER2_MODEL = "fastino/gliner2-base-v1"

_GERMAN_MERGE_PARTS = (
    "daten",
    "schutz",
    "beauftrag",
    "register",
    "nummer",
    "steuer",
    "verordnung",
    "gesetz",
    "pflicht",
    "verfahren",
    "behandlung",
    "anlagen",
)


class CustomDetector(BaseDetector):
    """User-defined detector that supports multiple execution methods."""

    detector_type = "custom"
    detector_name = "custom"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        if not isinstance(self.config, CustomDetectorConfig):
            raise ValueError(
                "Custom detector requires CustomDetectorConfig with custom_detector_key and method"
            )

        self.custom_config = self.config
        self._regex_rules = self._compile_regex_rules(self.custom_config.ruleset)
        self._entity_model: Any | None = None
        self._zero_shot_pipeline: Any | None = None
        self._setfit_model: Any | None = None
        self._template_notice_keys: set[str] = set()
        self._extractor: CustomExtractor | None = (
            CustomExtractor(self.custom_config.extractor, self.custom_config.method)
            if self.custom_config.extractor and self.custom_config.extractor.enabled
            else None
        )

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        text = content.strip()
        if not text:
            return []

        # Wider slice for extractor — classifier only stores content[:320] in matched_content
        content_limit = (
            self.custom_config.extractor.content_limit
            if self.custom_config.extractor and self.custom_config.extractor.content_limit
            else 4000
        )
        content_for_extraction = text[:content_limit]

        method = self.custom_config.method
        if method == CustomDetectorMethod.RULESET:
            findings = self._detect_ruleset(text)
            self._attach_extraction(findings[:1], text, content_for_extraction)

        elif method == CustomDetectorMethod.CLASSIFIER:
            findings = self._detect_classifier(text)
            # All label findings from one doc share the same extraction result
            self._attach_extraction(findings, text, content_for_extraction, share=True)

        elif method == CustomDetectorMethod.ENTITY:
            findings = self._detect_entity(text)
            # Grouped entity extraction attaches to first finding only
            self._attach_extraction(findings[:1], text, content_for_extraction)

        else:
            logger.warning("Unknown custom detector method: %s", method)
            findings = []

        max_findings = self.custom_config.max_findings
        if isinstance(max_findings, int) and max_findings > 0:
            findings = findings[:max_findings]
        return findings

    def _attach_extraction(
        self,
        findings: list[DetectionResult],
        matched_content: str,
        content_for_extraction: str,
        share: bool = False,
    ) -> None:
        """Run extractor and attach result to findings. share=True copies to all findings."""
        if not self._extractor or not findings:
            return
        result: ExtractionResult | None = self._extractor.extract(
            matched_content, content_for_extraction
        )
        if result is None:
            return
        targets = findings if share else findings[:1]
        for finding in targets:
            finding.extracted_data = result.extracted_data
            finding.extraction_method = result.method

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "text/html",
            "text/markdown",
            "application/json",
            "application/xml",
            "text/xml",
            "image/*",
        ]

    def _detect_ruleset(self, content: str) -> list[DetectionResult]:
        ruleset = self.custom_config.ruleset or CustomRulesetConfig()
        findings: list[DetectionResult] = []
        seen_keys: set[tuple[str, str]] = set()
        threshold = self.custom_config.confidence_threshold or 0.7

        original = content
        variants = self._content_variants(content)

        for rule, compiled in self._regex_rules:
            for candidate in variants:
                for match in compiled.finditer(candidate):
                    matched = match.group(0).strip()
                    if not matched:
                        continue

                    identity = (f"regex:{rule.id}", matched.lower())
                    if identity in seen_keys:
                        continue
                    seen_keys.add(identity)

                    confidence = 0.93
                    if confidence < threshold:
                        continue

                    start = original.find(matched)
                    end = start + len(matched) if start >= 0 else None
                    location = (
                        Location(start=start, end=end, path="custom-ruleset")
                        if start >= 0 and end is not None
                        else None
                    )

                    findings.append(
                        self._make_result(
                            finding_type=f"regex:{rule.id}",
                            category="COMPLIANCE",
                            severity=rule.severity or Severity.medium,
                            confidence=confidence,
                            matched_content=matched,
                            location=location,
                            metadata={
                                "method": "RULESET",
                                "rule_type": "regex",
                                "rule_id": rule.id,
                                "rule_name": rule.name,
                                "pattern": rule.pattern,
                            },
                        )
                    )

        for rule in ruleset.keyword_rules or []:
            keyword_matches = self._keyword_matches(content, rule)
            for matched, start, end in keyword_matches:
                identity = (f"keyword:{rule.id}", matched.lower())
                if identity in seen_keys:
                    continue
                seen_keys.add(identity)

                confidence = 0.82
                if confidence < threshold:
                    continue

                findings.append(
                    self._make_result(
                        finding_type=f"keyword:{rule.id}",
                        category="COMPLIANCE",
                        severity=rule.severity or Severity.low,
                        confidence=confidence,
                        matched_content=matched,
                        location=Location(start=start, end=end, path="custom-ruleset"),
                        metadata={
                            "method": "RULESET",
                            "rule_type": "keyword",
                            "rule_id": rule.id,
                            "rule_name": rule.name,
                        },
                    )
                )

        return findings

    def _detect_classifier(self, content: str) -> list[DetectionResult]:
        classifier = self.custom_config.classifier or CustomClassifierConfig()
        labels = classifier.labels or []
        if not labels:
            return []

        threshold = self.custom_config.confidence_threshold or 0.7
        variants = self._content_variants(content)

        setfit_scores = self._classify_with_setfit(variants, classifier)
        if not setfit_scores:
            setfit_scores = self._classify_with_zero_shot(variants, classifier)

        if not setfit_scores:
            return []

        findings: list[DetectionResult] = []
        for label_id, score in sorted(
            setfit_scores.items(), key=lambda item: item[1], reverse=True
        ):
            if score < threshold:
                continue
            label_meta = next((label for label in labels if label.id == label_id), None)
            label_name = label_meta.name if label_meta else label_id
            findings.append(
                self._make_result(
                    finding_type=f"class:{label_id}",
                    category="CLASSIFICATION",
                    severity=Severity.medium if score < 0.86 else Severity.high,
                    confidence=score,
                    matched_content=content[:320],
                    location=None,
                    metadata={
                        "method": "CLASSIFIER",
                        "label_id": label_id,
                        "label_name": label_name,
                        "model": self._classifier_model_name(classifier),
                    },
                )
            )

        return findings

    def _detect_entity(self, content: str) -> list[DetectionResult]:
        entity_cfg = self.custom_config.entity or CustomEntityConfig()
        labels = [label.strip() for label in (entity_cfg.entity_labels or []) if label.strip()]
        if not labels:
            return []

        threshold = self.custom_config.confidence_threshold or 0.7
        model = self._load_entity_model(entity_cfg)
        if model is None:
            return []

        try:
            result = model.extract_entities(
                content,
                self._build_entity_schema(entity_cfg, labels),
                threshold=0.0,
                include_confidence=True,
                include_spans=True,
            )
        except Exception as exc:  # pragma: no cover - library/runtime specific
            logger.error("Custom entity detection with GLiNER2 failed: %s", exc)
            return []

        findings: list[DetectionResult] = []
        entities = result.get("entities", {})
        if not isinstance(entities, dict):
            return findings

        for label in labels:
            raw_spans = entities.get(label, [])
            if not isinstance(raw_spans, list):
                raw_spans = [raw_spans]

            for raw_span in raw_spans:
                normalized = self._normalize_gliner2_span(raw_span, content)
                if normalized is None:
                    continue

                matched, score, start, end = normalized
                if score < threshold:
                    continue

                findings.append(
                    self._make_result(
                        finding_type=f"entity:{label}",
                        category="CLASSIFICATION",
                        severity=Severity.medium,
                        confidence=min(0.99, max(0.0, score)),
                        matched_content=matched,
                        location=Location(start=start, end=end, path="custom-entity"),
                        metadata={
                            "method": "ENTITY",
                            "entity_label": label,
                            "model": entity_cfg.model or _DEFAULT_GLINER2_MODEL,
                        },
                    )
                )

        return findings

    def _build_entity_schema(
        self, entity_cfg: CustomEntityConfig, labels: list[str]
    ) -> list[str] | dict[str, str]:
        descriptions = entity_cfg.entity_descriptions or {}
        if not descriptions:
            return labels
        return {label: descriptions.get(label, "") for label in labels}

    def _normalize_gliner2_span(
        self, raw_span: Any, content: str
    ) -> tuple[str, float, int, int] | None:
        if isinstance(raw_span, dict):
            matched = str(raw_span.get("text", "")).strip()
            score = float(raw_span.get("confidence", raw_span.get("score", 0.0)))
            start = raw_span.get("start")
            end = raw_span.get("end")
        else:
            matched = str(raw_span).strip()
            score = 1.0
            start = None
            end = None

        if not matched and isinstance(start, int) and isinstance(end, int):
            matched = content[start:end].strip()
        if not matched:
            return None

        if not isinstance(start, int) or not isinstance(end, int):
            start = content.find(matched)
            end = start + len(matched) if start >= 0 else -1

        if start < 0 or end < 0:
            return None

        return matched, score, start, end

    def _load_entity_model(self, entity_cfg: CustomEntityConfig) -> Any | None:
        if self._entity_model is not None:
            return self._entity_model

        try:
            gliner2_module = require_module("gliner2", "custom", ["classification", "detectors"])
            model_name = entity_cfg.model or _DEFAULT_GLINER2_MODEL
            self._entity_model = gliner2_module.GLiNER2.from_pretrained(model_name)
            return self._entity_model
        except MissingDependencyError:
            raise
        except Exception as exc:  # pragma: no cover - environment specific
            logger.warning("Failed to initialize GLiNER2 for custom detector: %s", exc)
            return None

    def _classify_with_zero_shot(
        self, variants: list[str], classifier: CustomClassifierConfig
    ) -> dict[str, float]:
        labels = classifier.labels or []
        candidate_labels = [label.name for label in labels]
        if not candidate_labels:
            return {}

        pipeline = self._zero_shot_pipeline
        if pipeline is None:
            try:
                ensure_torch("custom", ["classification", "detectors"])
                transformers_module = require_module(
                    "transformers",
                    "custom",
                    ["classification", "detectors"],
                )
                pipeline = transformers_module.pipeline(
                    "zero-shot-classification",
                    model=classifier.zero_shot_model or "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
                    device=-1,
                )
                self._zero_shot_pipeline = pipeline
            except MissingDependencyError:
                raise
            except Exception as exc:  # pragma: no cover - model/runtime specific
                logger.warning("Zero-shot classifier init failed: %s", exc)
                return {}

        hypothesis_template = self._normalize_hypothesis_template(classifier.hypothesis_template)
        scores_by_label: dict[str, float] = {}

        for variant in variants:
            try:
                result = pipeline(
                    variant,
                    candidate_labels=candidate_labels,
                    hypothesis_template=hypothesis_template,
                    multi_label=True,
                )
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.warning("Zero-shot classification failed: %s", exc)
                continue

            labels_result = result.get("labels", [])
            scores_result = result.get("scores", [])
            for name, score in zip(labels_result, scores_result, strict=False):
                label_obj = next((label for label in labels if label.name == name), None)
                if label_obj is None:
                    continue
                current = scores_by_label.get(label_obj.id, 0.0)
                scores_by_label[label_obj.id] = max(current, float(score))

        return scores_by_label

    def _normalize_hypothesis_template(self, template: str | None) -> str:
        default_template = "This text contains {}."
        raw = (template or "").strip()
        if not raw:
            return default_template

        if "{}" in raw:
            return raw

        if "{label}" in raw:
            return raw.replace("{label}", "{}")

        if "{" in raw or "}" in raw:
            self._log_template_notice_once(
                "invalid",
                "Invalid hypothesis_template for custom detector '%s'; using default template.",
            )
            return default_template

        self._log_template_notice_once(
            f"missing:{raw}",
            "hypothesis_template for custom detector '%s' has no label placeholder; auto-appending one.",
        )
        if raw.endswith((".", "!", "?")):
            return f"{raw[:-1]} {{}}{raw[-1]}"
        return f"{raw} {{}}"

    def _log_template_notice_once(self, key: str, message: str) -> None:
        if key in self._template_notice_keys:
            return
        self._template_notice_keys.add(key)
        logger.warning(message, self.custom_config.custom_detector_key)

    def _classify_with_setfit(
        self, variants: list[str], classifier: CustomClassifierConfig
    ) -> dict[str, float]:
        model = self._load_or_train_setfit_model(classifier)
        if model is None:
            return {}

        labels = classifier.labels or []
        label_ids = [label.id for label in labels]
        if not label_ids:
            return {}

        probability_label_ids = self._map_setfit_probability_columns(model, label_ids)
        if not probability_label_ids:
            return {}

        scores_by_label: dict[str, float] = {}
        for variant in variants:
            try:
                probabilities = model.predict_proba([variant])[0]
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.warning("SetFit prediction failed: %s", exc)
                return {}

            for index, score in enumerate(probabilities):
                if index >= len(probability_label_ids):
                    continue
                label_id = probability_label_ids[index]
                if label_id is None:
                    continue
                current = scores_by_label.get(label_id, 0.0)
                scores_by_label[label_id] = max(current, float(score))

        return scores_by_label

    def _map_setfit_probability_columns(self, model: Any, label_ids: list[str]) -> list[str | None]:
        classes = getattr(getattr(model, "model_head", None), "classes_", None)
        if classes is None:
            classes = getattr(model, "classes_", None)

        if classes is None:
            return label_ids

        mapped_ids: list[str | None] = []
        for class_index in classes:
            try:
                normalized_index = operator.index(class_index)
            except TypeError:
                mapped_ids.append(None)
                continue

            if (
                isinstance(class_index, bool)
                or normalized_index < 0
                or normalized_index >= len(label_ids)
            ):
                mapped_ids.append(None)
                continue
            mapped_ids.append(label_ids[normalized_index])

        return mapped_ids

    def _load_or_train_setfit_model(self, classifier: CustomClassifierConfig) -> Any | None:
        if self._setfit_model is not None:
            return self._setfit_model

        examples = [example for example in (classifier.training_examples or []) if example.accepted]
        if not self._can_train_setfit(examples, classifier):
            return None

        try:
            setfit_module = require_module("setfit", "custom", ["classification", "detectors"])
            datasets_module = require_module("datasets", "custom", ["classification", "detectors"])
        except MissingDependencyError:
            raise
        except Exception as exc:  # pragma: no cover - environment specific
            logger.warning("SetFit dependencies unavailable: %s", exc)
            return None

        model_dir = self._setfit_artifact_dir(classifier, examples)
        model_dir.mkdir(parents=True, exist_ok=True)
        model_path = model_dir / "config.json"

        try:
            if model_path.exists():
                self._setfit_model = setfit_module.SetFitModel.from_pretrained(str(model_dir))
                return self._setfit_model

            labels = classifier.labels or []
            label_index = {label.id: idx for idx, label in enumerate(labels)}
            texts: list[str] = []
            targets: list[int] = []
            for example in examples:
                index = label_index.get(example.label)
                if index is None:
                    continue
                texts.append(example.text)
                targets.append(index)

            if len(set(targets)) < 2:
                return None

            train_dataset = datasets_module.Dataset.from_dict({"text": texts, "label": targets})
            model = setfit_module.SetFitModel.from_pretrained(
                classifier.setfit_model
                or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
            )
            trainer = setfit_module.SetFitTrainer(
                model=model,
                train_dataset=train_dataset,
                num_iterations=20,
                column_mapping={"text": "text", "label": "label"},
            )
            trainer.train()
            model.save_pretrained(str(model_dir))
            self._setfit_model = model
            return self._setfit_model
        except Exception as exc:  # pragma: no cover - training/runtime specific
            logger.warning("SetFit training/loading failed, falling back to zero-shot: %s", exc)
            return None

    def _can_train_setfit(
        self,
        examples: list[CustomClassifierTrainingExample],
        classifier: CustomClassifierConfig,
    ) -> bool:
        if not examples:
            return False
        min_per_label = classifier.min_examples_per_label or 8
        counts: dict[str, int] = {}
        for example in examples:
            counts[example.label] = counts.get(example.label, 0) + 1

        eligible = [label for label, count in counts.items() if count >= min_per_label]
        return len(eligible) >= 2

    def _setfit_artifact_dir(
        self,
        classifier: CustomClassifierConfig,
        examples: list[CustomClassifierTrainingExample],
    ) -> Path:
        source_id = os.getenv("SOURCE_ID", "global")
        cache_root = Path(
            os.getenv("CLASSIFYRE_MODEL_CACHE_DIR", "~/.cache/classifyre")
        ).expanduser()
        signature_payload = {
            "classifier": classifier.model_dump(mode="json"),
            "examples": [example.model_dump(mode="json") for example in examples],
        }
        signature = hashlib.sha256(
            json.dumps(signature_payload, sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]
        return (
            cache_root
            / "custom-detectors"
            / source_id
            / self.custom_config.custom_detector_key
            / signature
        )

    def _classifier_model_name(self, classifier: CustomClassifierConfig) -> str:
        if self._setfit_model is not None:
            return classifier.setfit_model or "setfit"
        return classifier.zero_shot_model or "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"

    def _keyword_matches(self, content: str, rule: CustomKeywordRule) -> list[tuple[str, int, int]]:
        findings: list[tuple[str, int, int]] = []
        flags = 0 if rule.case_sensitive else re.IGNORECASE
        for keyword in rule.keywords:
            escaped = re.escape(keyword)
            for match in re.finditer(escaped, content, flags=flags):
                matched = match.group(0)
                if matched:
                    findings.append((matched, match.start(), match.end()))
        return findings

    def _compile_regex_rules(
        self, ruleset: CustomRulesetConfig | None
    ) -> list[tuple[CustomRegexRule, re.Pattern[str]]]:
        if ruleset is None or not ruleset.regex_rules:
            return []

        compiled_rules: list[tuple[CustomRegexRule, re.Pattern[str]]] = []
        for rule in ruleset.regex_rules:
            if not self._is_safe_regex(rule.pattern):
                logger.warning("Skipping unsafe custom regex rule %s", rule.id)
                continue
            flags = 0
            for flag in rule.flags or "":
                if flag == "i":
                    flags |= re.IGNORECASE
                elif flag == "m":
                    flags |= re.MULTILINE
                elif flag == "s":
                    flags |= re.DOTALL
            try:
                compiled_rules.append((rule, re.compile(rule.pattern, flags=flags)))
            except re.error as exc:
                logger.warning("Skipping invalid custom regex rule %s: %s", rule.id, exc)
        return compiled_rules

    def _is_safe_regex(self, pattern: str) -> bool:
        if len(pattern) > 512:
            return False
        if re.search(r"\(\?R|\(\?0|\(\?P>", pattern):
            return False
        if pattern.count(".*") > 4:
            return False
        if re.search(r"(\([^)]+[+*]\)[+*]){2,}", pattern):
            return False
        return True

    def _content_variants(self, content: str) -> list[str]:
        variants = [content]
        languages = [language.lower() for language in (self.custom_config.languages or [])]
        if any(language.startswith("de") for language in languages):
            split_content = self._split_german_compounds(content)
            if split_content != content:
                variants.append(split_content)
        return variants

    def _split_german_compounds(self, content: str) -> str:
        def split_word(word: str) -> str:
            if len(word) < 16:
                return word
            lowered = word.lower()
            boundaries: list[int] = []
            for part in _GERMAN_MERGE_PARTS:
                idx = lowered.find(part)
                if idx > 2:
                    boundaries.append(idx)
                end_idx = idx + len(part)
                if idx >= 0 and end_idx < len(word) - 2:
                    boundaries.append(end_idx)

            unique_boundaries = sorted(set(boundaries))
            if not unique_boundaries:
                return word

            pieces: list[str] = []
            cursor = 0
            for boundary in unique_boundaries:
                if boundary <= cursor or boundary >= len(word):
                    continue
                pieces.append(word[cursor:boundary])
                cursor = boundary
            if cursor < len(word):
                pieces.append(word[cursor:])

            cleaned = [piece for piece in pieces if len(piece) > 1]
            return " ".join(cleaned) if len(cleaned) > 1 else word

        return re.sub(
            r"\b[A-Za-zÄÖÜäöüß]{16,}\b",
            lambda match: split_word(match.group(0)),
            content,
        )

    def _make_result(
        self,
        *,
        finding_type: str,
        category: str,
        severity: Severity,
        confidence: float,
        matched_content: str,
        location: Location | None,
        metadata: dict[str, Any],
    ) -> DetectionResult:
        return DetectionResult(
            detector_type=DetectorType.CUSTOM,
            finding_type=finding_type,
            category=category,
            severity=severity,
            confidence=min(0.99, max(0.0, confidence)),
            matched_content=matched_content,
            location=location,
            custom_detector_key=self.custom_config.custom_detector_key,
            custom_detector_name=self.custom_config.name,
            metadata={
                "custom_detector_key": self.custom_config.custom_detector_key,
                "custom_detector_name": self.custom_config.name,
                **metadata,
            },
        )
