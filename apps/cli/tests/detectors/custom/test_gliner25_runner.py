"""GLiNER2.5 support and the productised GLiNER2 runner.

Each test pins one behaviour that was broken or missing before:

* GLiNER2.5 checkpoints did not load: ``GLiNER2.from_pretrained`` is span-only
  and fails on a boundary checkpoint's config.
* The model was asked for every span at threshold 0 and filtered afterwards.
* ``multi_label`` was in the schema but never reached the model, and only one
  label per task could ever become a finding.
* Classification label descriptions could not be given at all.
* A long document's repeated mentions filled ``max_findings`` before the
  classification and the other labels were reached.
* Severity followed the model's confidence, so a contract date came out "high".
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from src.detectors.custom.detector import CustomDetector
from src.detectors.custom.runners._gliner2 import (
    GLiNER2Runner,
    _collapse_repeated_values,
    _from_pretrained,
)
from src.models.generated_detectors import (
    CustomDetectorConfig,
    GLiNER2PipelineSchema,
    PipelineClassificationDefinition,
    PipelineEntityDefinition,
    PipelineSeverityRule,
    PipelineValidationConfig,
    Severity,
)

from .conftest import requires_gliner2


class _RecordingModel:
    """Answers like gliner2's runtime and records every call."""

    def __init__(
        self,
        entities: dict[str, list[dict[str, Any]]] | None = None,
        classes: dict[str, Any] | None = None,
    ) -> None:
        self.entities = entities or {}
        self.classes = classes or {}
        self.entity_calls: list[dict[str, Any]] = []
        self.class_calls: list[dict[str, Any]] = []

    def extract_entities(self, text: str, entity_types: Any, **kwargs: Any) -> dict:
        self.entity_calls.append({"types": entity_types, **kwargs})
        return {"entities": self.entities}

    def classify_text(self, text: str, tasks: dict, **kwargs: Any) -> dict:
        self.class_calls.append({"tasks": tasks, **kwargs})
        task = next(iter(tasks))
        return {task: self.classes.get(task, {})}


def _runner(schema: GLiNER2PipelineSchema, model: Any) -> GLiNER2Runner:
    runner = GLiNER2Runner(schema, detector_key="contracts")
    runner._model = model
    runner._setfit_models = {}
    return runner


# ── loading ──────────────────────────────────────────────────────────────


class TestLoading:
    def test_loads_through_auto_extractor(self):
        module = MagicMock()
        _from_pretrained(module, "fastino/gliner2.5-base-v1")

        module.AutoExtractor.from_pretrained.assert_called_once_with("fastino/gliner2.5-base-v1")
        module.GLiNER2.from_pretrained.assert_not_called()

    def test_falls_back_to_gliner2_on_a_runtime_without_auto_extractor(self):
        loaded = object()
        module = SimpleNamespace(
            GLiNER2=SimpleNamespace(from_pretrained=lambda _name: loaded),
        )

        assert _from_pretrained(module, "fastino/gliner2-base-v1") is loaded

    def test_default_model_is_the_gliner25_base_checkpoint(self):
        from src.detectors.custom.runners._base import _DEFAULT_GLINER2_MODEL

        assert _DEFAULT_GLINER2_MODEL == "fastino/gliner2.5-base-v1"


# ── entities ─────────────────────────────────────────────────────────────


class TestEntityRequests:
    def test_asks_the_model_at_the_validation_threshold(self):
        model = _RecordingModel()
        schema = GLiNER2PipelineSchema(
            entities={"party": PipelineEntityDefinition(description="A signatory")},
            validation=PipelineValidationConfig(confidence_threshold=0.55),
        )

        _runner(schema, model).run("Short text.")

        assert model.entity_calls[0]["threshold"] == pytest.approx(0.55)

    def test_descriptions_are_sent_and_blank_ones_left_out(self):
        model = _RecordingModel()
        schema = GLiNER2PipelineSchema(
            entities={
                "party": PipelineEntityDefinition(description="Company that signs"),
                "governing_law": PipelineEntityDefinition(description="   "),
            }
        )

        _runner(schema, model).run("Short text.")

        assert model.entity_calls[0]["types"] == {
            "party": {"description": "Company that signs"},
            "governing_law": {},
        }


