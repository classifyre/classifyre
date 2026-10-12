"""The text around a match is cut from the content the detectors were given."""

from src.models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Location,
    Severity,
)
from src.pipeline.finding_context import CONTEXT_CHARS, MAX_MATCH_CHARS, attach_context


def _finding(matched: str, **extra: object) -> DetectionResult:
    return DetectionResult(
        detector_type=DetectorType.PII,
        finding_type="EMAIL_ADDRESS",
        category="PII",
        severity=Severity.medium,
        confidence=0.9,
        matched_content=matched,
        **extra,
    )


LETTER = (
    "If a machine stops or shows a red light, write to drying@hollowmere.example "
    "or phone 020 7946 0143 and we will come the same day."
)


def test_both_sides_are_filled_in() -> None:
    [finding] = attach_context([_finding("drying@hollowmere.example")], LETTER)

    assert finding.context_before == "If a machine stops or shows a red light, write to"
    assert finding.context_after == "or phone 020 7946 0143 and we will come the same day."


def test_a_window_never_opens_or_closes_inside_a_word() -> None:
    content = "alpha " * 60 + "pip.marlow@example.com" + " omega" * 60

    [finding] = attach_context([_finding("pip.marlow@example.com")], content)

    assert finding.context_before is not None and finding.context_after is not None
    assert set(finding.context_before.split()) == {"alpha"}
    assert set(finding.context_after.split()) == {"omega"}
    assert len(finding.context_before) <= CONTEXT_CHARS
    assert len(finding.context_after) <= CONTEXT_CHARS


def test_a_repeated_value_takes_its_occurrences_in_order() -> None:
    content = "first: lantern-bot@example.com, and later on second: lantern-bot@example.com."

    first, second = attach_context(
        [_finding("lantern-bot@example.com"), _finding("lantern-bot@example.com")], content
    )

    assert first.context_before == "first:"
    assert second.context_before == "first: lantern-bot@example.com, and later on second:"


def test_a_stated_character_range_wins_over_the_first_occurrence() -> None:
    content = "a@example.com is the old one, a@example.com is the new one"
    start = content.rindex("a@example.com")
    location = Location(path="line 1", description=f"character range {start}-{start + 13}")

    [finding] = attach_context([_finding("a@example.com", location=location)], content)

    assert finding.context_after == "is the new one"


def test_what_cannot_be_found_or_is_already_set_is_left_alone() -> None:
    absent = _finding("routine")
    given = _finding("drying@hollowmere.example", context_before="kept")
    passage = _finding("x" * (MAX_MATCH_CHARS + 1))

    out = attach_context([absent, given, passage], LETTER + "x" * (MAX_MATCH_CHARS + 1))

    assert out[0].context_before is None and out[0].context_after is None
    assert out[1].context_before == "kept" and out[1].context_after is None
    assert out[2].context_before is None
