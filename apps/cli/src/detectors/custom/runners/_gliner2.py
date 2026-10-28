"""GLiNER2 pipeline runner (GLiNER2 and GLiNER2.5 checkpoints)."""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ....models.generated_detectors import (
    GLiNER2PipelineSchema,
    PipelineEntityDefinition,
    PipelineResult,
    PipelineValidationConfig,
    Severity,
)
from ...dependencies import MissingDependencyError, require_module
from ._base import _DEFAULT_GLINER2_MODEL, BaseRunner, _resolve_pipeline_severity
from ._text_classification import _chunk_text

logger = logging.getLogger(__name__)

# A plain extract_entities call reads one encoder window and silently drops the
# rest of the text. Above this char threshold we use the library's
# extract_entities_long (chunked, offsets mapped back to the source) when
# available, and run classification per-chunk, keeping each label's highest
# confidence across chunks.
_LONG_TEXT_CHAR_THRESHOLD = 3000
_CLS_CHUNK_SIZE = 3000
_CLS_CHUNK_OVERLAP = 200
# Bound per-asset CPU cost on pathological inputs.
_MAX_CLS_CHUNKS = 50
# Chunks scored together per forward pass on CPU.
_CLS_BATCH_SIZE = 8
# A task with read_from "start" judges only this many leading characters: the
# title, parties and purpose, where a document says what it is.
_START_CHARS = 2400