class TestRepeatedMentions:
    def test_each_value_is_kept_once_at_its_best_mention(self):
        spans = {
            "party": [
                {"value": "Acme Corp", "confidence": 0.8, "start": 10, "end": 19},
                {"value": "ACME  corp", "confidence": 0.95, "start": 200, "end": 210},
                {"value": "Beacon LLC", "confidence": 0.9, "start": 40, "end": 50},
            ]
        }

        collapsed = _collapse_repeated_values(spans)["party"]

        assert [span["value"] for span in collapsed] == ["ACME  corp", "Beacon LLC"]
        assert collapsed[0]["start"] == 200
        assert collapsed[0]["occurrences"] == 2
        assert "occurrences" not in collapsed[1]

    def test_occurrences_reach_the_finding(self):
        model = _RecordingModel(
            entities={
                "party": [
                    {"text": "Acme Corp", "confidence": 0.9, "start": 0, "end": 9},
                    {"text": "Acme Corp", "confidence": 0.92, "start": 30, "end": 39},
                ]
            }
        )
        schema = GLiNER2PipelineSchema(
            entities={"party": PipelineEntityDefinition(description="A signatory")}
        )

        findings = _runner(schema, model).detect(
            "Acme Corp agrees ... Acme Corp shall", "text/plain"
        )

        assert len(findings) == 1
        assert findings[0].metadata["occurrences"] == 2
        assert findings[0].location.start == 30

    def test_a_chatty_label_cannot_crowd_out_the_classification(self):
        # 300 distinct values for one label, a cap of 100, and a classification:
        # the document-level answer must survive the cap.
        many = [
            {"text": f"Party {i}", "confidence": 0.9, "start": i * 10, "end": i * 10 + 7}
            for i in range(300)
        ]
        model = _RecordingModel(
            entities={"party": many},
            classes={"agreement_type": {"label": "license", "confidence": 0.93}},
        )
        config = CustomDetectorConfig(
            custom_detector_key="contracts",
            name="Contracts",
            max_findings=100,
            pipeline_schema=GLiNER2PipelineSchema(
                entities={"party": PipelineEntityDefinition(description="A signatory")},
                classification={
                    "agreement_type": PipelineClassificationDefinition(labels=["license", "supply"])
                },
            ),
        )
        detector = CustomDetector(config)
        detector.runner._model = model  # type: ignore[attr-defined]
        detector.runner._setfit_models = {}  # type: ignore[attr-defined]

        findings = detector._detect_sync("x" * 50, "text/plain")

        assert len(findings) == 100
        assert findings[0].finding_type == "classification:agreement_type:license"


# ── classification ───────────────────────────────────────────────────────


class TestClassificationRequests:
    def test_multi_label_and_descriptions_reach_the_model(self):
        model = _RecordingModel(classes={"clauses": [{"label": "exclusivity", "confidence": 0.9}]})
        schema = GLiNER2PipelineSchema(
            classification={
                "clauses": PipelineClassificationDefinition(
                    labels=["exclusivity", "non_compete", "auto_renewal"],
                    descriptions={"exclusivity": "Only one party may sell the product"},
                    multi_label=True,
                )
            }
        )

        _runner(schema, model).run("Short text.")

        assert model.class_calls[0]["tasks"] == {
            "clauses": {
                "labels": {
                    "exclusivity": "Only one party may sell the product",
                    "non_compete": "",
                    "auto_renewal": "",
                },
                "multi_label": True,
                "cls_threshold": 0.0,
            }
        }

    def test_labels_without_descriptions_are_sent_as_a_plain_list(self):
        model = _RecordingModel(classes={"kind": {"label": "a", "confidence": 0.9}})
        schema = GLiNER2PipelineSchema(
            classification={"kind": PipelineClassificationDefinition(labels=["a", "b"])}
        )

        _runner(schema, model).run("Short text.")

        assert model.class_calls[0]["tasks"]["kind"]["labels"] == ["a", "b"]
        assert model.class_calls[0]["tasks"]["kind"]["multi_label"] is False


