"""GLiNER2 pipeline fine-tuning trainer.

Handles two training modes in a single pass:
  - NER fine-tuning of the configured GLiNER2 / GLiNER2.5 checkpoint with the
    gliner2 library's own trainer (entity examples with span values)
  - Zero-shot classification fine-tuning via SetFit (text + label pairs)

Artifacts are written to an output directory structured as:
  <output_dir>/
    gliner2/       -- fine-tuned GLiNER2 model weights (HuggingFace format)
    setfit/<task>/ -- one SetFit model per classification task
    manifest.json  -- training metadata for the runner

The trainer produces a JSON result dict to stdout, which the API reads to update
the training run record.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Minimum examples needed before we attempt fine-tuning (not just annotation storage)
_MIN_NER_EXAMPLES = 5
_MIN_SETFIT_PER_CLASS = 2


@dataclass
class TrainingExample:
    label: str
    text: str
    value: str | None = None  # specific entity span text (NER only)
    accepted: bool = True
    source: str | None = None


@dataclass
class TrainingResult:
    status: str
    trained_examples: int
    positive_examples: int
    negative_examples: int
    model_artifact_path: str
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "trained_examples": self.trained_examples,
            "positive_examples": self.positive_examples,
            "negative_examples": self.negative_examples,
            "model_artifact_path": self.model_artifact_path,
            "metrics": self.metrics,
        }


class GLiNER2Trainer:
    """Orchestrates NER + classification fine-tuning for a GLiNER2 pipeline."""

    def __init__(
        self,
        pipeline_schema: dict[str, Any],
        examples_raw: list[dict[str, Any]],
        output_dir: Path,
    ) -> None:
        self._schema = pipeline_schema
        self._output_dir = output_dir
        self._examples: list[TrainingExample] = [
            TrainingExample(
                label=str(ex.get("label", "")),
                text=str(ex.get("text", "")),
                value=ex.get("value") or None,
                accepted=bool(ex.get("accepted", True)),
                source=ex.get("source") or None,
            )
            for ex in examples_raw
            if ex.get("label") and ex.get("text")
        ]

    def train(self) -> TrainingResult:
        t0 = time.monotonic()
        self._output_dir.mkdir(parents=True, exist_ok=True)

        positive = [e for e in self._examples if e.accepted]
        negative = [e for e in self._examples if not e.accepted]
        metrics: dict[str, Any] = {}

        entities: dict[str, Any] = self._schema.get("entities") or {}
        classification: dict[str, Any] = self._schema.get("classification") or {}
        base_model: str = (self._schema.get("model") or {}).get(
            "name"
        ) or "fastino/gliner2.5-base-v1"

        # ── NER fine-tuning ────────────────────────────────────────────────────
        entity_labels = set(entities.keys())
        ner_examples = [e for e in positive if e.label in entity_labels and e.value]
        if ner_examples:
            metrics["ner"] = self._train_ner(ner_examples, base_model)
        else:
            metrics["ner"] = {"skipped": True, "reason": "No span-annotated NER examples"}

        # ── Classification fine-tuning (SetFit) ────────────────────────────────
        if classification:
            metrics["classification"] = self._train_classification(positive, classification)
        else:
            metrics["classification"] = {
                "skipped": True,
                "reason": "No classification tasks defined",
            }

        # Write manifest so the runner knows what's available
        manifest: dict[str, Any] = {
            "schema_type": self._schema.get("type", "GLINER2"),
            "base_model": base_model,
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "metrics": metrics,
        }
        (self._output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

        metrics["duration_s"] = round(time.monotonic() - t0, 2)

        return TrainingResult(
            status="SUCCEEDED",
            trained_examples=len(positive),
            positive_examples=len(positive),
            negative_examples=len(negative),
            model_artifact_path=str(self._output_dir),
            metrics=metrics,
        )

    # ── NER ────────────────────────────────────────────────────────────────────

    def _train_ner(self, examples: list[TrainingExample], base_model: str) -> dict[str, Any]:
        if len(examples) < _MIN_NER_EXAMPLES:
            return {
                "skipped": True,
                "reason": f"Need ≥{_MIN_NER_EXAMPLES} span-annotated examples (got {len(examples)})",
            }

        # Build GLiNER-format span annotations
        train_data: list[dict[str, Any]] = []
        for ex in examples:
            if not ex.value:
                continue
            start = ex.text.find(ex.value)
            if start < 0:
                continue
            train_data.append(
                {
                    "text": ex.text,
                    "ner": [{"start": start, "end": start + len(ex.value), "label": ex.label}],
                }
            )

        if len(train_data) < _MIN_NER_EXAMPLES:
            return {
                "skipped": True,
                "reason": f"Too few locatable spans after search (got {len(train_data)})",
            }

        gliner_out = self._output_dir / "gliner2"
        gliner_out.mkdir(parents=True, exist_ok=True)

        try:
            from gliner2 import AutoExtractor
            from gliner2.training.data import InputExample
            from gliner2.training.trainer import ExtractorTrainer, TrainingConfig
        except ImportError as e:
            return {"skipped": True, "reason": f"gliner2 training is not installed: {e}"}

        # One example per text, with every annotated mention of every label in it.
        # Described labels the text does not mention are trained as negatives,
        # which is what keeps a fine-tune from over-predicting a label.
        descriptions = self._entity_descriptions()
        by_text: dict[str, dict[str, list[str]]] = {}
        for item in train_data:
            mentions = by_text.setdefault(item["text"], {})
            for span in item["ner"]:
                value = item["text"][span["start"] : span["end"]]
                mentions.setdefault(span["label"], [])
                if value not in mentions[span["label"]]:
                    mentions[span["label"]].append(value)
        input_examples = [
            InputExample(
                text=text,
                entities=mentions,
                entity_descriptions=descriptions or None,
            )
            for text, mentions in by_text.items()
        ]

        epochs = 3
        try:
            model = AutoExtractor.from_pretrained(base_model)
            checkpoint_dir = self._output_dir / "checkpoints"
            config = TrainingConfig(
                output_dir=str(checkpoint_dir),
                num_epochs=epochs,
                batch_size=min(4, len(input_examples)),
                eval_strategy="no",
                save_best=False,
                num_workers=0,
                pin_memory=False,
                logging_steps=10,
            )
            ExtractorTrainer(model=model, config=config).train(train_data=input_examples)
            model.save_pretrained(str(gliner_out))
            # The library also keeps its own full checkpoint (hundreds of MB);
            # the runner loads only gliner2/, so the copy is dropped.
            shutil.rmtree(checkpoint_dir, ignore_errors=True)
            logger.info("NER model saved to %s", gliner_out)
            return {
                "examples": len(input_examples),
                "spans": len(train_data),
                "epochs": epochs,
                "saved_to": "gliner2/",
            }
        except Exception as e:
            logger.warning("NER fine-tuning failed: %s", e, exc_info=True)
            return {"skipped": True, "reason": str(e)}

    def _entity_descriptions(self) -> dict[str, str]:
        descriptions: dict[str, str] = {}
        for label, defn in (self._schema.get("entities") or {}).items():
            text = defn.get("description") if isinstance(defn, dict) else defn
            if isinstance(text, str) and text.strip():
                descriptions[label] = text.strip()
        return descriptions

    # ── Classification (SetFit) ────────────────────────────────────────────────

    def _train_classification(
        self,
        positive: list[TrainingExample],
        classification: dict[str, Any],
    ) -> dict[str, Any]:
        task_results: dict[str, Any] = {}
        for task_name, task_defn in classification.items():
            labels: list[str] = task_defn.get("labels") or []
            task_examples = [e for e in positive if e.label in labels]
            if len(task_examples) < _MIN_SETFIT_PER_CLASS * max(len(labels), 1):
                task_results[task_name] = {
                    "skipped": True,
                    "reason": (
                        f"Need ≥{_MIN_SETFIT_PER_CLASS} examples per label "
                        f"(got {len(task_examples)} across {len(labels)} labels)"
                    ),
                }
                continue
            try:
                task_results[task_name] = self._train_setfit_task(task_name, task_examples, labels)
            except Exception as e:
                logger.warning("SetFit training failed for task '%s': %s", task_name, e)
                task_results[task_name] = {"skipped": True, "reason": str(e)}
        return task_results

    def _train_setfit_task(
        self,
        task_name: str,
        examples: list[TrainingExample],
        labels: list[str],
    ) -> dict[str, Any]:
        try:
            from datasets import Dataset  # type: ignore[import-untyped]
            from setfit import (  # type: ignore[import-untyped]
                SetFitModel,
                Trainer,
                TrainingArguments,
            )
        except ImportError as e:
            return {"skipped": True, "reason": f"setfit/datasets not installed: {e}"}

        label2id = {label: i for i, label in enumerate(labels)}
        dataset = Dataset.from_dict(
            {
                "text": [ex.text for ex in examples],
                "label": [label2id.get(ex.label, 0) for ex in examples],
            }
        )

        model = SetFitModel.from_pretrained(
            "sentence-transformers/paraphrase-MiniLM-L6-v2",
            labels=labels,
        )

        save_path = self._output_dir / "setfit" / task_name
        save_path.mkdir(parents=True, exist_ok=True)

        args = TrainingArguments(
            output_dir=str(save_path),
            num_epochs=1,
            batch_size=min(8, len(examples)),
        )
        trainer = Trainer(model=model, args=args, train_dataset=dataset)
        trainer.train()
        model.save_pretrained(str(save_path))

        # Persist label ordering so the runner can decode predictions
        (save_path / "labels.json").write_text(json.dumps(labels))

        logger.info("SetFit model for task '%s' saved to %s", task_name, save_path)
        return {
            "examples": len(examples),
            "labels": labels,
            "saved_to": f"setfit/{task_name}/",
        }
