"""Runner factory for custom detector pipelines.

Each concrete runner handles one execution strategy (GLINER2, REGEX, LLM) and
produces a standardised PipelineResult. New strategies are added by subclassing
BaseRunner and registering in create_runner().

Artifact directory layout written by trainer.py:
  <artifact_dir>/
    manifest.json          -- training metadata
    gliner2/               -- fine-tuned GLiNER2 model (HF format)
    setfit/<task>/         -- SetFit model per classification task
    setfit/<task>/labels.json
"""

from __future__ import annotations

import json
import logging
import re
import time
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ...models.generated_detectors import (
    GLiNER2PipelineSchema,
    LLMPipelineSchema,
    PipelineEntityDefinition,
    PipelineResult,
    PipelineValidationConfig,
    RegexPatternDefinition,
    RegexPipelineSchema,
)
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)

_DEFAULT_GLINER2_MODEL = "fastino/gliner2-base-v1"


# ── Base ──────────────────────────────────────────────────────────────────────


class BaseRunner(ABC):
    """Common interface for all pipeline execution strategies."""

    @abstractmethod
    def run(self, text: str) -> PipelineResult:
        """Execute the pipeline on *text* and return a normalised PipelineResult."""
        ...


# ── GLiNER2 runner ────────────────────────────────────────────────────────────