class TestMultiLabelFindings:
    def _schema(self) -> GLiNER2PipelineSchema:
        return GLiNER2PipelineSchema(
            classification={
                "clauses": PipelineClassificationDefinition(
                    labels=["exclusivity", "non_compete", "auto_renewal"], multi_label=True
                )
            },
            validation=PipelineValidationConfig(confidence_threshold=0.6),
        )

    def test_every_label_over_the_threshold_becomes_a_finding(self):
        model = _RecordingModel(
            classes={
                "clauses": [
                    {"label": "exclusivity", "confidence": 0.91},
                    {"label": "auto_renewal", "confidence": 0.74},
                    {"label": "non_compete", "confidence": 0.12},
                ]
            }
        )

        findings = _runner(self._schema(), model).detect("Some contract.", "text/plain")

        assert sorted(f.finding_type for f in findings) == [
            "classification:clauses:auto_renewal",
            "classification:clauses:exclusivity",
        ]

    def test_long_documents_keep_each_label_at_its_strongest_chunk(self):
        model = MagicMock(spec=["extract_entities", "classify_text"])
        model.classify_text.side_effect = [
            {"clauses": [{"label": "exclusivity", "confidence": 0.82}]},
            {"clauses": [{"label": "auto_renewal", "confidence": 0.88}]},
            {"clauses": [{"label": "exclusivity", "confidence": 0.65}]},
        ] * 10

        result = _runner(self._schema(), model).run("word " * 2000)

        labels = {
            item["label"]: item["confidence"] for item in result.classification["clauses"]["labels"]
        }
        assert labels == {"auto_renewal": pytest.approx(0.88), "exclusivity": pytest.approx(0.82)}


# ── severity ─────────────────────────────────────────────────────────────


class TestSeverity:
    def _model(self) -> _RecordingModel:
        return _RecordingModel(
            entities={
                "party": [{"text": "Acme Corp", "confidence": 0.99, "start": 0, "end": 9}],
                "notice_period": [
                    {"text": "ninety (90) days", "confidence": 0.95, "start": 20, "end": 36}
                ],
            },
            classes={"risk": {"label": "unlimited_liability", "confidence": 0.97}},
        )

    def _schema(self, rules: list[PipelineSeverityRule] | None) -> GLiNER2PipelineSchema:
        return GLiNER2PipelineSchema(
            entities={
                "party": PipelineEntityDefinition(description="A signatory"),
                "notice_period": PipelineEntityDefinition(description="Notice to terminate"),
            },
            classification={
                "risk": PipelineClassificationDefinition(labels=["unlimited_liability", "capped"])
            },
            severity_map=rules,
        )

    def test_unmapped_findings_are_info_whatever_the_confidence(self):
        findings = _runner(self._schema(None), self._model()).detect(
            "Acme Corp gives ninety (90) days notice.", "text/plain"
        )

        assert {f.severity for f in findings} == {Severity.info}

    def test_rules_set_severity_for_entities_and_classification_labels(self):
        rules = [
            PipelineSeverityRule(pattern="notice", severity=Severity.medium),
            PipelineSeverityRule(pattern="unlimited", severity=Severity.high),
        ]
        findings = _runner(self._schema(rules), self._model()).detect(
            "Acme Corp gives ninety (90) days notice.", "text/plain"
        )

        by_type = {f.finding_type: f.severity for f in findings}
        assert by_type == {
            "classification:risk:unlimited_liability": Severity.high,
            "entity:party": Severity.info,
            "entity:notice_period": Severity.medium,
        }


# ── real model smoke ─────────────────────────────────────────────────────


def _cached(model_id: str) -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:  # pragma: no cover - hub ships with transformers
        return False
    return isinstance(try_to_load_from_cache(model_id, "config.json"), str)


_SMOKE_MODEL = "fastino/gliner2.5-base-v1"


@requires_gliner2
@pytest.mark.skipif(
    not _cached(_SMOKE_MODEL),
    reason=f"{_SMOKE_MODEL} is not in the local Hugging Face cache (no download in tests)",
)
def test_real_gliner25_checkpoint_extracts_and_classifies():
    schema = GLiNER2PipelineSchema(
        model={"name": _SMOKE_MODEL},
        entities={
            "party": PipelineEntityDefinition(description="Company that signs the agreement"),
            "governing_law": PipelineEntityDefinition(
                description="The state or country whose laws govern the agreement"
            ),
        },
        classification={
            "agreement_type": PipelineClassificationDefinition(
                labels=["license", "supply"],
                descriptions={
                    "license": "grants rights to use a trademark, patent or software",
                    "supply": "supply or manufacturing of goods",
                },
            )
        },
        validation=PipelineValidationConfig(confidence_threshold=0.5),
    )
    runner = GLiNER2Runner(schema, detector_key="smoke")
    text = (
        "This Trademark License Agreement is entered into by Brightwater Mills, Inc. "
        "and Corvid Analytics LLC. Brightwater Mills grants Corvid Analytics a licence "
        "to use the BRIGHTWATER mark. This Agreement is governed by the laws of the "
        "State of Delaware."
    )

    result = runner.run(text)

    parties = {span["value"] for span in result.entities.get("party", [])}
    assert {"Brightwater Mills, Inc.", "Corvid Analytics LLC"} <= parties
    assert any("Delaware" in span["value"] for span in result.entities.get("governing_law", []))
    assert result.classification["agreement_type"]["label"] == "license"
    assert result.metadata["model"] == _SMOKE_MODEL


