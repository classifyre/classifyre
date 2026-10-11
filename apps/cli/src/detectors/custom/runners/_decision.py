"""Decision pipeline runner — typed questions answered with probabilities.

A decision model (the Decisions API and System One family) does not write
text. It is handed the content and a list of questions and returns, for each,
a number: the probability that a yes/no condition holds, which option of a
fixed list fits, or where the content sits on a scale.

Every provider is reached through ``litellm.decisions``, which speaks both wire
formats and translates between them, so the model name alone picks the API.
This runner always sends the System One shape (``state`` plus a map of named
questions) because it is the one every provider accepts.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

# Quiet litellm's import-time provider preload warnings (bedrock/sagemaker need
# botocore, which we don't install) before the library is ever imported.
os.environ.setdefault("LITELLM_LOG", "ERROR")

from ....models.generated_detectors import (
    DecisionPipelineSchema,
    DecisionQuestion,
    DecisionQuestionOption,
    DecisionQuestionType,
    Severity,
)
from ....models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
)
from ...dependencies import require_module
from ...errors import ProviderRefusedError
from ._base import _TEXT_CONTENT_TYPES, BaseRunner
from ._provider_call import _COMPLETION_TIMEOUT_SECONDS, call_with_backoff

logger = logging.getLogger(__name__)

RUNNER = "DECISION"

# A yes/no answer is a finding once "yes" is more likely than not. A choice or
# a score always lands on exactly one answer, so its default keeps every one:
# the finding carries the model's confidence, and a threshold applied before
# recording would only hide that the model was asked.
_DEFAULT_YES_NO_THRESHOLD = 0.5
_DEFAULT_PICK_THRESHOLD = 0.0

_MIN_OPTIONS = 2
_MAX_CHOICE_OPTIONS = 255
_MAX_SCORE_LEVELS = 10

_MATCHED_CONTENT_CHARS = 320


class DecisionCallError(RuntimeError):
    """Provider call failed after retries.

    Carries only a string message so it survives pickling across the detector
    worker-pool process boundary; the pipeline records the detector's outcome
    as ERROR instead of a silent empty result.
    """


class DecisionProviderRefusedError(DecisionCallError, ProviderRefusedError):
    """The provider refused in a way no retry can fix (quota, auth, billing).

    Raised on the first such response, never after retries. The pipeline
    disables the detector for the rest of the run when it sees one.
    """


class DecisionRunner(BaseRunner):
    """Decision detector — asks a decision model typed questions about content."""

    def __init__(
        self,
        schema: DecisionPipelineSchema,
        detector_key: str = "",
        detector_name: str = "",
    ) -> None:
        self._schema = schema
        self._detector_key = detector_key
        self._detector_name = detector_name
        self._model = schema.model.strip()
        _check_questions(detector_key, schema.questions)

        self._litellm = require_module("litellm", "llm", ["llm"])
        if not callable(getattr(self._litellm, "decisions", None)):
            raise ValueError(
                f"Decision detector '{detector_key}' needs litellm 1.104.2 or newer: "
                "the installed version has no decisions API."
            )
        self._litellm.suppress_debug_info = True
        logging.getLogger("LiteLLM").setLevel(logging.ERROR)
        self._wire_questions = {q.name: _wire_question(q) for q in schema.questions}

    def run(self, text: str) -> None:  # type: ignore[override]  # pragma: no cover
        raise NotImplementedError("DecisionRunner uses detect() directly")

    def detect(self, content: str | bytes, content_type: str) -> list[DetectionResult]:
        if isinstance(content, bytes) or content_type not in _TEXT_CONTENT_TYPES:
            return []
        text = content.strip()
        if not text:
            return []
        snippet = text[: self._schema.content_limit or 8000]

        try:
            response = self._decide(snippet)
            answers = _answers_of(response)
        except DecisionProviderRefusedError:
            # Already names the detector, the model and the refusal. No stack
            # trace: it is expected, and it will be the same on every asset.
            raise
        except Exception as exc:
            logger.error(
                "decision detector error (detector=%s, model=%s): %s",
                self._detector_key,
                self._model,
                exc,
                exc_info=True,
            )
            # Propagate instead of returning [] — an empty result here is
            # indistinguishable from "genuinely found nothing" and would let
            # the pipeline record this detector OK on an asset it never saw.
            raise DecisionCallError(
                f"Decision provider call failed for detector '{self._detector_key}' "
                f"(model={self._model}): {exc}"
            ) from None

        return self._results_from_answers(snippet, answers, _served_model(response))

    # ── Provider call ────────────────────────────────────────────────────────

    def _decide(self, snippet: str) -> Any:
        schema = self._schema
        secrets = _string_map(schema.secrets)
        headers = _string_map(schema.extra_headers)

        def decide() -> Any:
            return self._litellm.decisions(
                model=self._model,
                state=snippet,
                questions=self._wire_questions,
                # None lets litellm fall back to the provider's own environment
                # variable, which is how a self-hosted server without a key and
                # a deployment-wide key both work.
                api_key=secrets.get("api_key") or None,
                api_base=_plain(schema.api_base) or None,
                extra_headers=headers or None,
                timeout=_COMPLETION_TIMEOUT_SECONDS,
            )

        return call_with_backoff(
            decide,
            litellm=self._litellm,
            schema=schema,
            kind="decision",
            detector_key=self._detector_key,
            model=self._model,
            refused=lambda refusal, exc: DecisionProviderRefusedError(
                f"Decision provider refused detector '{self._detector_key}' "
                f"(model={self._model}, {refusal}): {exc}"
            ),
        )

    # ── Answers → findings ───────────────────────────────────────────────────

    def _results_from_answers(
        self,
        snippet: str,
        answers: Mapping[str, Mapping[str, Any]],
        served_model: str | None,
    ) -> list[DetectionResult]:
        schema = self._schema
        default_severity = schema.severity if schema.severity is not None else Severity.medium

        verdicts: list[_Verdict] = []
        unanswered: list[str] = []
        for question in schema.questions:
            answer = answers.get(question.name)
            verdict = _verdict(question, answer) if answer is not None else None
            if verdict is None:
                unanswered.append(question.name)
            else:
                verdicts.append(verdict)

        if unanswered:
            # A model may decline one question and answer the rest. Said out
            # loud, because a declined question otherwise reads as "no".
            logger.warning(
                "%s: the model returned no usable answer for %d question(s): %s",
                self._detector_key,
                len(unanswered),
                ", ".join(unanswered[:10]),
            )

        # Every finding carries the whole set of answers from this call, in the
        # shape the extraction view already renders, so a reviewer sees what
        # the model said to each question and not only the one that fired.
        extracted = {
            "entities": {},
            "classification": {v.question.name: v.summary() for v in verdicts},
            "metadata": {"runner": RUNNER, "model": served_model or self._model},
        }

        results: list[DetectionResult] = []
        suppressed: list[tuple[str, float]] = []
        for verdict in verdicts:
            if verdict.outcome == "suppressed":
                suppressed.append((verdict.finding_type, verdict.certainty))
            if verdict.outcome != "finding":
                continue
            results.append(
                DetectionResult(
                    detector_type=DetectorType.CUSTOM,
                    finding_type=verdict.finding_type,
                    category="CLASSIFICATION",
                    severity=verdict.severity or verdict.question.severity or default_severity,
                    confidence=verdict.certainty,
                    matched_content=snippet[:_MATCHED_CONTENT_CHARS],
                    location=None,
                    custom_detector_key=self._detector_key,
                    custom_detector_name=self._detector_name,
                    detected_at=datetime.now(UTC),
                    metadata={
                        "runner": RUNNER,
                        "model": self._model,
                        "question": verdict.question.name,
                        "question_type": verdict.question.type.value,
                        "instructions": verdict.question.instructions,
                        "label": verdict.finding_type,
                        "answer": verdict.answer,
                        **verdict.detail,
                        "input": "text",
                    },
                    extracted_data=extracted,
                    extraction_method=RUNNER,
                )
            )

        if suppressed:
            logger.warning(
                "%s: thresholds discarded %d model answer(s): %s%s. The model answered — "
                "lower the question's threshold (0 records every answer with its "
                "confidence, to filter downstream) if this is not what you meant.",
                self._detector_key,
                len(suppressed),
                ", ".join(f"{label}={score:.2f}" for label, score in suppressed[:5]),
                " and more" if len(suppressed) > 5 else "",
            )

        results.sort(key=lambda r: r.confidence, reverse=True)
        return results


# ── Questions on the wire ────────────────────────────────────────────────────


def _check_questions(detector_key: str, questions: list[DecisionQuestion]) -> None:
    """Refuse a question set no provider would accept, before any call is paid for."""
    seen: set[str] = set()
    for question in questions:
        if question.name in seen:
            raise ValueError(
                f"Decision detector '{detector_key}' has two questions named '{question.name}'."
            )
        seen.add(question.name)
        if question.type == DecisionQuestionType.yes_no:
            continue
        options = question.options or []
        limit = (
            _MAX_CHOICE_OPTIONS
            if question.type == DecisionQuestionType.choice
            else _MAX_SCORE_LEVELS
        )
        if not _MIN_OPTIONS <= len(options) <= limit:
            raise ValueError(
                f"Decision detector '{detector_key}': {question.type.value} question "
                f"'{question.name}' needs {_MIN_OPTIONS} to {limit} options, got {len(options)}."
            )
        labels = [option.label for option in options]
        if len(set(labels)) != len(labels):
            raise ValueError(
                f"Decision detector '{detector_key}': question '{question.name}' "
                "repeats an option label."
            )


def _wire_question(question: DecisionQuestion) -> dict[str, Any]:
    """One question in the System One shape litellm forwards or translates."""
    if question.type == DecisionQuestionType.yes_no:
        return {"type": "noul", "instructions": question.instructions}
    options = question.options or []
    if question.type == DecisionQuestionType.choice:
        return {
            "type": "choice",
            "instructions": question.instructions,
            # A described option is sent with its description. An undescribed
            # one repeats its label: null is legal for hosted providers, but a
            # self-hosted server is not obliged to accept it.
            "criteria": {option.label: option.description or option.label for option in options},
        }
    return {
        "type": "score",
        "instructions": question.instructions,
        "criteria": [_level_text(option) for option in options],
    }


def _level_text(option: DecisionQuestionOption) -> str:
    return f"{option.label}: {option.description}" if option.description else option.label


# ── Answers off the wire ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Verdict:
    """What the model said to one question, and what that means as a finding.

    ``outcome`` is ``finding`` when the answer is recorded, ``quiet`` when it is
    the expected answer nobody asked to hear about (a "no", or an option with
    ``report: false``), and ``suppressed`` when it would have been recorded but
    fell below the question's threshold.
    """

    question: DecisionQuestion
    answer: str
    certainty: float
    finding_type: str
    outcome: Literal["finding", "quiet", "suppressed"]
    severity: Severity | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        """The answer as one row of the extraction view: label plus confidence."""
        return {"label": self.answer, "confidence": self.certainty, **self.detail}


def _verdict(question: DecisionQuestion, answer: Mapping[str, Any]) -> _Verdict | None:
    """Read one answer; None when the model did not answer in the asked type."""
    if question.type == DecisionQuestionType.yes_no:
        raw = _number(answer.get("noul"))
        if raw is None:
            return None
        probability = _unit(raw)
        threshold = (
            question.threshold if question.threshold is not None else _DEFAULT_YES_NO_THRESHOLD
        )
        said_yes = probability >= threshold
        return _Verdict(
            question,
            answer="yes" if said_yes else "no",
            # How sure the model is of the answer as stated, so a "no" at 0.2
            # reads as 80% no rather than 20% of something.
            certainty=probability if said_yes else _unit(1.0 - probability),
            finding_type=question.name,
            # A "no" is never the finding: the question is asked so "yes" is.
            outcome="finding" if said_yes else "quiet",
            detail={"probability": probability},
        )

    options = question.options or []
    probabilities = _number_map(answer.get("probabilities"))
    threshold = question.threshold if question.threshold is not None else _DEFAULT_PICK_THRESHOLD

    if question.type == DecisionQuestionType.choice:
        raw_choice = answer.get("choice")
        if raw_choice is None:
            return None
        label = _choice_label(raw_choice)
        option = next((o for o in options if o.label == label), None)
        if option is None:
            # The model named something that was never offered. Recording it
            # would invent a finding type the detector does not define.
            return None
        confidence = _number(answer.get("confidence"))
        certainty = _unit(confidence if confidence is not None else probabilities.get(label, 0.0))
        return _Verdict(
            question,
            answer=option.label,
            certainty=certainty,
            finding_type=f"{question.name}:{option.label}",
            outcome=_pick_outcome(option, certainty, threshold),
            severity=option.severity,
            detail={"probabilities": probabilities} if probabilities else {},
        )

    score = _number(answer.get("score"))
    if score is None or not options:
        return None
    # The score is the probability-weighted level, so it falls between levels.
    # The level it is nearest to is the one reported.
    index = min(len(options) - 1, max(0, int(score + 0.5)))
    option = options[index]
    confidence = _number(answer.get("confidence"))
    certainty = _unit(confidence if confidence is not None else probabilities.get(str(index), 0.0))
    by_label = {
        options[int(key)].label: value
        for key, value in probabilities.items()
        if key.isdigit() and int(key) < len(options)
    }
    return _Verdict(
        question,
        answer=option.label,
        certainty=certainty,
        finding_type=f"{question.name}:{option.label}",
        outcome=_pick_outcome(option, certainty, threshold),
        severity=option.severity,
        detail={
            "score": round(score, 4),
            "level": index,
            **({"probabilities": by_label} if by_label else {}),
        },
    )


def _pick_outcome(
    option: DecisionQuestionOption, certainty: float, threshold: float
) -> Literal["finding", "quiet", "suppressed"]:
    if option.report is False:
        return "quiet"
    return "finding" if certainty >= threshold else "suppressed"


def _answers_of(response: Any) -> dict[str, dict[str, Any]]:
    """The response's answers as plain dicts keyed by question name."""
    raw = response.get("answers") if isinstance(response, Mapping) else None
    if raw is None:
        raw = getattr(response, "answers", None)
    if not isinstance(raw, Mapping):
        raise ValueError("the provider response carries no answers")
    return {str(name): _as_dict(answer) for name, answer in raw.items() if answer is not None}


def _served_model(response: Any) -> str | None:
    model = response.get("model") if isinstance(response, Mapping) else None
    if model is None:
        model = getattr(response, "model", None)
    return model if isinstance(model, str) and model.strip() else None


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        dumped = dump()
        return dict(dumped) if isinstance(dumped, Mapping) else {}
    return dict(vars(value)) if hasattr(value, "__dict__") else {}


def _choice_label(value: Any) -> str:
    # System One keys a boolean choice by its text; mirror that.
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _number_map(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    numbers = {str(key): _number(item) for key, item in value.items()}
    return {key: round(item, 4) for key, item in numbers.items() if item is not None}


def _unit(value: float) -> float:
    """Clamp to [0, 1]; a finding's confidence is stored as a probability."""
    return round(min(1.0, max(0.0, value)), 4)


def _plain(value: Any) -> Any:
    """Unwrap a generated RootModel wrapper to the value it holds."""
    return getattr(value, "root", value)


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    plain = {str(key): _plain(item) for key, item in value.items()}
    return {key: item for key, item in plain.items() if isinstance(item, str) and item}
