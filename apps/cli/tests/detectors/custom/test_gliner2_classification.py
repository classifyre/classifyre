"""GLiNER2 classification API + task isolation (G-008).

Two failures compounded here:

1. The runner called `model.classify(...)`, which gliner2>=1.3 does not have —
   it exposes `classify_text(text, tasks: dict, ...)`. Every classification
   raised AttributeError.
2. Entity extraction and classification shared one try/except, so that
   AttributeError discarded the entities extracted moments earlier and the
   detector returned an empty result.

Net effect: a pipeline with both entities and a classification task produced
nothing at all, and the entity half looked broken when it was not.
"""

from __future__ import annotations

from typing import Any

from src.detectors.custom.runners._gliner2 import (
    GLiNER2Runner,
    _confidence_of,
    _normalise_classification_output,
)
from src.models.generated_detectors import (
    GLiNER2PipelineSchema,
    PipelineClassificationDefinition,
    PipelineEntityDefinition,
    PipelineValidationConfig,
)


class _FakeModelNewApi:
    """gliner2 >= 1.3: classify_text(text, tasks) -> {task: {...}}."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def classify_text(self, text: str, tasks: dict, **kwargs: Any) -> dict:
        self.calls.append((text, tasks))
        task_name = next(iter(tasks))
        return {task_name: {"label": "contract", "confidence": 0.91}}


class _FakeModelLegacyApi:
    """An older surface exposing classify(text, labels)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, list]] = []

    def classify(self, text: str, labels: list[str], **kwargs: Any) -> dict:
        self.calls.append((text, labels))
        return {"label": "invoice", "confidence": 0.77}


class _FakeModelNoClassifyApi:
    """Neither method — the runner must say so rather than AttributeError."""


def _runner() -> Any:
    from src.detectors.custom.runners._gliner2 import GLiNER2Runner

    runner = GLiNER2Runner.__new__(GLiNER2Runner)
    runner._detector_key = "test_detector"
    return runner


class TestClassifyOnce:
    def test_uses_classify_text_and_unwraps_task_result(self):
        runner, model = _runner(), _FakeModelNewApi()

        result = runner._classify_once(model, "some text", "doc_type", ["contract", "invoice"])

        # Unwrapped from {task_name: result}, not returned as the outer dict.
        assert result == {"label": "contract", "confidence": 0.91}

    def test_passes_labels_as_a_tasks_dict(self):
        # classify_text takes tasks: Dict[name, labels] — not a bare label list.
        runner, model = _runner(), _FakeModelNewApi()

        runner._classify_once(model, "some text", "doc_type", ["contract", "invoice"])

        _text, tasks = model.calls[0]
        assert tasks == {"doc_type": ["contract", "invoice"]}

    def test_falls_back_to_legacy_classify(self):
        runner, model = _runner(), _FakeModelLegacyApi()

        result = runner._classify_once(model, "some text", "doc_type", ["invoice"])

        assert result == {"label": "invoice", "confidence": 0.77}
        assert model.calls[0][1] == ["invoice"]

    def test_missing_both_apis_raises_a_named_error(self):
        runner = _runner()

        try:
            runner._classify_once(_FakeModelNoClassifyApi(), "text", "doc_type", ["a"])
        except AttributeError as exc:
            assert "classify_text" in str(exc)
            assert "doc_type" in str(exc)
        else:
            raise AssertionError("expected AttributeError naming the missing API")


class TestConfidenceNormalisation:
    """gliner2's formatter emits "confidence"; the old code only read "score",
    so every multi-label result scored 0.0 and was filtered out by the
    validation threshold — classification silently produced nothing."""

    def test_reads_confidence_key_from_multi_label_list(self):
        raw = [
            {"label": "contract", "confidence": 0.9},
            {"label": "invoice", "confidence": 0.3},
        ]

        assert _normalise_classification_output(raw) == {
            "label": "contract",
            "confidence": 0.9,
        }

    def test_still_reads_legacy_score_key(self):
        raw = [{"label": "contract", "score": 0.8}, {"label": "invoice", "score": 0.2}]

        assert _normalise_classification_output(raw) == {
            "label": "contract",
            "confidence": 0.8,
        }

    def test_single_label_dict(self):
        assert _normalise_classification_output({"label": "contract", "confidence": 0.65}) == {
            "label": "contract",
            "confidence": 0.65,
        }

    def test_empty_input_is_empty_output(self):
        assert _normalise_classification_output([]) == {}
        assert _normalise_classification_output(None) == {}

    def test_confidence_of_tolerates_junk(self):
        assert _confidence_of({"confidence": "not-a-number"}) == 0.0
        assert _confidence_of("not-a-dict") == 0.0
        assert _confidence_of({}) == 0.0


