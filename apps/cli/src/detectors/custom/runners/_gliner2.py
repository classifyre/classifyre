"""GLiNER2 pipeline runner."""

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
)
from ...dependencies import MissingDependencyError, require_module
from ._base import _DEFAULT_GLINER2_MODEL, BaseRunner
from ._text_classification import _chunk_text

logger = logging.getLogger(__name__)

# GLiNER2's encoder window is a few hundred tokens; anything past it is silently
# dropped by a plain extract_entities call. Above this char threshold we use the
# library's extract_entities_long (chunked) API when available, and run
# classification per-chunk with max-confidence aggregation.
_LONG_TEXT_CHAR_THRESHOLD = 3000
_CLS_CHUNK_SIZE = 3000
_CLS_CHUNK_OVERLAP = 200
# Bound per-asset CPU cost on pathological inputs.
_MAX_CLS_CHUNKS = 50


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

        raw_entities: dict[str, list[dict[str, object]]] = {}
        raw_classification: dict[str, dict[str, object]] = {}

        # Entity extraction and each classification task are isolated. They used
        # to share one try/except, so a classification failure discarded the
        # entities already extracted in the same run and returned an empty
        # result — the whole detector went silent because of one broken task.
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

        for task_name, labels in classification_tasks.items():
            try:
                setfit = self._get_setfit_model(task_name)
                if setfit is not None:
                    raw_cls: Any = self._run_setfit(setfit, task_name, text)
                else:
                    raw_cls = self._classify_chunked(model, text, task_name, labels)
                raw_classification[task_name] = _normalise_classification_output(raw_cls)
            except Exception as exc:  # pragma: no cover - runtime specific
                logger.error(
                    "GLiNER2 classification task '%s' failed for detector '%s': %s",
                    task_name,
                    self._detector_key,
                    exc,
                )

        # No early return for an empty result: "ran and found nothing" is a
        # legitimate outcome and must still produce a well-formed result with
        # metadata. Failures are reported by the logs above and by the runner's
        # detector outcome, not by an anonymous empty return.
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

    def _extract_entities(self, model: Any, text: str, entity_schema: dict[str, str]) -> Any:
        """Extract entities, using the library's chunked long-document API for large texts."""
        kwargs: dict[str, Any] = {
            "threshold": 0.0,
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

    def _classify_once(self, model: Any, text: str, task_name: str, labels: list[str]) -> Any:
        """Run one classification task against whichever API the runtime exposes.

        gliner2>=1.3 exposes `classify_text(text, tasks: dict, ...)`, where tasks
        maps a task name to its labels and the result is keyed by that name.
        Mirrors the defensive probing in _extract_entities rather than assuming
        a method exists.
        """
        classify_text = getattr(model, "classify_text", None)
        if classify_text is not None:
            raw = classify_text(
                text,
                {task_name: list(labels)},
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

    def _classify_chunked(
        self, model: Any, text: str, task_name: str, labels: list[str]
    ) -> dict[str, object]:
        """Classify text, chunking long inputs and keeping the max-confidence label."""
        chunks = _chunk_text(text, _CLS_CHUNK_SIZE, _CLS_CHUNK_OVERLAP)[:_MAX_CLS_CHUNKS]

        best: dict[str, object] = {}
        for chunk in chunks:
            outcome = _normalise_classification_output(
                self._classify_once(model, chunk, task_name, labels)
            )
            if outcome and float(outcome.get("confidence", 0.0)) > float(
                best.get("confidence", -1.0)
            ):
                best = outcome
        return best

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

    def _build_entity_schema(self) -> dict[str, str]:
        entities = self._schema.entities or {}
        return {
            label: defn.description if isinstance(defn, PipelineEntityDefinition) else str(defn)
            for label, defn in entities.items()
        }

    def _build_classification_tasks(self) -> dict[str, list[str]]:
        return {task: defn.labels for task, defn in (self._schema.classification or {}).items()}


# ── Normalisation helpers (used only by GLiNER2Runner) ────────────────────────


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