class GLiNER2Runner(BaseRunner):
    """Execute a GLiNER2 pipeline: single-model pass for entities + classification.

    When the pipeline schema's model.path points to a trained artifact directory
    (written by trainer.py), the runner:
      - loads the fine-tuned GLiNER2 weights from <path>/gliner2/ if present
      - uses per-task SetFit models from <path>/setfit/<task>/ for classification
    """

    def __init__(
        self, schema: GLiNER2PipelineSchema, detector_key: str = "", detector_name: str = ""
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        self._model: Any | None = None
        self._load_error: str | None = None
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

        setfit_tasks = {
            task: labels
            for task, labels in classification_tasks.items()
            if self._get_setfit_model(task) is not None
        }
        zero_shot = {
            task: labels
            for task, labels in classification_tasks.items()
            if task not in setfit_tasks
        }
        # A long document's type is in its opening; judged over every piece,
        # whichever label peaks in any one section wins instead.
        from_start = {task: labels for task, labels in zero_shot.items() if self._reads_start(task)}
        whole = {task: labels for task, labels in zero_shot.items() if task not in from_start}

        joint = self._extract_jointly(model, text, entity_schema, whole)
        if joint is not None:
            raw_entities, raw_classification = joint
        else:
            raw_entities, raw_classification = self._extract_separately(
                model, text, entity_schema, whole
            )
        if from_start:
            raw_classification.update(self._classify_tasks(model, text[:_START_CHARS], from_start))
        raw_classification.update(self._classify_setfit(text, setfit_tasks))

        # No early return for an empty result: "ran and found nothing" is a
        # legitimate outcome and must still produce a well-formed result with
        # metadata. Failures are reported by the logs above and by the runner's
        # detector outcome, not by an anonymous empty return.
        validation = self._schema.validation or PipelineValidationConfig()
        filtered_entities = _apply_entity_validation(
            _collapse_repeated_values(raw_entities), validation, self._schema
        )
        filtered_classification = _apply_classification_validation(raw_classification, validation)
        for label, spans in filtered_entities.items():
            severity = self._severity_for_entity(label).value
            for span in spans:
                span["severity"] = severity
        for task, outcome in filtered_classification.items():
            outcome["severity"] = self._severity_for_classification(
                task, str(outcome.get("label", ""))
            ).value
            for item in outcome.get("labels") or []:  # type: ignore[union-attr]
                if isinstance(item, dict):
                    item["severity"] = self._severity_for_classification(
                        task, str(item.get("label", ""))
                    ).value

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

    def _extract_jointly(
        self,
        model: Any,
        text: str,
        entity_schema: dict[str, dict[str, str]],
        tasks: dict[str, list[str]],
    ) -> tuple[dict[str, list[dict[str, object]]], dict[str, dict[str, object]]] | None:
        """Entities and every zero-shot task in one forward pass per chunk.

        This is what the model is built for: one schema, many tasks. A long text
        is read in overlapping word chunks by the library, which maps every span
        back to its position in the full text and keeps each classification
        label at its strongest chunk. Returns None when the runtime cannot do a
        joint pass, or when it fails, so the caller falls back to one call per
        kind of output.
        """
        create_schema = getattr(model, "create_schema", None)
        extract = getattr(model, "extract", None)
        extract_long = getattr(model, "extract_long", None)
        if create_schema is None or extract is None or (not entity_schema and not tasks):
            return None
        try:
            schema = create_schema()
            if entity_schema:
                schema = schema.entities(entity_schema)
            for task, labels in tasks.items():
                config = self._task_config(task, labels)
                schema = schema.classification(
                    task,
                    config["labels"],
                    multi_label=config["multi_label"],
                    cls_threshold=config["cls_threshold"],
                )
            kwargs: dict[str, Any] = {
                "threshold": self._threshold(),
                "include_confidence": True,
                "include_spans": True,
            }
            if extract_long is not None and len(text) > _LONG_TEXT_CHAR_THRESHOLD:
                raw = extract_long(text, schema, **kwargs)
            else:
                raw = extract(text, schema, **kwargs)
            if not isinstance(raw, dict):
                raise TypeError(f"unexpected result type {type(raw).__name__}")
        except Exception as exc:  # pragma: no cover - runtime specific
            logger.warning(
                "GLiNER2 joint pass failed for detector '%s', running entities and "
                "classification separately: %s",
                self._detector_key,
                exc,
            )
            return None

        entities = (
            _normalise_entity_output(raw.get("entities") or {}, text) if entity_schema else {}
        )
        classification: dict[str, dict[str, object]] = {}
        for task in tasks:
            per_label: dict[str, float] = {}
            for label, confidence in _label_confidences(raw.get(task)):
                per_label[label] = max(confidence, per_label.get(label, -1.0))
            outcome = _classification_outcome(
                per_label, multi_label=bool(self._task_config(task, tasks[task])["multi_label"])
            )
            if outcome:
                classification[task] = outcome
        return entities, classification

    def _extract_separately(
        self,
        model: Any,
        text: str,
        entity_schema: dict[str, dict[str, str]],
        tasks: dict[str, list[str]],
    ) -> tuple[dict[str, list[dict[str, object]]], dict[str, dict[str, object]]]:
        """Entities in one call, classification in another, each failing on its own.

        Entity extraction and classification used to share one try/except, so a
        classification failure discarded the entities already extracted in the
        same run and returned an empty result — the whole detector went silent
        because of one broken task.
        """
        raw_entities: dict[str, list[dict[str, object]]] = {}
        if entity_schema:
            try:
                raw = self._extract_entities(model, text, entity_schema)
                raw_entities = _normalise_entity_output(raw, text)
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.error(
                    "GLiNER2 entity extraction failed for detector '%s': %s",
                    self._detector_key,
                    exc,
                )
        raw_classification = self._classify_tasks(model, text, tasks) if tasks else {}
        return raw_entities, raw_classification

    def _classify_setfit(
        self, text: str, tasks: dict[str, list[str]]
    ) -> dict[str, dict[str, object]]:
        outcomes: dict[str, dict[str, object]] = {}
        for task_name in tasks:
            setfit = self._get_setfit_model(task_name)
            if setfit is None:
                continue
            try:
                outcome = _normalise_classification_output(
                    self._run_setfit(setfit, task_name, text)
                )
                if outcome:
                    outcomes[task_name] = outcome
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.error(
                    "GLiNER2 classification task '%s' failed for detector '%s': %s",
                    task_name,
                    self._detector_key,
                    exc,
                )
        return outcomes

    def _extract_entities(
        self, model: Any, text: str, entity_schema: dict[str, dict[str, str]]
    ) -> Any:
        """Extract entities, using the library's chunked long-document API for large texts.

        The model is asked for spans at the validation threshold itself. Asking
        for everything (threshold 0) and filtering afterwards makes the model
        format thousands of near-zero spans per chunk on a long document.
        """
        kwargs: dict[str, Any] = {
            "threshold": self._threshold(),
            "include_confidence": True,
            "include_spans": True,
        }
        extract_long = getattr(model, "extract_entities_long", None)
        if extract_long is not None and len(text) > _LONG_TEXT_CHAR_THRESHOLD:
            try:
                return extract_long(text, entity_schema, **kwargs)
            except TypeError:
                logger.debug(
                    "extract_entities_long signature mismatch for detector '%s', "
                    "falling back to extract_entities",
                    self._detector_key,
                )
        return model.extract_entities(text, entity_schema, **kwargs)

    def _classify_once(
        self,
        model: Any,
        text: str,
        task_name: str,
        labels: list[str],
        task_config: dict[str, Any] | None = None,
    ) -> Any:
        """Run one classification task against whichever API the runtime exposes.

        gliner2>=1.3 exposes `classify_text(text, tasks: dict, ...)`, where tasks
        maps a task name to its labels (or to a config dict carrying labels,
        label descriptions and multi_label) and the result is keyed by that name.
        Mirrors the defensive probing in _extract_entities rather than assuming
        a method exists.
        """
        classify_text = getattr(model, "classify_text", None)
        if classify_text is not None:
            raw = classify_text(
                text,
                {task_name: task_config if task_config is not None else list(labels)},
                threshold=0.0,
                include_confidence=True,
            )
            # classify_text returns {task_name: <result>}; unwrap to the result.
            if isinstance(raw, dict) and task_name in raw:
                return raw[task_name]
            return raw

        legacy_classify = getattr(model, "classify", None)
        if legacy_classify is None:
            raise AttributeError(
                f"GLiNER2 model exposes neither 'classify_text' nor 'classify'; "
                f"cannot run classification task '{task_name}'"
            )
        return legacy_classify(text, labels, threshold=0.0)

    def _classify_tasks(
        self, model: Any, text: str, tasks: dict[str, list[str]]
    ) -> dict[str, dict[str, object]]:
        """Classify every zero-shot task, all of them in one pass per chunk.

        If the joint pass fails, each task is retried alone, so one broken task
        cannot silence the others.
        """
        try:
            return self._classify_tasks_chunked(model, text, tasks)
        except Exception as exc:  # pragma: no cover - runtime specific
            logger.warning(
                "GLiNER2 joint classification failed for detector '%s', retrying task by task: %s",
                self._detector_key,
                exc,
            )
        outcomes: dict[str, dict[str, object]] = {}
        for task_name, labels in tasks.items():
            try:
                outcome = self._classify_tasks_chunked(model, text, {task_name: labels})
                outcomes.update(outcome)
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.error(
                    "GLiNER2 classification task '%s' failed for detector '%s': %s",
                    task_name,
                    self._detector_key,
                    exc,
                )
        return outcomes

    def _classify_chunked(
        self, model: Any, text: str, task_name: str, labels: list[str]
    ) -> dict[str, object]:
        """One task over the whole text; see _classify_tasks_chunked."""
        return self._classify_tasks_chunked(model, text, {task_name: labels}).get(task_name, {})

    def _classify_tasks_chunked(
        self, model: Any, text: str, tasks: dict[str, list[str]]
    ) -> dict[str, dict[str, object]]:
        """Classify text, chunking long inputs and keeping each label's max confidence.

        All tasks share one model call per chunk, and the chunks go through the
        library's batch API when it has one: a long contract with two tasks is
        one batched pass over its chunks, not two calls per chunk.

        Single-label tasks keep the strongest label over all chunks. Multi-label
        tasks keep every label, each at its strongest chunk, so a label that is
        clear in one section of a long document is not lost to the others.
        """
        configs = {task: self._task_config(task, labels) for task, labels in tasks.items()}
        all_chunks = _chunk_text(text, _CLS_CHUNK_SIZE, _CLS_CHUNK_OVERLAP)
        chunks = all_chunks[:_MAX_CLS_CHUNKS]
        if len(all_chunks) > _MAX_CLS_CHUNKS:
            logger.warning(
                "GLiNER2 classification for detector '%s': text of %d chars needs %d chunks, "
                "capping at %d; the remainder was not classified",
                self._detector_key,
                len(text),
                len(all_chunks),
                _MAX_CLS_CHUNKS,
            )

        per_task: dict[str, dict[str, float]] = {task: {} for task in tasks}
        for chunk_result in self._classify_chunks(model, chunks, tasks, configs):
            for task in tasks:
                for label, confidence in _label_confidences(chunk_result.get(task)):
                    if confidence > per_task[task].get(label, -1.0):
                        per_task[task][label] = confidence
        return {
            task: outcome
            for task in tasks
            if (
                outcome := _classification_outcome(
                    per_task[task], multi_label=bool(configs[task].get("multi_label"))
                )
            )
        }

    def _classify_chunks(
        self,
        model: Any,
        chunks: list[str],
        tasks: dict[str, list[str]],
        configs: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """One {task: raw result} per chunk, from the cheapest API the runtime has."""
        batch = getattr(model, "batch_classify_text", None)
        if batch is not None and len(chunks) > 1:
            results = batch(
                chunks,
                configs,
                batch_size=_CLS_BATCH_SIZE,
                threshold=0.0,
                include_confidence=True,
            )
            return [r if isinstance(r, dict) else {} for r in results]
        if getattr(model, "classify_text", None) is not None:
            out = []
            for chunk in chunks:
                raw = model.classify_text(chunk, configs, threshold=0.0, include_confidence=True)
                out.append(raw if isinstance(raw, dict) else {})
            return out
        # A runtime without classify_text: the older one-task API, task by task.
        return [
            {
                task: self._classify_once(model, chunk, task, labels)
                for task, labels in tasks.items()
            }
            for chunk in chunks
        ]

    def _load_model(self) -> Any | None:
        if self._model is not None:
            return self._model
        if self._load_error is not None:
            logger.debug(
                "GLiNER2 model previously failed to load for detector '%s': %s",
                self._detector_key,
                self._load_error,
            )
            return None

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
                    self._model = _from_pretrained(gliner2_module, model_name)
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
            self._model = _from_pretrained(gliner2_module, model_name)
            logger.info(
                "GLiNER2 model '%s' loaded for detector '%s'", model_name, self._detector_key
            )
            return self._model
        except MissingDependencyError:
            raise
        except Exception as exc:  # pragma: no cover - environment specific
            # Raise on the first failure so the scan records one structured error
            # instead of silently reporting zero findings; later assets skip
            # quietly via the cached _load_error above.
            self._load_error = str(exc)
            raise RuntimeError(
                f"GLiNER2 model '{model_name}' failed to load for detector "
                f"'{self._detector_key}': {exc}"
            ) from exc

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
            prob_row = probs[0].tolist() if hasattr(probs[0], "tolist") else list(probs[0])
            best_idx = int(max(range(len(prob_row)), key=lambda i: prob_row[i]))
            best_label = labels[best_idx] if best_idx < len(labels) else str(best_idx)
            best_conf = float(prob_row[best_idx]) if best_idx < len(prob_row) else 0.0
            return {"label": best_label, "confidence": round(best_conf, 4)}
        except Exception as exc:
            logger.warning("SetFit inference failed for task '%s': %s", task_name, exc)
            return {}

    def _reads_start(self, task: str) -> bool:
        defn = (self._schema.classification or {}).get(task)
        read_from = getattr(defn, "read_from", None) if defn else None
        return str(getattr(read_from, "value", read_from) or "whole") == "start"

    def _threshold(self) -> float:
        validation = self._schema.validation or PipelineValidationConfig()
        return validation.confidence_threshold or 0.7

    def _build_entity_schema(self) -> dict[str, dict[str, str]]:
        """Entity labels in the library's config form; descriptions only when written.

        An empty description is left out rather than sent as "", so the model
        reads the bare label instead of a label with a blank explanation.
        """
        schema: dict[str, dict[str, str]] = {}
        for label, defn in (self._schema.entities or {}).items():
            description = (
                defn.description if isinstance(defn, PipelineEntityDefinition) else str(defn)
            )
            description = (description or "").strip()
            schema[label] = {"description": description} if description else {}
        return schema

    def _build_classification_tasks(self) -> dict[str, list[str]]:
        return {
            task: list(defn.labels or [])
            for task, defn in (self._schema.classification or {}).items()
        }

    def _task_config(self, task_name: str, labels: list[str]) -> dict[str, Any]:
        """The library task config: labels (with descriptions when given) and multi_label.

        cls_threshold is 0 so multi-label tasks return every label with its
        confidence; the detector's own threshold is applied afterwards, the same
        way it is for entities.
        """
        defn = (self._schema.classification or {}).get(task_name)
        descriptions = {
            label: text.strip()
            for label, text in ((defn.descriptions if defn else None) or {}).items()
            if label in labels and isinstance(text, str) and text.strip()
        }
        label_spec: list[str] | dict[str, str] = (
            {label: descriptions.get(label, "") for label in labels}
            if descriptions
            else list(labels)
        )
        return {
            "labels": label_spec,
            "multi_label": bool(defn.multi_label) if defn else False,
            "cls_threshold": 0.0,
        }

    def _severity_for_entity(self, label: str) -> Severity:
        return _resolve_pipeline_severity(label, self._schema.severity_map, Severity.info)

    def _severity_for_classification(self, task: str, label: str) -> Severity:
        """The first severity rule matching the task name or the chosen label."""
        for rule in self._schema.severity_map or []:
            if _rule_matches(rule.pattern, task) or _rule_matches(rule.pattern, label):
                return rule.severity
        return Severity.info


# ── Normalisation helpers (used only by GLiNER2Runner) ────────────────────────


def _from_pretrained(gliner2_module: Any, model_name: str) -> Any:
    """Load any GLiNER2-family checkpoint.

    GLiNER2.5 checkpoints use a boundary head that ``GLiNER2.from_pretrained``
    cannot load (it is span-only and fails with an AttributeError on the
    config). ``AutoExtractor`` reads the checkpoint's architecture and returns
    the matching class, so GLiNER2 and GLiNER2.5 models, and fine-tunes of
    either, load through the same call.
    """
    auto = getattr(gliner2_module, "AutoExtractor", None)
    if auto is not None:
        return auto.from_pretrained(model_name)
    return gliner2_module.GLiNER2.from_pretrained(model_name)


def _rule_matches(pattern: str, value: str) -> bool:
    """Same matching as _resolve_pipeline_severity: regex search, substring if invalid."""
    try:
        return re.search(pattern, value, re.IGNORECASE) is not None
    except re.error:
        return pattern.lower() in value.lower()


def _collapse_repeated_values(
    entities: dict[str, list[dict[str, object]]],
) -> dict[str, list[dict[str, object]]]:
    """One span per distinct value and label, at its most confident mention.

    A contract names its parties dozens of times. Findings are keyed by value
    downstream anyway, but the detector's max_findings cap is applied before
    that, so 500 mentions of one party would crowd every other label (and the
    classification) out of the cap. The kept span records how many mentions it
    stands for.
    """
    collapsed: dict[str, list[dict[str, object]]] = {}
    for label, spans in entities.items():
        by_value: dict[str, dict[str, object]] = {}
        counts: dict[str, int] = {}
        for span in spans:
            key = " ".join(str(span.get("value", "")).split()).casefold()
            if not key:
                continue
            counts[key] = counts.get(key, 0) + 1
            kept = by_value.get(key)
            if kept is None or float(span.get("confidence", 0.0)) > float(  # type: ignore[arg-type]
                kept.get("confidence", 0.0)  # type: ignore[arg-type]
            ):
                by_value[key] = dict(span)
        if by_value:
            kept_spans = []
            for key, span in by_value.items():
                if counts[key] > 1:
                    span["occurrences"] = counts[key]
                kept_spans.append(span)
            collapsed[label] = sorted(
                kept_spans,
                key=lambda item: -float(item.get("confidence", 0.0)),  # type: ignore[arg-type]
            )
    return collapsed


def _label_confidences(raw: Any) -> list[tuple[str, float]]:
    """Every (label, confidence) pair in one classification output, in any shape."""
    if isinstance(raw, dict):
        if isinstance(raw.get("labels"), list):
            return _label_confidences(raw["labels"])
        label = raw.get("label")
        return [(str(label), _confidence_of(raw))] if label else []
    if isinstance(raw, (list, tuple)):
        pairs: list[tuple[str, float]] = []
        for item in raw:
            if isinstance(item, dict) and item.get("label"):
                pairs.append((str(item["label"]), _confidence_of(item)))
            elif isinstance(item, str) and item:
                pairs.append((item, 1.0))
        return pairs
    if isinstance(raw, str) and raw:
        return [(raw, 1.0)]
    return []


def _classification_outcome(per_label: dict[str, float], *, multi_label: bool) -> dict[str, object]:
    """Shape merged per-label confidences as a task outcome.

    ``label``/``confidence`` always name the strongest label. A multi-label task
    also carries ``labels``: every label, strongest first, for the validation
    threshold to filter.
    """
    if not per_label:
        return {}
    ranked = sorted(per_label.items(), key=lambda item: -item[1])
    best_label, best_confidence = ranked[0]
    outcome: dict[str, object] = {"label": best_label, "confidence": round(best_confidence, 4)}
    if multi_label:
        outcome["labels"] = [
            {"label": label, "confidence": round(confidence, 4)} for label, confidence in ranked
        ]
    return outcome


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


def _confidence_of(item: Any) -> float:
    """Read a confidence from either key the runtime may use.

    gliner2's formatter emits {"label", "confidence"} for multi-label results.
    Reading only "score" silently yields 0.0 for every label, which the
    validation threshold then filters away — classification would appear to run
    cleanly and produce nothing.
    """
    if not isinstance(item, dict):
        return 0.0
    value = item.get("confidence", item.get("score", 0.0))
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _normalise_classification_output(raw: Any) -> dict[str, object]:
    if isinstance(raw, dict):
        label = raw.get("label", "")
        confidence = _confidence_of(raw)
    elif isinstance(raw, (list, tuple)) and raw:
        best = max(raw, key=_confidence_of)
        label = best.get("label", "") if isinstance(best, dict) else str(best)
        confidence = _confidence_of(best) if isinstance(best, dict) else 1.0
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
            if rule.field != label:
                continue
            if rule.type == "regex" and rule.pattern:
                try:
                    rx = re.compile(rule.pattern)
                    passing = [s for s in passing if rx.search(str(s.get("value", "")))]
                except re.error as exc:
                    logger.warning("Invalid validation regex for field '%s': %s", label, exc)
            elif rule.type == "min_confidence" and rule.threshold is not None:
                floor = float(rule.threshold)
                passing = [
                    s
                    for s in passing
                    if float(s.get("confidence", 0.0)) >= floor  # type: ignore[arg-type]
                ]
        if passing:
            result[label] = passing

    # A label is required either on its definition or by a "required" rule;
    # the editor writes the rule. Either way a text without it reports nothing.
    required = {
        label
        for label, defn in (schema.entities or {}).items()
        if isinstance(defn, PipelineEntityDefinition) and defn.required
    } | {rule.field for rule in validation.rules or [] if rule.type == "required" and rule.field}
    for label in sorted(required):
        if label not in result:
            logger.debug("Required entity '%s' not found — suppressing all findings", label)
            return {}

    return result


def _apply_classification_validation(
    classification: dict[str, dict[str, object]],
    validation: PipelineValidationConfig,
) -> dict[str, dict[str, object]]:
    threshold = validation.confidence_threshold or 0.7
    result: dict[str, dict[str, object]] = {}
    for task, outcome in classification.items():
        labels = outcome.get("labels")
        if isinstance(labels, list):
            passing = [
                item
                for item in labels
                if isinstance(item, dict) and _confidence_of(item) >= threshold
            ]
            if passing:
                result[task] = {**outcome, "labels": passing}
            continue
        confidence = outcome.get("confidence", 0.0)
        if isinstance(confidence, (int, float)) and float(confidence) >= threshold:
            result[task] = outcome
    return result