class _ModelWithBrokenClassify:
    """Extracts entities fine, but every classification raises — the exact
    shape of the reported failure."""

    def extract_entities(self, text: str, entity_schema: dict, **kwargs: Any) -> dict:
        return {
            "entities": {
                "person": [{"text": "Jeffrey Epstein", "confidence": 0.98, "start": 0, "end": 15}]
            }
        }

    def classify_text(self, text: str, tasks: dict, **kwargs: Any) -> dict:
        raise AttributeError("'GLiNER2' object has no attribute 'classify'")


class _ModelWithBrokenEntities:
    def extract_entities(self, text: str, entity_schema: dict, **kwargs: Any) -> dict:
        raise RuntimeError("entity head exploded")

    def classify_text(self, text: str, tasks: dict, **kwargs: Any) -> dict:
        return {next(iter(tasks)): {"label": "contract", "confidence": 0.95}}


def _runner_with_both_tasks(model: Any) -> GLiNER2Runner:
    schema = GLiNER2PipelineSchema(
        entities={"person": PipelineEntityDefinition(description="a person's name")},
        classification={
            "doc_type": PipelineClassificationDefinition(labels=["contract", "invoice"])
        },
        validation=PipelineValidationConfig(confidence_threshold=0.5),
    )
    runner = GLiNER2Runner(schema, detector_key="test_detector")
    runner._model = model
    runner._setfit_models = {}
    return runner


class TestTaskIsolation:
    def test_classification_failure_does_not_discard_entities(self):
        # Previously one shared try/except meant the classification
        # AttributeError threw away the entities already extracted, and the
        # detector returned nothing.
        runner = _runner_with_both_tasks(_ModelWithBrokenClassify())

        result = runner.run("Jeffrey Epstein signed the contract.")

        assert "person" in result.entities
        assert result.entities["person"][0]["value"] == "Jeffrey Epstein"
        assert not result.classification

    def test_entity_failure_does_not_discard_classification(self):
        runner = _runner_with_both_tasks(_ModelWithBrokenEntities())

        result = runner.run("Jeffrey Epstein signed the contract.")

        assert not result.entities
        assert result.classification.get("doc_type", {}).get("label") == "contract"

    def test_both_failing_yields_an_empty_result(self):
        class _AllBroken:
            def extract_entities(self, *a: Any, **k: Any) -> dict:
                raise RuntimeError("boom")

            def classify_text(self, *a: Any, **k: Any) -> dict:
                raise RuntimeError("boom")

        runner = _runner_with_both_tasks(_AllBroken())

        result = runner.run("some text")

        assert not result.entities
        assert not result.classification

    def test_empty_result_still_carries_metadata(self):
        # "Ran and found nothing" must be a well-formed result, not a bare
        # PipelineResult — _result_to_findings dereferences metadata.
        class _FindsNothing:
            def extract_entities(self, *a: Any, **k: Any) -> dict:
                return {"entities": {}}

            def classify_text(self, text: str, tasks: dict, **k: Any) -> dict:
                return {}

        runner = _runner_with_both_tasks(_FindsNothing())

        result = runner.run("nothing of interest here")

        assert result.metadata is not None
        assert result.metadata.get("runner") == "GLINER2"


class TestEmptyPipelineResultIsRenderable:
    """A runner returns a bare PipelineResult() when its model fails to load.
    Every field on it is optional, so finding construction must not dereference
    them — otherwise a handled load failure becomes an AttributeError."""

    def test_result_to_findings_survives_a_bare_result(self):
        from src.models.generated_detectors import PipelineResult

        runner = _runner_with_both_tasks(_FakeModelNewApi())

        assert runner._result_to_findings("some text", PipelineResult()) == []
