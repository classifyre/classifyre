"""Unit tests for the decision detector runner.

Most tests mock ``litellm.decisions`` so they never leave the process. The
last group starts a local HTTP server that speaks the System One contract and
runs the real ``litellm.decisions`` against it, so what the runner puts on the
wire and what it reads back are checked against litellm itself, not a mock of it.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from src.detectors.custom.runners import DecisionRunner, create_runner
from src.detectors.custom.runners._decision import (
    DecisionCallError,
    DecisionProviderRefusedError,
)
from src.detectors.errors import ProviderRefusedError
from src.models.generated_detectors import (
    CustomDetectorConfig,
    DecisionPipelineSchema,
    DetectorBudget,
    Severity,
)
from src.utils.redaction import Redactor

from .conftest import requires_litellm

pytestmark = requires_litellm

TICKET = (
    "Customer wrote: I was charged twice for my order #4411 and want one of "
    "the charges refunded today. This is the third time I am asking."
)

QUESTIONS: list[dict[str, Any]] = [
    {
        "name": "refund_request",
        "type": "yes_no",
        "instructions": "Is the customer asking for a refund?",
        "severity": "low",
    },
    {
        "name": "urgency",
        "type": "choice",
        "instructions": "How urgent is this?",
        "options": [
            {"label": "low", "description": "can wait a week", "report": False},
            {"label": "high", "description": "needs action today", "severity": "high"},
        ],
    },
    {
        "name": "frustration",
        "type": "score",
        "instructions": "How frustrated is the customer?",
        "options": [
            {"label": "calm", "report": False},
            {"label": "annoyed", "severity": "low"},
            {"label": "angry", "description": "hostile language", "severity": "critical"},
        ],
    },
]

ANSWERS: dict[str, Any] = {
    "refund_request": {"type": "noul", "noul": 0.99},
    "urgency": {
        "type": "choice",
        "choice": "high",
        "confidence": 0.93,
        "probabilities": {"low": 0.04, "high": 0.96},
    },
    "frustration": {
        "type": "score",
        "score": 1.9,
        "confidence": 0.86,
        "legend": {"0": "calm", "1": "annoyed", "2": "angry: hostile language"},
        "probabilities": {"0": 0.02, "1": 0.06, "2": 0.92},
    },
}


def _schema(**overrides: Any) -> DecisionPipelineSchema:
    base: dict[str, Any] = {
        "model": "typesafe/jev-latest",
        "secrets": {"api_key": "ts-test-key-123456"},
        "questions": QUESTIONS,
    }
    base.update(overrides)
    return DecisionPipelineSchema.model_validate(base)


def _response(answers: dict[str, Any] | None = None, model: str = "jev-1.13.0") -> SimpleNamespace:
    return SimpleNamespace(model=model, answers=ANSWERS if answers is None else answers)


def _runner(schema: DecisionPipelineSchema, decisions: MagicMock) -> DecisionRunner:
    runner = DecisionRunner(schema, detector_key="ticket_triage", detector_name="Ticket triage")
    runner._litellm = SimpleNamespace(decisions=decisions)
    return runner


def _by_type(results: list[Any]) -> dict[str, Any]:
    return {result.finding_type: result for result in results}


# ── Wiring ────────────────────────────────────────────────────────────────────


def test_factory_returns_the_decision_runner() -> None:
    assert isinstance(create_runner(_schema(), "k", "n"), DecisionRunner)


def test_config_with_a_decision_pipeline_validates() -> None:
    config = CustomDetectorConfig.model_validate(
        {
            "custom_detector_key": "ticket_triage",
            "name": "Ticket triage",
            "pipeline_schema": {
                "type": "DECISION",
                "model": "cloudflare/clef",
                "questions": QUESTIONS,
            },
        }
    )
    assert isinstance(config.pipeline_schema, DecisionPipelineSchema)


# ── What goes to the provider ─────────────────────────────────────────────────


def test_call_carries_model_credentials_and_system_one_questions() -> None:
    decisions = MagicMock(return_value=_response())
    schema = _schema(
        api_base="https://decisions.example.test",
        extra_headers={"x-team": "risk"},
    )
    _runner(schema, decisions).detect(TICKET, "text/plain")

    kwargs = decisions.call_args.kwargs
    assert kwargs["model"] == "typesafe/jev-latest"
    assert kwargs["api_key"] == "ts-test-key-123456"
    assert kwargs["api_base"] == "https://decisions.example.test"
    assert kwargs["extra_headers"] == {"x-team": "risk"}
    assert kwargs["state"] == TICKET
    assert kwargs["timeout"] > 0
    assert kwargs["questions"] == {
        "refund_request": {
            "type": "noul",
            "instructions": "Is the customer asking for a refund?",
        },
        "urgency": {
            "type": "choice",
            "instructions": "How urgent is this?",
            "criteria": {"low": "can wait a week", "high": "needs action today"},
        },
        "frustration": {
            "type": "score",
            "instructions": "How frustrated is the customer?",
            "criteria": ["calm", "annoyed", "angry: hostile language"],
        },
    }


def test_missing_key_and_base_are_left_for_litellm_to_resolve() -> None:
    # A self-hosted server needs no key, and a deployment may set the provider's
    # environment variable once instead of storing a key on every detector.
    decisions = MagicMock(return_value=_response())
    _runner(_schema(secrets=None), decisions).detect(TICKET, "text/plain")

    kwargs = decisions.call_args.kwargs
    assert kwargs["api_key"] is None
    assert kwargs["api_base"] is None
    assert kwargs["extra_headers"] is None


def test_content_is_cut_to_the_content_limit() -> None:
    decisions = MagicMock(return_value=_response())
    _runner(_schema(content_limit=20), decisions).detect(TICKET, "text/plain")
    assert decisions.call_args.kwargs["state"] == TICKET[:20]


def test_binary_and_empty_content_are_never_sent() -> None:
    decisions = MagicMock(return_value=_response())
    runner = _runner(_schema(), decisions)

    assert runner.detect(b"%PDF-1.7", "application/pdf") == []
    assert runner.detect("   ", "text/plain") == []
    assert runner.detect(TICKET, "image/png") == []
    decisions.assert_not_called()


# ── Answers → findings ────────────────────────────────────────────────────────


def test_each_answer_becomes_a_finding_with_its_label_severity_and_confidence() -> None:
    results = _runner(_schema(), MagicMock(return_value=_response())).detect(TICKET, "text/plain")
    found = _by_type(results)

    assert set(found) == {"refund_request", "urgency:high", "frustration:angry"}

    refund = found["refund_request"]
    assert refund.confidence == 0.99
    assert refund.severity == Severity.low
    assert refund.metadata["answer"] == "yes"
    assert refund.metadata["probability"] == 0.99
    assert refund.metadata["instructions"] == "Is the customer asking for a refund?"

    urgency = found["urgency:high"]
    assert urgency.confidence == 0.93
    assert urgency.severity == Severity.high
    assert urgency.metadata["probabilities"] == {"low": 0.04, "high": 0.96}

    frustration = found["frustration:angry"]
    assert frustration.confidence == 0.86
    assert frustration.severity == Severity.critical
    assert frustration.metadata["score"] == 1.9
    assert frustration.metadata["level"] == 2
    assert frustration.metadata["probabilities"] == {"calm": 0.02, "annoyed": 0.06, "angry": 0.92}

    for result in results:
        assert result.custom_detector_key == "ticket_triage"
        assert result.custom_detector_name == "Ticket triage"
        assert result.extraction_method == "DECISION"
        assert result.metadata["runner"] == "DECISION"
        assert result.matched_content == TICKET[:320]
    # Most certain first.
    assert [r.confidence for r in results] == sorted((r.confidence for r in results), reverse=True)


def test_every_finding_carries_all_answers_in_the_extraction_shape() -> None:
    results = _runner(_schema(), MagicMock(return_value=_response())).detect(TICKET, "text/plain")

    extracted = results[0].extracted_data
    assert extracted is not None
    assert extracted["metadata"] == {"runner": "DECISION", "model": "jev-1.13.0"}
    assert extracted["entities"] == {}
    assert extracted["classification"]["refund_request"]["label"] == "yes"
    assert extracted["classification"]["refund_request"]["confidence"] == 0.99
    assert extracted["classification"]["urgency"]["label"] == "high"
    assert extracted["classification"]["frustration"]["label"] == "angry"
    assert all(result.extracted_data == extracted for result in results)


def test_a_no_is_not_a_finding_and_reads_as_a_confident_no() -> None:
    answers = {**ANSWERS, "refund_request": {"type": "noul", "noul": 0.2}}
    results = _runner(_schema(), MagicMock(return_value=_response(answers))).detect(
        TICKET, "text/plain"
    )

    assert "refund_request" not in _by_type(results)
    summary = results[0].extracted_data["classification"]["refund_request"]
    assert summary["label"] == "no"
    assert summary["confidence"] == 0.8
    assert summary["probability"] == 0.2


def test_yes_no_threshold_moves_where_yes_starts() -> None:
    questions = [{**QUESTIONS[0], "threshold": 0.9}]
    answers = {"refund_request": {"type": "noul", "noul": 0.7}}
    strict = _runner(_schema(questions=questions), MagicMock(return_value=_response(answers)))
    assert strict.detect(TICKET, "text/plain") == []

    questions = [{**QUESTIONS[0], "threshold": 0.3}]
    answers = {"refund_request": {"type": "noul", "noul": 0.4}}
    lenient = _runner(_schema(questions=questions), MagicMock(return_value=_response(answers)))
    assert [r.finding_type for r in lenient.detect(TICKET, "text/plain")] == ["refund_request"]


def test_an_option_marked_report_false_is_answered_but_not_recorded() -> None:
    answers = {
        **ANSWERS,
        "urgency": {
            "type": "choice",
            "choice": "low",
            "confidence": 0.9,
            "probabilities": {"low": 0.95, "high": 0.05},
        },
        "frustration": {
            "type": "score",
            "score": 0.1,
            "confidence": 0.9,
            "legend": {},
            "probabilities": {"0": 0.9, "1": 0.1, "2": 0.0},
        },
    }
    results = _runner(_schema(), MagicMock(return_value=_response(answers))).detect(
        TICKET, "text/plain"
    )

    assert [r.finding_type for r in results] == ["refund_request"]
    classification = results[0].extracted_data["classification"]
    assert classification["urgency"]["label"] == "low"
    assert classification["frustration"]["label"] == "calm"


def test_score_lands_on_the_nearest_level() -> None:
    def level_for(score: float) -> str:
        answers = {
            "frustration": {
                "type": "score",
                "score": score,
                "confidence": 0.7,
                "legend": {},
                "probabilities": {},
            }
        }
        runner = _runner(
            _schema(questions=[QUESTIONS[2]]), MagicMock(return_value=_response(answers))
        )
        results = runner.detect(TICKET, "text/plain")
        return results[0].finding_type if results else "none"

    assert level_for(0.49) == "none"  # calm, which is not reported
    assert level_for(0.5) == "frustration:annoyed"
    assert level_for(1.49) == "frustration:annoyed"
    assert level_for(1.5) == "frustration:angry"
    assert level_for(7.0) == "frustration:angry"  # clamped to the top level


def test_severity_falls_back_from_option_to_question_to_detector() -> None:
    questions = [
        {
            "name": "topic",
            "type": "choice",
            "instructions": "What is this about?",
            "severity": "high",
            "options": [{"label": "billing"}, {"label": "shipping", "severity": "info"}],
        },
        {"name": "legal_threat", "type": "yes_no", "instructions": "Is a lawsuit threatened?"},
    ]
    answers = {
        "topic": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.8,
            "probabilities": {"billing": 0.9, "shipping": 0.1},
        },
        "legal_threat": {"type": "noul", "noul": 0.95},
    }
    runner = _runner(
        _schema(questions=questions, severity="critical"),
        MagicMock(return_value=_response(answers)),
    )
    found = _by_type(runner.detect(TICKET, "text/plain"))

    assert found["topic:billing"].severity == Severity.high  # the question's
    assert found["legal_threat"].severity == Severity.critical  # the detector's


def test_low_confidence_pick_is_suppressed_only_when_a_threshold_asks(
    caplog: pytest.LogCaptureFixture,
) -> None:
    answers = {
        "urgency": {
            "type": "choice",
            "choice": "high",
            "confidence": 0.35,
            "probabilities": {"low": 0.3, "high": 0.7},
        }
    }
    # By default a pick is always recorded: it carries its own confidence.
    default = _runner(_schema(questions=[QUESTIONS[1]]), MagicMock(return_value=_response(answers)))
    assert [r.confidence for r in default.detect(TICKET, "text/plain")] == [0.35]

    strict = _runner(
        _schema(questions=[{**QUESTIONS[1], "threshold": 0.6}]),
        MagicMock(return_value=_response(answers)),
    )
    with caplog.at_level("WARNING"):
        assert strict.detect(TICKET, "text/plain") == []
    # Discarding silently would look like the model never answered.
    assert "urgency:high=0.35" in caplog.text


def test_unanswered_and_unknown_answers_are_skipped_and_said_out_loud(
    caplog: pytest.LogCaptureFixture,
) -> None:
    answers = {
        # refund_request: declined, so absent
        "urgency": {"type": "choice", "choice": "catastrophic", "confidence": 0.9},
        "frustration": ANSWERS["frustration"],
    }
    runner = _runner(_schema(), MagicMock(return_value=_response(answers)))
    with caplog.at_level("WARNING"):
        results = runner.detect(TICKET, "text/plain")

    assert [r.finding_type for r in results] == ["frustration:angry"]
    assert "refund_request, urgency" in caplog.text


def test_all_quiet_answers_produce_no_findings() -> None:
    answers = {"refund_request": {"type": "noul", "noul": 0.01}}
    runner = _runner(_schema(questions=[QUESTIONS[0]]), MagicMock(return_value=_response(answers)))
    assert runner.detect(TICKET, "text/plain") == []


# ── Question sets no provider would accept ────────────────────────────────────


@pytest.mark.parametrize(
    ("questions", "message"),
    [
        ([QUESTIONS[0], QUESTIONS[0]], "two questions named 'refund_request'"),
        (
            [{"name": "q", "type": "choice", "instructions": "?", "options": [{"label": "a"}]}],
            "needs 2 to 255 options",
        ),
        (
            [{"name": "q", "type": "score", "instructions": "?", "options": []}],
            "needs 2 to 10 options",
        ),
        (
            [
                {
                    "name": "q",
                    "type": "score",
                    "instructions": "?",
                    "options": [{"label": str(i)} for i in range(11)],
                }
            ],
            "needs 2 to 10 options",
        ),
        (
            [
                {
                    "name": "q",
                    "type": "choice",
                    "instructions": "?",
                    "options": [{"label": "a"}, {"label": "a"}],
                }
            ],
            "repeats an option label",
        ),
    ],
)
def test_invalid_question_sets_are_refused_before_any_call(
    questions: list[dict[str, Any]], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        DecisionRunner(_schema(questions=questions), detector_key="d")


# ── Provider failures ─────────────────────────────────────────────────────────


class _RateLimitError(Exception):
    status_code = 429


class _AuthError(Exception):
    status_code = 401


class _BadRequestError(Exception):
    status_code = 400


@pytest.fixture
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    sleeps: list[float] = []
    monkeypatch.setattr("src.detectors.custom.runners._provider_call.time.sleep", sleeps.append)
    return sleeps


def test_transient_failure_is_retried_with_backoff(no_sleep: list[float]) -> None:
    decisions = MagicMock(side_effect=[_RateLimitError("429"), _RateLimitError("503"), _response()])
    results = _runner(_schema(), decisions).detect(TICKET, "text/plain")

    assert len(results) == 3
    assert decisions.call_count == 3
    assert len(no_sleep) == 2
    assert no_sleep[1] > no_sleep[0]


@pytest.mark.usefixtures("no_sleep")
def test_a_dead_provider_raises_instead_of_reporting_nothing() -> None:
    # An empty result would be indistinguishable from "asked and found nothing".
    decisions = MagicMock(side_effect=_RateLimitError("rate limited"))
    with pytest.raises(DecisionCallError, match="ticket_triage"):
        _runner(_schema(), decisions).detect(TICKET, "text/plain")
    assert decisions.call_count == 4


def test_rejected_key_is_a_refusal_and_is_not_retried(no_sleep: list[float]) -> None:
    decisions = MagicMock(side_effect=_AuthError("invalid api key"))
    with pytest.raises(ProviderRefusedError) as raised:
        _runner(_schema(), decisions).detect(TICKET, "text/plain")

    assert isinstance(raised.value, DecisionProviderRefusedError)
    assert "authentication refused" in str(raised.value)
    assert decisions.call_count == 1
    assert no_sleep == []


@pytest.mark.usefixtures("no_sleep")
def test_a_bad_request_fails_fast() -> None:
    decisions = MagicMock(side_effect=_BadRequestError("Unknown Decisions provider 'nope'"))
    with pytest.raises(DecisionCallError, match="Unknown Decisions provider"):
        _runner(_schema(model="nope/model"), decisions).detect(TICKET, "text/plain")
    assert decisions.call_count == 1


@pytest.mark.usefixtures("no_sleep")
def test_budget_max_attempts_bounds_the_retries() -> None:
    decisions = MagicMock(side_effect=_RateLimitError("429 slow down"))
    runner = _runner(_schema(budget=DetectorBudget(max_attempts=2)), decisions)
    with pytest.raises(DecisionCallError):
        runner.detect(TICKET, "text/plain")
    assert decisions.call_count == 2


def test_errors_cross_the_worker_pool_boundary_with_their_type() -> None:
    import pickle

    err = DecisionProviderRefusedError("Decision provider refused detector 'x' (quota exhausted)")
    restored = pickle.loads(pickle.dumps(err))
    assert isinstance(restored, ProviderRefusedError)
    assert isinstance(restored, DecisionCallError)


def test_a_response_without_answers_is_an_error_not_an_empty_result() -> None:
    decisions = MagicMock(return_value=SimpleNamespace(model="m", answers=None))
    with pytest.raises(DecisionCallError, match="no answers"):
        _runner(_schema(), decisions).detect(TICKET, "text/plain")


# ── Secrets ───────────────────────────────────────────────────────────────────


def test_the_api_key_is_redacted_from_scan_logs() -> None:
    recipe = {
        "detectors": [
            {
                "type": "CUSTOM",
                "config": {
                    "pipeline_schema": {
                        "type": "DECISION",
                        "model": "typesafe/jev-latest",
                        "secrets": {"api_key": "ts-live-key-abcdef123456"},
                        "questions": QUESTIONS,
                    }
                },
            }
        ]
    }
    redactor = Redactor.from_recipe(recipe)
    assert "ts-live-key-abcdef123456" not in redactor("401 for key ts-live-key-abcdef123456")


# ── Against the real litellm.decisions, over HTTP ─────────────────────────────


class _SystemOneStub(BaseHTTPRequestHandler):
    """A System One server: answers POST /v1/systemone the way Jev does."""

    requests: list[dict[str, Any]] = []  # noqa: RUF012 - shared per test on purpose
    status = 200

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        type(self).requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("authorization"),
                "x_team": self.headers.get("x-team"),
                "body": body,
            }
        )
        if type(self).status != 200:
            payload = json.dumps({"error": {"message": "invalid api key"}}).encode()
            self.send_response(type(self).status)
        else:
            payload = json.dumps(
                {"model": "stub-1", "answers": ANSWERS, "usage": {"input_tokens": 41}}
            ).encode()
            self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: Any) -> None:
        pass


@pytest.fixture
def system_one_server() -> Iterator[str]:
    _SystemOneStub.requests = []
    _SystemOneStub.status = 200
    server = HTTPServer(("127.0.0.1", 0), _SystemOneStub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_real_litellm_call_round_trips_a_system_one_server(system_one_server: str) -> None:
    schema = _schema(
        model="typesafe/jev-latest",
        api_base=system_one_server,
        extra_headers={"x-team": "risk"},
    )
    runner = DecisionRunner(schema, detector_key="ticket_triage", detector_name="Ticket triage")

    results = runner.detect(TICKET, "text/plain")

    assert set(_by_type(results)) == {"refund_request", "urgency:high", "frustration:angry"}
    assert results[0].extracted_data["metadata"]["model"] == "stub-1"

    (request,) = _SystemOneStub.requests
    assert request["path"] == "/v1/systemone"
    assert request["authorization"] == "Bearer ts-test-key-123456"
    assert request["x_team"] == "risk"
    assert request["body"]["model"] == "jev-latest"
    assert request["body"]["state"] == TICKET
    assert request["body"]["questions"]["refund_request"]["type"] == "noul"
    assert request["body"]["questions"]["urgency"]["criteria"] == {
        "low": "can wait a week",
        "high": "needs action today",
    }
    assert request["body"]["questions"]["frustration"]["criteria"] == [
        "calm",
        "annoyed",
        "angry: hostile language",
    ]


def test_real_litellm_keyless_route_reaches_a_self_hosted_server(system_one_server: str) -> None:
    schema = _schema(
        model="strands_decider/local-decider", api_base=system_one_server, secrets=None
    )
    runner = DecisionRunner(schema, detector_key="ticket_triage")

    assert len(runner.detect(TICKET, "text/plain")) == 3
    (request,) = _SystemOneStub.requests
    assert request["path"] == "/v1/systemone"
    assert request["authorization"] is None
    assert request["body"]["model"] == "local-decider"


def test_real_litellm_maps_a_401_to_a_refusal(system_one_server: str) -> None:
    _SystemOneStub.status = 401
    runner = DecisionRunner(_schema(api_base=system_one_server), detector_key="ticket_triage")

    with pytest.raises(DecisionProviderRefusedError, match="authentication refused"):
        runner.detect(TICKET, "text/plain")
    assert len(_SystemOneStub.requests) == 1


def test_real_litellm_names_the_supported_providers_for_an_unknown_prefix() -> None:
    runner = DecisionRunner(_schema(model="nope/some-model"), detector_key="ticket_triage")
    with pytest.raises(DecisionCallError, match="Supported providers"):
        runner.detect(TICKET, "text/plain")