# ── fine-tuning ──────────────────────────────────────────────────────────


@requires_gliner2
def test_ner_fine_tuning_uses_the_gliner2_trainer(tmp_path, monkeypatch):
    # The trainer used to import the first-generation `gliner` package, which is
    # not a dependency, so every NER fine-tune reported "skipped".
    import gliner2
    import gliner2.training.trainer as gliner2_trainer

    from src.detectors.custom.trainer import GLiNER2Trainer

    trained: dict[str, Any] = {}

    class _Model:
        def save_pretrained(self, path: str) -> None:
            trained["saved_to"] = path

    class _Trainer:
        def __init__(self, model: Any, config: Any) -> None:
            trained["config"] = config

        def train(self, train_data: list[Any]) -> dict:
            trained["examples"] = train_data
            (tmp_path / "checkpoints").mkdir(exist_ok=True)
            return {}

    monkeypatch.setattr(
        gliner2, "AutoExtractor", SimpleNamespace(from_pretrained=lambda _name: _Model())
    )
    monkeypatch.setattr(gliner2_trainer, "ExtractorTrainer", _Trainer)

    schema = {
        "type": "GLINER2",
        "entities": {"party": {"description": "Company that signs"}, "governing_law": {}},
    }
    text = "Acme Corp and Beacon LLC agree. Governed by the laws of Delaware."
    examples = [
        {"label": "party", "text": text, "value": "Acme Corp"},
        {"label": "party", "text": text, "value": "Beacon LLC"},
        {"label": "governing_law", "text": text, "value": "Delaware"},
    ] + [
        {"label": "party", "text": f"Signed by Party {i} Inc.", "value": f"Party {i} Inc."}
        for i in range(4)
    ]

    result = GLiNER2Trainer(schema, examples, tmp_path).train()

    assert result.metrics["ner"]["examples"] == 5
    first = trained["examples"][0]
    assert first.entities == {"party": ["Acme Corp", "Beacon LLC"], "governing_law": ["Delaware"]}
    assert first.entity_descriptions == {"party": "Company that signs"}
    assert trained["saved_to"] == str(tmp_path / "gliner2")
    assert not (tmp_path / "checkpoints").exists()


# ── one pass for everything ──────────────────────────────────────────────


class _SchemaRecorder:
    def __init__(self) -> None:
        self.entities_arg: Any = None
        self.tasks: dict[str, dict[str, Any]] = {}

    def entities(self, spec: Any) -> _SchemaRecorder:
        self.entities_arg = spec
        return self

    def classification(self, task: str, labels: Any, **kwargs: Any) -> _SchemaRecorder:
        self.tasks[task] = {"labels": labels, **kwargs}
        return self


class _JointModel:
    """The gliner2 runtime's schema API: one extract call answers everything."""

    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.schema = _SchemaRecorder()
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def create_schema(self) -> _SchemaRecorder:
        return self.schema

    def extract(self, text: str, schema: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("extract", kwargs))
        return self.result

    def extract_long(self, text: str, schema: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("extract_long", kwargs))
        return self.result

    def extract_entities(self, *a: Any, **k: Any) -> dict:  # pragma: no cover - must not run
        raise AssertionError("separate entity call in joint mode")

    def classify_text(self, *a: Any, **k: Any) -> dict:  # pragma: no cover - must not run
        raise AssertionError("separate classification call in joint mode")


def _contract_schema() -> GLiNER2PipelineSchema:
    return GLiNER2PipelineSchema(
        entities={"party": PipelineEntityDefinition(description="A signatory")},
        classification={
            "agreement_type": PipelineClassificationDefinition(labels=["license", "supply"]),
            "clauses": PipelineClassificationDefinition(
                labels=["exclusivity", "auto_renewal"], multi_label=True
            ),
        },
        validation=PipelineValidationConfig(confidence_threshold=0.6),
    )


