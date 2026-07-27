"""Regional PII entities must actually be detectable, not just advertised.

Presidio scopes its country recognizers to their own language (Spanish NIF to
"es", Italian fiscal code to "it", ...) and ships no recognizer at all for the
DACH/EU identifiers. The detector builds an ``supported_languages=["en"]``
registry and always analyzes with ``language="en"``, so without explicit
re-registration those entity types are silently unreachable: a preset can ask
for ES_NIF or DE_TAX_ID and never produce a single finding.
"""

import pytest

from src.detectors.pii.detector import PIIDetector

from .conftest import requires_presidio

pytestmark = requires_presidio


@requires_presidio
def test_every_advertised_entity_is_supported_by_the_analyzer():
    """No entity in the public enum may be undetectable in practice."""
    detector = PIIDetector()
    assert detector.analyzer is not None

    supported = set(detector.analyzer.get_supported_entities())
    unreachable = sorted(PIIDetector._ALL_SUPPORTED_ENTITIES - supported)

    assert not unreachable, (
        "These entity types are advertised in the schema enum but no recognizer "
        f"can produce them: {unreachable}"
    )


@requires_presidio
def test_regional_recognizers_are_registered_exactly_once():
    """A double-registered recognizer reports every match twice."""
    detector = PIIDetector()
    assert detector.analyzer is not None

    recognizers = detector.analyzer.registry.recognizers
    seen: dict[tuple[str, str], int] = {}
    for recognizer in recognizers:
        for entity in recognizer.supported_entities:
            key = (entity, type(recognizer).__name__)
            seen[key] = seen.get(key, 0) + 1

    duplicates = {key: count for key, count in seen.items() if count > 1}
    assert not duplicates, f"Recognizers registered more than once: {duplicates}"


@requires_presidio
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("entity", "content"),
    [
        ("CH_AHV", "Die AHV-Nummer des Versicherten lautet 756.1234.5678.97."),
        ("ES_NIF", "El NIF del cliente es 12345678Z para la factura."),
        # Check digit follows Presidio's PlPeselRecognizer.validate_result rule.
        ("PL_PESEL", "Numer PESEL pracownika: 44051401351 w aktach."),
        ("DE_TAX_ID", "Die Steuer-IdNr des Mitarbeiters ist 12345678901."),
    ],
)
async def test_regional_entity_produces_a_finding(entity: str, content: str):
    """Spot-check that re-registered regional recognizers really fire."""
    detector = PIIDetector()
    results = await detector.detect(content)

    found = {result.finding_type for result in results}
    assert entity in found, f"Expected {entity} in findings, got {sorted(found)}"
