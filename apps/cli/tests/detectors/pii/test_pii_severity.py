"""PII severity assignment (G-034).

Severity was a hardcoded three-tier allowlist over Presidio entity names whose
default was HIGH. Any label not in a list — every custom recognizer, and
anything Presidio adds upstream — silently became HIGH, with no way to correct
it.

The label is also not evidence: in the corpus run, all six CRITICAL findings
were CREDIT_CARD hits on repeated-digit OCR artifacts. Severity describes what
kind of thing a recognizer claims to have matched, never whether the match is
real or whether it matters.

These tests need no Presidio.
"""

from src.detectors.pii.detector import PIIDetector
from src.models.generated_detectors import PIIDetectorConfig, Severity


def _detector(cfg: PIIDetectorConfig | None = None) -> PIIDetector:
    """A PIIDetector bound to a config without booting the Presidio analyzer."""
    detector = PIIDetector.__new__(PIIDetector)
    detector._cfg = cfg if cfg is not None else PIIDetectorConfig()
    return detector


class TestBuiltInTiers:
    def test_government_and_financial_ids_are_critical(self):
        d = _detector()
        for entity in ("US_SSN", "CREDIT_CARD", "IBAN_CODE", "US_PASSPORT"):
            assert d._get_severity_for_entity(entity) == Severity.critical

    def test_contact_identifiers_are_high(self):
        d = _detector()
        for entity in ("EMAIL_ADDRESS", "PHONE_NUMBER", "IP_ADDRESS"):
            assert d._get_severity_for_entity(entity) == Severity.high

    def test_contextual_personal_info_is_medium(self):
        d = _detector()
        for entity in ("PERSON", "LOCATION", "DATE_TIME", "NRP", "URL"):
            assert d._get_severity_for_entity(entity) == Severity.medium

    def test_entity_matching_is_case_insensitive(self):
        d = _detector()
        assert d._get_severity_for_entity("us_ssn") == Severity.critical


class TestUnknownEntityDefault:
    def test_unknown_entity_defaults_to_medium_not_high(self):
        # The bug: an unlisted label fell through to HIGH, so custom
        # recognizers inflated the severity histogram without any review.
        d = _detector()

        assert d._get_severity_for_entity("MY_CUSTOM_RECOGNIZER") == Severity.medium

    def test_future_presidio_entity_defaults_to_medium(self):
        d = _detector()

        assert d._get_severity_for_entity("SOME_NEW_UPSTREAM_ENTITY") == Severity.medium


class TestSeverityOverrides:
    def test_override_beats_the_builtin_default(self):
        # The corpus case: CREDIT_CARD matched repeated-digit OCR noise, so its
        # critical default was actively misleading there.
        d = _detector(PIIDetectorConfig(severity_overrides={"CREDIT_CARD": Severity.low}))

        assert d._get_severity_for_entity("CREDIT_CARD") == Severity.low

    def test_override_can_raise_severity_too(self):
        d = _detector(PIIDetectorConfig(severity_overrides={"PERSON": Severity.high}))

        assert d._get_severity_for_entity("PERSON") == Severity.high

    def test_override_applies_to_custom_recognizers(self):
        d = _detector(PIIDetectorConfig(severity_overrides={"BATES_NUMBER": Severity.info}))

        assert d._get_severity_for_entity("BATES_NUMBER") == Severity.info

    def test_unrelated_entities_keep_their_defaults(self):
        d = _detector(PIIDetectorConfig(severity_overrides={"CREDIT_CARD": Severity.low}))

        assert d._get_severity_for_entity("US_SSN") == Severity.critical
        assert d._get_severity_for_entity("PERSON") == Severity.medium

    def test_no_overrides_configured_is_fine(self):
        d = _detector(PIIDetectorConfig(severity_overrides=None))

        assert d._get_severity_for_entity("CREDIT_CARD") == Severity.critical

    def test_invalid_override_value_falls_back_to_the_default(self):
        # A bad value must not take down the scan.
        d = _detector()
        d._cfg = type("Cfg", (), {"severity_overrides": {"CREDIT_CARD": "not-a-severity"}})()

        assert d._get_severity_for_entity("CREDIT_CARD") == Severity.critical