class TestJointPass:
    def test_entities_and_every_task_share_one_long_pass(self):
        model = _JointModel(
            {
                "entities": {
                    "party": [{"text": "Acme Corp", "confidence": 0.95, "start": 4, "end": 13}]
                },
                "agreement_type": {"label": "license", "confidence": 0.91},
                "clauses": [
                    {"label": "exclusivity", "confidence": 0.8},
                    {"label": "auto_renewal", "confidence": 0.3},
                ],
            }
        )
        text = "The Acme Corp agreement. " + "More words here. " * 400

        result = _runner(_contract_schema(), model).run(text)

        assert [name for name, _ in model.calls] == ["extract_long"]
        assert model.calls[0][1]["threshold"] == pytest.approx(0.6)
        assert model.schema.entities_arg == {"party": {"description": "A signatory"}}
        assert model.schema.tasks["clauses"]["multi_label"] is True
        assert model.schema.tasks["clauses"]["cls_threshold"] == 0.0
        assert result.entities["party"][0]["value"] == "Acme Corp"
        assert result.classification["agreement_type"]["label"] == "license"
        assert [i["label"] for i in result.classification["clauses"]["labels"]] == ["exclusivity"]

    def test_short_text_uses_the_plain_pass(self):
        model = _JointModel(
            {"entities": {}, "agreement_type": {"label": "supply", "confidence": 0.9}}
        )

        _runner(_contract_schema(), model).run("A short supply agreement.")

        assert [name for name, _ in model.calls] == ["extract"]

    def test_a_failing_joint_pass_falls_back_to_separate_calls(self):
        class _Broken(_RecordingModel):
            def create_schema(self) -> Any:
                raise RuntimeError("schema API broke")

            def extract(self, *a: Any, **k: Any) -> dict:  # pragma: no cover
                return {}

        model = _Broken(
            entities={"party": [{"text": "Acme Corp", "confidence": 0.9, "start": 0, "end": 9}]},
            classes={"agreement_type": {"label": "license", "confidence": 0.9}},
        )

        result = _runner(_contract_schema(), model).run("Acme Corp licenses its mark.")

        assert result.entities["party"][0]["value"] == "Acme Corp"
        assert model.entity_calls and model.class_calls


class TestReadFromStart:
    def test_a_start_task_judges_only_the_opening(self):
        # On 23 real contracts the opening named the agreement type right 15
        # times; the strongest label over every piece, 7 times.
        model = _JointModel(
            {"entities": {}, "clauses": [{"label": "exclusivity", "confidence": 0.9}]}
        )
        seen: list[str] = []

        def classify_text(text: str, _tasks: dict, **_kwargs: Any) -> dict:
            seen.append(text)
            return {"agreement_type": {"label": "license", "confidence": 0.95}}

        model.classify_text = classify_text  # type: ignore[method-assign]
        schema = _contract_schema()
        schema.classification["agreement_type"].read_from = "start"  # type: ignore[index,assignment]
        opening = "TRADEMARK LICENSE AGREEMENT between Acme Corp and Beacon LLC. "
        text = opening + "Section text. " * 2000

        result = _runner(schema, model).run(text)

        assert seen and all(len(t) <= 2400 for t in seen)
        assert seen[0].startswith("TRADEMARK LICENSE AGREEMENT")
        assert "agreement_type" not in model.schema.tasks  # not in the whole-text pass
        assert "clauses" in model.schema.tasks
        assert result.classification["agreement_type"]["label"] == "license"
        assert result.classification["clauses"]["labels"][0]["label"] == "exclusivity"


class TestValidationRules:
    """The editor offers regex, min-confidence and required rules; only regex
    used to be applied, the other two did nothing."""

    def _model(self) -> _RecordingModel:
        return _RecordingModel(
            entities={
                "party": [
                    {"text": "Acme Corp", "confidence": 0.97, "start": 0, "end": 9},
                    {"text": "supplier", "confidence": 0.66, "start": 20, "end": 28},
                ]
            }
        )

    def test_min_confidence_rule_raises_the_floor_for_one_label(self):
        schema = GLiNER2PipelineSchema(
            entities={"party": PipelineEntityDefinition(description="A signatory")},
            validation=PipelineValidationConfig(
                confidence_threshold=0.6,
                rules=[{"field": "party", "type": "min_confidence", "threshold": 0.8}],
            ),
        )

        result = _runner(schema, self._model()).run("Acme Corp and its supplier.")

        assert [s["value"] for s in result.entities["party"]] == ["Acme Corp"]

    def test_required_rule_suppresses_a_text_without_the_label(self):
        schema = GLiNER2PipelineSchema(
            entities={
                "party": PipelineEntityDefinition(description="A signatory"),
                "order_id": PipelineEntityDefinition(description="Order number"),
            },
            validation=PipelineValidationConfig(
                confidence_threshold=0.6, rules=[{"field": "order_id", "type": "required"}]
            ),
        )

        result = _runner(schema, self._model()).run("Acme Corp and its supplier.")

        assert not result.entities