class GLiNER2Runner(BaseRunner):
    """Execute a GLiNER2 pipeline: single-model pass for entities + classification.

    When the pipeline schema's model.path points to a trained artifact directory
    (written by trainer.py), the runner:
      - loads the fine-tuned GLiNER2 weights from <path>/gliner2/ if present
      - uses per-task SetFit models from <path>/setfit/<task>/ for classification
    """

    def __init__(self, schema: GLiNER2PipelineSchema, detector_key: str = "") -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._model: Any | None = None
        # SetFit models keyed by classification task name
        self._setfit_models: dict[str, Any] | None = None
        self._setfit_labels: dict[str, list[str]] = {}
        self._artifact_dir: Path | None = None
        self._init_artifact_dir()

    def _init_artifact_dir(self) -> None:
        model_cfg = self._schema.model
        if not model_cfg or not model_cfg.path:
            return
        candidate = Path(model_cfg.path)
        if candidate.is_dir() and (candidate / "manifest.json").exists():
            self._artifact_dir = candidate
            logger.info(
                "Artifact directory detected for detector '%s': %s",
                self._detector_key,
                candidate,
            )

    def run(self, text: str) -> PipelineResult:
        start_ms = time.monotonic()
        model = self._load_model()
        if model is None:
            return PipelineResult()

        entity_schema = self._build_entity_schema()
        classification_tasks = self._build_classification_tasks()

        raw_entities: dict[str, list[dict[str, object]]] = {}
        raw_classification: dict[str, dict[str, object]] = {}

        try:
            if entity_schema:
                raw = model.extract_entities(
                    text,
                    entity_schema,
                    threshold=0.0,
                    include_confidence=True,
                    include_spans=True,
                )
                raw_entities = _normalise_entity_output(raw, text)

            for task_name, labels in classification_tasks.items():
                setfit = self._get_setfit_model(task_name)
                if setfit is not None:
                    raw_cls = self._run_setfit(setfit, task_name, text)
                else:
                    raw_cls = model.classify(text, labels, threshold=0.0)
                raw_classification[task_name] = _normalise_classification_output(raw_cls)

        except Exception as exc:  # pragma: no cover - runtime specific
            logger.error("GLiNER2 pipeline failed for detector '%s': %s", self._detector_key, exc)
            return PipelineResult()

        validation = self._schema.validation or PipelineValidationConfig()
        filtered_entities = _apply_entity_validation(raw_entities, validation, self._schema)
        filtered_classification = _apply_classification_validation(raw_classification, validation)

        latency_ms = round((time.monotonic() - start_ms) * 1000)
        model_cfg = self._schema.model
        model_name = (
            model_cfg.name if model_cfg else _DEFAULT_GLINER2_MODEL
        ) or _DEFAULT_GLINER2_MODEL
        runner_tag = "GLINER2+ARTIFACT" if self._artifact_dir else "GLINER2"

        return PipelineResult(
            entities=filtered_entities,
            classification=filtered_classification,
            metadata={
                "model": model_name,
                "runner": runner_tag,
                "latency_ms": latency_ms,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    def _load_model(self) -> Any | None:
        if self._model is not None:
            return self._model

        # If we have a fine-tuned artifact, prefer the gliner2/ subdir
        if self._artifact_dir is not None:
            gliner_path = self._artifact_dir / "gliner2"
            if gliner_path.is_dir():
                model_name = str(gliner_path)
                logger.info(
                    "Loading fine-tuned GLiNER2 from '%s' for detector '%s'",
                    model_name,
                    self._detector_key,
                )
                try:
                    gliner2_module = require_module(
                        "gliner2", "custom", ["classification", "detectors"]
                    )
                    self._model = gliner2_module.GLiNER2.from_pretrained(model_name)
                    return self._model
                except Exception as exc:
                    logger.warning("Failed to load fine-tuned GLiNER2, falling back: %s", exc)

        model_cfg = self._schema.model
        if model_cfg and model_cfg.path and not self._artifact_dir:
            model_name = model_cfg.path
        elif model_cfg and model_cfg.name:
            model_name = model_cfg.name
        else:
            model_name = _DEFAULT_GLINER2_MODEL

        try:
            gliner2_module = require_module("gliner2", "custom", ["classification", "detectors"])
            self._model = gliner2_module.GLiNER2.from_pretrained(model_name)
            logger.info(
                "GLiNER2 model '%s' loaded for detector '%s'", model_name, self._detector_key
            )
            return self._model
        except MissingDependencyError:
            raise
        except Exception as exc:  # pragma: no cover - environment specific
            logger.warning(
                "Failed to load GLiNER2 model '%s' for detector '%s': %s",
                model_name,
                self._detector_key,
                exc,
            )
            return None

    def _get_setfit_model(self, task_name: str) -> Any | None:
        """Return the SetFit model for task_name if a trained artifact exists."""
        if self._artifact_dir is None:
            return None

        if self._setfit_models is None:
            self._setfit_models = {}

        if task_name in self._setfit_models:
            return self._setfit_models[task_name]

        model_path = self._artifact_dir / "setfit" / task_name
        labels_path = model_path / "labels.json"
        if not model_path.is_dir() or not labels_path.exists():
            self._setfit_models[task_name] = None
            return None

        try:
            from setfit import SetFitModel  # type: ignore[import-untyped]

            sfm = SetFitModel.from_pretrained(str(model_path))
            self._setfit_models[task_name] = sfm
            self._setfit_labels[task_name] = json.loads(labels_path.read_text())
            logger.info("SetFit model for task '%s' loaded from '%s'", task_name, model_path)
            return sfm
        except Exception as exc:
            logger.warning("Failed to load SetFit model for task '%s': %s", task_name, exc)
            self._setfit_models[task_name] = None
            return None

    def _run_setfit(self, model: Any, task_name: str, text: str) -> dict[str, object]:
        """Run a SetFit model and return a label/confidence dict."""
        try:
            import torch  # type: ignore[import-untyped]

            labels = self._setfit_labels.get(task_name, [])
            with torch.no_grad():
                probs = model.predict_proba([text])
            # probs shape: (1, num_labels)
            prob_row = probs[0].tolist() if hasattr(probs[0], "tolist") else list(probs[0])
            best_idx = int(max(range(len(prob_row)), key=lambda i: prob_row[i]))
            best_label = labels[best_idx] if best_idx < len(labels) else str(best_idx)
            best_conf = float(prob_row[best_idx]) if best_idx < len(prob_row) else 0.0
            return {"label": best_label, "confidence": round(best_conf, 4)}
        except Exception as exc:
            logger.warning("SetFit inference failed for task '%s': %s", task_name, exc)
            return {}

    def _build_entity_schema(self) -> dict[str, str]:
        entities = self._schema.entities or {}
        return {
            label: defn.description if isinstance(defn, PipelineEntityDefinition) else str(defn)
            for label, defn in entities.items()
        }

    def _build_classification_tasks(self) -> dict[str, list[str]]:
        return {task: defn.labels for task, defn in (self._schema.classification or {}).items()}


# ── REGEX runner ──────────────────────────────────────────────────────────────


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

    def __init__(self, schema: RegexPipelineSchema, detector_key: str = "") -> None:
        self._schema = schema
        self._detector_key = detector_key
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


# ── LLM runner (stub) ─────────────────────────────────────────────────────────


class LLMRunner(BaseRunner):
    """LLM-based detection — not yet implemented."""

    def __init__(self, schema: LLMPipelineSchema, detector_key: str = "") -> None:
        self._schema = schema
        self._detector_key = detector_key

    def run(self, text: str) -> PipelineResult:  # pragma: no cover - stub
        raise NotImplementedError(
            f"LLM runner is not yet implemented (detector '{self._detector_key}')"
        )


# ── Factory ───────────────────────────────────────────────────────────────────


def create_runner(
    schema: GLiNER2PipelineSchema | RegexPipelineSchema | LLMPipelineSchema,
    detector_key: str = "",
) -> BaseRunner:
    """Return the appropriate runner for *schema* based on its type discriminator."""
    if isinstance(schema, RegexPipelineSchema):
        return RegexRunner(schema, detector_key)
    if isinstance(schema, LLMPipelineSchema):
        return LLMRunner(schema, detector_key)
    # GLiNER2PipelineSchema is the default / backward-compat path
    return GLiNER2Runner(schema, detector_key)


# ── Shared helpers ────────────────────────────────────────────────────────────


def _normalise_entity_output(raw: dict[str, Any], text: str) -> dict[str, list[dict[str, object]]]:
    result: dict[str, list[dict[str, object]]] = {}
    entities = raw.get("entities", raw)
    if not isinstance(entities, dict):
        return result

    for label, spans in entities.items():
        span_list: list[Any] = spans if isinstance(spans, list) else [spans]
        normalised = [s for s in (_normalise_span(span, text) for span in span_list) if s]
        if normalised:
            result[label] = normalised

    return result


def _normalise_span(span: Any, text: str) -> dict[str, object] | None:
    if isinstance(span, dict):
        value = str(span.get("text", "")).strip()
        confidence = float(span.get("confidence", span.get("score", 0.0)))
        start = span.get("start")
        end = span.get("end")
    else:
        value = str(span).strip()
        confidence = 1.0
        start = None
        end = None

    if not value and isinstance(start, int) and isinstance(end, int):
        value = text[start:end].strip()
    if not value:
        return None

    if not isinstance(start, int) or not isinstance(end, int):
        start = text.find(value)
        end = start + len(value) if start >= 0 else -1

    if start < 0:
        return None

    return {"value": value, "confidence": round(confidence, 4), "start": start, "end": end}


def _normalise_classification_output(raw: Any) -> dict[str, object]:
    if isinstance(raw, dict):
        label = raw.get("label", "")
        confidence = float(raw.get("confidence", raw.get("score", 0.0)))
    elif isinstance(raw, (list, tuple)) and raw:
        best = max(raw, key=lambda x: x.get("score", 0.0) if isinstance(x, dict) else 0.0)
        label = best.get("label", "") if isinstance(best, dict) else str(best)
        confidence = float(best.get("score", 0.0)) if isinstance(best, dict) else 1.0
    else:
        return {}

    return {"label": label, "confidence": round(confidence, 4)}


def _apply_entity_validation(
    entities: dict[str, list[dict[str, object]]],
    validation: PipelineValidationConfig,
    schema: GLiNER2PipelineSchema,
) -> dict[str, list[dict[str, object]]]:
    threshold = validation.confidence_threshold or 0.7
    result: dict[str, list[dict[str, object]]] = {}

    for label, spans in entities.items():
        passing = [
            span
            for span in spans
            if isinstance(span.get("confidence"), (int, float))
            and float(span["confidence"]) >= threshold  # type: ignore[arg-type]
        ]
        for rule in validation.rules or []:
            if rule.field == label and rule.type == "regex" and rule.pattern:
                try:
                    rx = re.compile(rule.pattern)
                    passing = [s for s in passing if rx.search(str(s.get("value", "")))]
                except re.error as exc:
                    logger.warning("Invalid validation regex for field '%s': %s", label, exc)
        if passing:
            result[label] = passing

    for label, defn in (schema.entities or {}).items():
        if isinstance(defn, PipelineEntityDefinition) and defn.required and label not in result:
            logger.debug("Required entity '%s' not found — suppressing all findings", label)
            return {}

    return result


def _apply_classification_validation(
    classification: dict[str, dict[str, object]],
    validation: PipelineValidationConfig,
) -> dict[str, dict[str, object]]:
    threshold = validation.confidence_threshold or 0.7
    return {
        task: outcome
        for task, outcome in classification.items()
        if isinstance(outcome.get("confidence", 0.0), (int, float))
        and float(outcome["confidence"]) >= threshold  # type: ignore[arg-type]
    }
